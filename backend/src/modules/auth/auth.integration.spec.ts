import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ThrottlerModule } from '@nestjs/throttler';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { SessionService } from './session.service';
import { PrismaService } from '../../prisma/prisma.service';

/** In-memory Prisma double sufficient for the full register→login→me HTTP flow. */
function makeFakePrisma() {
  const users = new Map<string, any>();
  const sessions = new Map<string, any>();
  let seq = 0;
  const id = () => `id_${++seq}`;
  return {
    user: {
      findUnique: async ({ where }: any) => {
        if (where.id) return users.get(where.id) ?? null;
        if (where.email) return [...users.values()].find((u) => u.email === where.email) ?? null;
        return null;
      },
      create: async ({ data }: any) => {
        const u = {
          id: id(),
          avatarUrl: null,
          preferredCurrency: 'EUR',
          pinnedCurrencies: [],
          locale: 'en-US',
          isActive: true,
          createdAt: new Date(),
          updatedAt: new Date(),
          ...data,
        };
        users.set(u.id, u);
        return u;
      },
    },
    session: {
      create: async ({ data }: any) => {
        const s = { id: id(), createdAt: new Date(), userAgent: null, ip: null, ...data };
        sessions.set(s.id, s);
        return s;
      },
      findUnique: async ({ where, include }: any) => {
        const s = sessions.get(where.id);
        if (!s) return null;
        return include?.user ? { ...s, user: users.get(s.userId) } : s;
      },
      deleteMany: async ({ where }: any) => {
        if (where.id) sessions.delete(where.id);
        else if (where.userId) {
          for (const [k, v] of sessions) if (v.userId === where.userId) sessions.delete(k);
        }
        return { count: 0 };
      },
    },
  };
}

describe('Auth flow (integration): register → login → me', () => {
  let app: INestApplication;
  let prevCookieSecure: string | undefined;

  beforeAll(async () => {
    // This suite drives the app over plain HTTP (supertest). Post-SEC-02 the
    // session/CSRF cookies are Secure-by-default unless COOKIE_SECURE/APP_URL say
    // otherwise; a Secure cookie is not echoed back over HTTP, so declare the
    // local-HTTP dev knob explicitly (same as a LAN HTTP deploy), this keeps the
    // control intact (production/HTTPS still gets Secure) while matching transport.
    prevCookieSecure = process.env.COOKIE_SECURE;
    process.env.COOKIE_SECURE = 'false';

    const moduleRef = await Test.createTestingModule({
      imports: [ThrottlerModule.forRoot([{ ttl: 60_000, limit: 1000 }])],
      controllers: [AuthController],
      providers: [
        AuthService,
        SessionService,
        { provide: PrismaService, useValue: makeFakePrisma() },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    await app.init();
  });

  afterAll(async () => {
    await app.close();
    if (prevCookieSecure === undefined) delete process.env.COOKIE_SECURE;
    else process.env.COOKIE_SECURE = prevCookieSecure;
  });

  it('completes the full cookie + CSRF authenticated flow', async () => {
    const agent = request.agent(app.getHttpServer());

    // 1. Fetch a CSRF token (sets the readable gestion_csrf cookie on the agent).
    const csrfRes = await agent.get('/auth/csrf').expect(200);
    const csrf: string = csrfRes.body.csrfToken;
    expect(csrf).toHaveLength(64);

    // 2. Register, requires the CSRF header; sets an httpOnly session cookie.
    const registerRes = await agent
      .post('/auth/register')
      .set('X-CSRF-Token', csrf)
      .send({ email: 'Test@Example.com', password: 'password123', displayName: 'Tester' })
      .expect(201);
    expect(registerRes.body.user.email).toBe('test@example.com');
    expect(registerRes.body.user).not.toHaveProperty('passwordHash');
    const setCookie = registerRes.headers['set-cookie'] as unknown as string[];
    expect(setCookie.some((c) => c.startsWith('gestion_session='))).toBe(true);
    expect(setCookie.some((c) => /gestion_session=.*HttpOnly/i.test(c))).toBe(true);

    // 3. GET /auth/me with the session cookie, returns the current user.
    const meAfterRegister = await agent.get('/auth/me').expect(200);
    expect(meAfterRegister.body.email).toBe('test@example.com');

    // 4. Reject a mutating request that is missing the CSRF header.
    await agent
      .post('/auth/login')
      .send({ email: 'test@example.com', password: 'password123' })
      .expect(403);

    // 5. Login with the CSRF header, rotates the session cookie.
    const loginRes = await agent
      .post('/auth/login')
      .set('X-CSRF-Token', csrf)
      .send({ email: 'test@example.com', password: 'password123' })
      .expect(200);
    expect(loginRes.body.user.displayName).toBe('Tester');

    // 6. Wrong password is rejected.
    await agent
      .post('/auth/login')
      .set('X-CSRF-Token', csrf)
      .send({ email: 'test@example.com', password: 'nope-wrong' })
      .expect(401);

    // 7. me still works with the rotated session.
    await agent.get('/auth/me').expect(200);
  });
});
