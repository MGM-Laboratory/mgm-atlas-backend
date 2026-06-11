import { INestApplication, ValidationPipe, VersioningType } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';

/**
 * Boot the real AppModule against the Postgres service container (migrations
 * are applied by the CI step before this runs) and exercise the public surface
 * plus the Phase 0 auth rejection. No external network: the garbage-token
 * login fails at decode, before any JWKS call, so dummy Keycloak env is fine.
 */
describe('App (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    // Match main.ts exactly: prefix 'api' + URI versioning '1' => /api/v1/...
    app.setGlobalPrefix('api');
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
  });

  it('GET /api/v1/version returns build identity', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/version').expect(200);
    expect(res.body).toHaveProperty('sha');
    expect(res.body).toHaveProperty('version');
  });

  it('GET /api/v1/feature-flags returns an object (DB-backed)', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/feature-flags').expect(200);
    expect(typeof res.body).toBe('object');
  });

  it('POST /api/v1/auth/login rejects a forged/garbage token (Phase 0)', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ keycloakId: 'x', email: 'x@evil.test', name: 'x', accessToken: 'not.a.jwt' })
      .expect(401);
  });

  it('POST /api/v1/auth/login rejects an empty token (validation)', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ keycloakId: 'x', email: 'x@evil.test', name: 'x', accessToken: '' })
      .expect(400);
  });

  it('GET /api/v1/auth/session without a bearer is unauthorized', async () => {
    await request(app.getHttpServer()).get('/api/v1/auth/session').expect(401);
  });

  it('GET /api/v1/metrics is disabled (404) when METRICS_TOKEN is unset', async () => {
    await request(app.getHttpServer()).get('/api/v1/metrics').expect(404);
  });
});
