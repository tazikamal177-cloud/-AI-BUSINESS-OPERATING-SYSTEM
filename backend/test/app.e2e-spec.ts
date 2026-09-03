/**
 * AIBOS — End-to-end smoke test
 *
 * Exercises the core Phase 3 happy path against a real Postgres+Redis.
 *
 * Run:
 *   npm run db:reset          # fresh DB + RLS + seed
 *   npm run test:e2e
 *
 * Skip behavior:
 *   - If DATABASE_URL is not set, the entire suite is skipped (no DB).
 *   - If CI_REQUIRES_DB=true and DATABASE_URL is missing, the test
 *     FAILS LOUD (no silent skip in CI) — see CRITIQUE 4 follow-up.
 */
// Mock ConfigModule BEFORE importing AppModule so env validation does not
// throw at module load time. This lets describe.skip work properly.
jest.mock('@nestjs/config', () => {
  const actual = jest.requireActual('@nestjs/config');
  return {
    ...actual,
    ConfigModule: { forRoot: () => ({ module: class FakeConfigModule {}, global: true }) },
  };
});

import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe, VersioningType } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { HttpErrorFilter } from '../src/common/filters/http-error.filter';
import { RequestIdInterceptor } from '../src/common/interceptors/request-id.interceptor';
import { TenantInterceptor } from '../src/common/interceptors/tenant.interceptor';
import { AuditInterceptor } from '../src/modules/audit/audit.interceptor';

const hasDb = !!process.env.DATABASE_URL;
const ciRequiresDb = process.env.CI_REQUIRES_DB === 'true';
const skipReason = 'DATABASE_URL not set';
const conditionalDescribe = hasDb
  ? describe
  : ciRequiresDb
    ? () => { throw new Error(`[CRITIQUE 4 follow-up] ${skipReason} but CI_REQUIRES_DB=true`); }
    : describe.skip;

conditionalDescribe('AIBOS — E2E smoke (Phase 3)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const ownerEmail = `owner-${Date.now()}@test.local`;
  const memberEmail = `member-${Date.now()}@test.local`;
  const password = 'Sup3rPwd!';

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalInterceptors(
      app.get(RequestIdInterceptor),
      app.get(TenantInterceptor),
      app.get(AuditInterceptor),
    );
    app.useGlobalFilters(new HttpErrorFilter());
    await app.init();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    // Clean up the test users we created (best effort; FKs cascade)
    await prisma.user.deleteMany({ where: { email: { in: [ownerEmail, memberEmail] } } });
    await app.close();
  });

  it('health: /health returns ok', async () => {
    const res = await request(app.getHttpServer()).get('/api/health').expect(200);
    expect(res.body.status).toBe('ok');
  });

  it('readiness: /health/ready reports DB+Redis', async () => {
    const res = await request(app.getHttpServer()).get('/api/health/ready').expect(200);
    expect(res.body.checks.postgres.ok).toBe(true);
    expect(res.body.checks.redis.ok).toBe(true);
  });

  it('registers a user and creates default org', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({
        email: ownerEmail,
        password,
        firstName: 'Alice',
        lastName: 'Owner',
        organizationName: 'AliceCo',
      })
      .expect(201);
    expect(res.body.user.email).toBe(ownerEmail);
    expect(res.body.organization.slug).toMatch(/^aliceco/);
    expect(res.body.accessToken).toBeDefined();
    expect(res.body.refreshToken).toBeDefined();
  });

  it('me returns the user with memberships', async () => {
    const login = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: ownerEmail, password })
      .expect(200);
    const accessToken = login.body.accessToken;
    const me = await request(app.getHttpServer())
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
    expect(me.body.email).toBe(ownerEmail);
    expect(me.body.memberships.length).toBeGreaterThanOrEqual(1);
  });

  it('forgot-password always returns success (no enumeration)', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/forgot-password')
      .send({ email: 'nonexistent-' + Date.now() + '@test.local' })
      .expect(200);
    expect(res.body.message).toMatch(/sent/i);
  });

  it('invites a new email and accepts the invitation', async () => {
    const login = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: ownerEmail, password })
      .expect(200);
    const ownerToken = login.body.accessToken;
    const orgId = login.body.organization.id;

    // Invite
    const invite = await request(app.getHttpServer())
      .post(`/api/v1/organizations/${orgId}/members/invite`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('X-Organization-Id', orgId)
      .send({ email: memberEmail, role: 'OPERATOR' })
      .expect(201);
    expect(invite.body.existing).toBe(false);
    const token = invite.body.token;
    expect(token).toBeDefined();

    // Accept (peek at invite details — in real flow user would receive email)
    const accept = await request(app.getHttpServer())
      .post('/api/v1/invitations/accept')
      .send({ token })
      .expect(201);
    expect(accept.body.email).toBe(memberEmail);
    expect(accept.body.role).toBe('OPERATOR');
  });

  it('rejects access to another organization (cross-tenant)', async () => {
    // Owner creates a SECOND org
    const login = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: ownerEmail, password })
      .expect(200);
    const token = login.body.accessToken;

    const other = await request(app.getHttpServer())
      .post('/api/v1/organizations')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Other Org', slug: 'other-' + Date.now() })
      .expect(201);
    const otherId = other.body.id;

    // Try to read first org's members using the OTHER org id header
    const firstOrg = login.body.organization.id;
    const res = await request(app.getHttpServer())
      .get(`/api/v1/organizations/${firstOrg}/members`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Organization-Id', otherId)
      .expect(403); // not a member of "other" (or TenantGuard forbids)
  });
});
