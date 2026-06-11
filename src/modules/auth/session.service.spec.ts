/* eslint-disable @typescript-eslint/no-explicit-any -- typed-mock casts in tests */
import { ConfigService } from '@nestjs/config';
import { SessionService } from './session.service';

function makePrisma() {
  return {
    session: {
      create: jest.fn(),
      findUnique: jest.fn(),
      delete: jest.fn(),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    user: { findUnique: jest.fn() },
  };
}

describe('SessionService', () => {
  const config = { get: (_k: string, d?: unknown) => d } as unknown as ConfigService;

  it('creates a session and returns its id + expiry', async () => {
    const prisma = makePrisma();
    const expiresAt = new Date(Date.now() + 3600_000);
    prisma.session.create.mockResolvedValue({ id: 'sess-1', expiresAt });
    const svc = new SessionService(prisma as any, config);

    const res = await svc.createSession('user-1', 'access', 'refresh', 'id');
    expect(res).toEqual({ sessionId: 'sess-1', expiresAt });
    expect(prisma.session.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ userId: 'user-1' }) }),
    );
  });

  it('returns null for an unknown session and never loads a user', async () => {
    const prisma = makePrisma();
    prisma.session.findUnique.mockResolvedValue(null);
    const svc = new SessionService(prisma as any, config);

    expect(await svc.validateBearerAndLoadUser('nope')).toBeNull();
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });

  it('deletes and rejects an expired session', async () => {
    const prisma = makePrisma();
    prisma.session.findUnique.mockResolvedValue({
      userId: 'u1',
      accessToken: 'a',
      refreshToken: null,
      idToken: null,
      expiresAt: new Date(Date.now() - 1000),
    });
    const svc = new SessionService(prisma as any, config);

    expect(await svc.validateBearerAndLoadUser('expired')).toBeNull();
    expect(prisma.session.delete).toHaveBeenCalledWith({ where: { id: 'expired' } });
  });

  it('loads the user for a valid session', async () => {
    const prisma = makePrisma();
    prisma.session.findUnique.mockResolvedValue({
      userId: 'u1',
      accessToken: 'a',
      refreshToken: null,
      idToken: null,
      expiresAt: new Date(Date.now() + 3600_000),
    });
    prisma.user.findUnique.mockResolvedValue({
      id: 'u1',
      keycloakId: 'kc',
      email: 'u@labmgm.org',
      name: 'U',
      avatarUrl: null,
      isAdmin: false,
    });
    const svc = new SessionService(prisma as any, config);

    const user = await svc.validateBearerAndLoadUser('ok');
    expect(user).toMatchObject({ id: 'u1', email: 'u@labmgm.org' });
  });
});
