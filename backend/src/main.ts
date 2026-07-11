import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Logger, ValidationPipe } from '@nestjs/common';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';

async function bootstrap(): Promise<void> {
  const isProd = process.env.NODE_ENV === 'production';

  // ── Production startup guards (SEC-06) ─────────────────────────────────────
  // Refuse to boot in production while critical secrets are still the shipped
  // `change-me…` placeholders. Guarded to production so dev/test envs (which use
  // throwaway values) are unaffected. Generate real values: `openssl rand -hex 32`.
  if (isProd) {
    const placeholders = (
      [
        ['POSTGRES_PASSWORD', process.env.POSTGRES_PASSWORD],
        ['DATABASE_URL', process.env.DATABASE_URL],
      ] as const
    )
      .filter(([, value]) => value?.includes('change-me'))
      .map(([name]) => name);
    if (placeholders.length > 0) {
      throw new Error(
        `Refusing to start in production: placeholder secret(s) still set: ` +
          `${placeholders.join(', ')}. Set real values (e.g. \`openssl rand -hex 32\`).`,
      );
    }
  }

  // ── CORS origin (SEC-07): fail closed ──────────────────────────────────────
  // Never reflect-any-origin-with-credentials. APP_URL is the single trusted
  // origin and is required in production. In dev it falls back to the Vite dev
  // server origin, never to `true`.
  const appUrl = process.env.APP_URL;
  if (isProd && !appUrl) {
    throw new Error(
      'Refusing to start in production: APP_URL is required as the CORS allow-list origin.',
    );
  }
  const corsOrigin = appUrl ?? 'http://localhost:5173';

  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: false,
  });

  // Caddy fronts /api as a single reverse proxy. Trust exactly one proxy hop so
  // Express derives `req.ip` and `req.protocol` from `X-Forwarded-For` /
  // `X-Forwarded-Proto` instead of the proxy's own socket address. Without this
  // the ThrottlerGuard buckets every client under the proxy IP (one shared rate
  // limit) and Session.ip audits the proxy rather than the real client.
  app.set('trust proxy', 1);

  // Security headers.
  app.use(helmet());

  // Cookie parsing (session cookie auth).
  app.use(cookieParser());

  // Same-origin deployment (Caddy proxies /api → backend). Credentials on so the
  // session cookie flows. Explicit allow-list origin, no reflect-any fallback.
  app.enableCors({
    origin: corsOrigin,
    credentials: true,
  });

  // Global validation (class-validator DTOs). Zod-based routes use ZodValidationPipe.
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: false,
    }),
  );

  // Consistent error envelope everywhere.
  app.useGlobalFilters(new AllExceptionsFilter());

  // All routes under /api/v1.
  app.setGlobalPrefix('api/v1');

  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port, '0.0.0.0');
  new Logger('Bootstrap').log(`Backend listening on http://0.0.0.0:${port}/api/v1`);
}

void bootstrap();
