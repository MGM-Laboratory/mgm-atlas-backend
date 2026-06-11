import { createServer, Server } from 'node:http';
import { AddressInfo } from 'node:net';
import { generateKeyPairSync, randomBytes } from 'node:crypto';
import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as jwt from 'jsonwebtoken';
import { KeycloakTokenService } from './keycloak-token.service';

const ISSUER = 'https://iam.test/realms/mgm';
const CLIENT_ID = 'atlas-web';
const AUDIENCE = 'account';
const KID = 'test-key';

describe('KeycloakTokenService', () => {
  let server: Server;
  let service: KeycloakTokenService;

  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const privatePem = privateKey.export({ type: 'pkcs1', format: 'pem' }).toString();
  const rogue = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const roguePem = rogue.privateKey.export({ type: 'pkcs1', format: 'pem' }).toString();

  beforeAll(async () => {
    const jwk = {
      ...(publicKey.export({ format: 'jwk' }) as Record<string, unknown>),
      kid: KID,
      alg: 'RS256',
      use: 'sig',
    };
    server = createServer((_req, res) => {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ keys: [jwk] }));
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as AddressInfo).port;

    const values: Record<string, string> = {
      'keycloak.issuer': ISSUER,
      'keycloak.clientId': CLIENT_ID,
      'keycloak.jwksUri': `http://127.0.0.1:${port}/certs`,
      'keycloak.audience': AUDIENCE,
    };
    const config = {
      getOrThrow: (key: string) => {
        if (!(key in values)) throw new Error(`missing config ${key}`);
        return values[key];
      },
      get: (key: string) => values[key],
    } as unknown as ConfigService;

    service = new KeycloakTokenService(config);
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  function signToken(
    payload: Record<string, unknown> = {},
    options: jwt.SignOptions = {},
    key: string = privatePem,
  ): string {
    return jwt.sign(
      {
        sub: 'user-123',
        aud: AUDIENCE,
        azp: CLIENT_ID,
        email: 'user@labmgm.org',
        name: 'Test User',
        ...payload,
      },
      key,
      { algorithm: 'RS256', issuer: ISSUER, keyid: KID, expiresIn: 300, ...options },
    );
  }

  it('accepts a valid access token and returns the verified claims', async () => {
    const claims = await service.verifyLoginTokens({ accessToken: signToken() });
    expect(claims).toMatchObject({
      sub: 'user-123',
      email: 'user@labmgm.org',
      name: 'Test User',
    });
  });

  it('prefers ID-token profile claims when both tokens verify', async () => {
    const accessToken = signToken({ name: 'From Access' });
    const idToken = signToken({ aud: CLIENT_ID, name: 'From Id' });
    const claims = await service.verifyLoginTokens({ accessToken, idToken });
    expect(claims.name).toBe('From Id');
  });

  it('rejects when access and ID token subjects differ', async () => {
    await expect(
      service.verifyLoginTokens({
        accessToken: signToken(),
        idToken: signToken({ aud: CLIENT_ID, sub: 'someone-else' }),
      }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects an expired token', async () => {
    await expect(
      service.verifyLoginTokens({ accessToken: signToken({}, { expiresIn: -3600 }) }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects a token from another issuer', async () => {
    await expect(
      service.verifyLoginTokens({
        accessToken: signToken({}, { issuer: 'https://evil.test/realms/mgm' }),
      }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects a token whose audience matches neither the API audience nor the client', async () => {
    await expect(
      service.verifyLoginTokens({
        accessToken: signToken({ aud: 'other-api', azp: 'other-client' }),
      }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects an ID token not audienced to our client', async () => {
    await expect(
      service.verifyLoginTokens({
        accessToken: signToken(),
        idToken: signToken({ aud: 'somebody-else' }),
      }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects a token signed by a key not in the JWKS', async () => {
    await expect(
      service.verifyLoginTokens({ accessToken: signToken({}, {}, roguePem) }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(
      service.verifyLoginTokens({ accessToken: signToken({}, { keyid: 'unknown-kid' }) }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects alg=none and HS256 downgrade attempts', async () => {
    const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT', kid: KID })).toString(
      'base64url',
    );
    const body = Buffer.from(
      JSON.stringify({
        sub: 'user-123',
        iss: ISSUER,
        aud: AUDIENCE,
        exp: Math.floor(Date.now() / 1000) + 300,
      }),
    ).toString('base64url');
    await expect(
      service.verifyLoginTokens({ accessToken: `${header}.${body}.` }),
    ).rejects.toBeInstanceOf(UnauthorizedException);

    // Throwaway HMAC key generated at runtime — proves the verifier rejects
    // HS* downgrades without embedding a literal secret in the test.
    const hmacKey = randomBytes(32).toString('hex');
    const hs256 = jwt.sign({ sub: 'user-123', aud: AUDIENCE }, hmacKey, {
      algorithm: 'HS256',
      issuer: ISSUER,
      keyid: KID,
      expiresIn: 300,
    });
    await expect(service.verifyLoginTokens({ accessToken: hs256 })).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('rejects garbage input', async () => {
    await expect(service.verifyLoginTokens({ accessToken: 'not-a-jwt' })).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('falls back to userinfo for a missing email and pins the subject', async () => {
    const fetchMock = jest.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ sub: 'user-123', email: 'fallback@labmgm.org' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    try {
      const claims = await service.verifyLoginTokens({
        accessToken: signToken({ email: undefined }),
      });
      expect(claims.email).toBe('fallback@labmgm.org');

      fetchMock.mockResolvedValue(
        new Response(JSON.stringify({ sub: 'impostor', email: 'evil@labmgm.org' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );
      const noEmail = await service.verifyLoginTokens({
        accessToken: signToken({ email: undefined }),
      });
      expect(noEmail.email).toBeUndefined();
    } finally {
      fetchMock.mockRestore();
    }
  });
});
