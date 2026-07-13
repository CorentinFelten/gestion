import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { AuthService } from './auth.service';
import { AuthGuard } from '../../common/guards/auth.guard';
import { SESSION_COOKIE, resolveSecureCookies, setSessionCookie } from '../../common/session-cookie';
import { sessionIdleMs } from '../../common/session-timeouts';
import {
  CsrfGuard,
  CSRF_COOKIE,
  generateCsrfToken,
} from '../../common/guards/csrf.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import type { AuthenticatedUser, RequestWithUser } from '../../common/types/authenticated-user';
import {
  LoginSchema,
  RegisterSchema,
  type LoginDto,
  type RegisterDto,
} from './dto/auth.dto';

// Tight throttle on credential endpoints: 5 attempts / minute, then a 1-minute
// block (backoff) on the offending key. Sits on top of the global limiter.
const AUTH_THROTTLE = { default: { limit: 5, ttl: 60_000, blockDuration: 60_000 } };

/**
 * Auth endpoints (PLAN.md §6). Cookie sessions (httpOnly, SameSite=Lax) plus a
 * readable double-submit CSRF cookie for state-changing requests.
 */
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  /**
   * The session cookie is ROLLING: its expiry is the idle deadline (now + idle
   * window), re-issued on login/register here and on every authenticated request
   * by the AuthGuard, so the browser cookie lifetime tracks activity. The
   * server-side session carries the authoritative idle + absolute deadlines.
   */
  private issueSessionCookie(res: Response, sessionId: string): void {
    setSessionCookie(res, sessionId, new Date(Date.now() + sessionIdleMs()));
  }

  /**
   * Issue (or re-issue) the readable CSRF token. The SPA calls this before any
   * mutating request and echoes the value in the `X-CSRF-Token` header.
   */
  @Get('csrf')
  csrf(@Req() req: RequestWithUser, @Res({ passthrough: true }) res: Response) {
    const existing = (req.cookies as Record<string, string> | undefined)?.[CSRF_COOKIE];
    const token = existing ?? generateCsrfToken();
    res.cookie(CSRF_COOKIE, token, {
      httpOnly: false, // must be readable by the SPA to set the header
      sameSite: 'lax',
      secure: resolveSecureCookies(),
      path: '/',
    });
    return { csrfToken: token };
  }

  @Post('register')
  // The global APP_GUARD ThrottlerGuard (SEC-08) already runs on every route and
  // reads @Throttle below to apply the tighter 5/min limit here. A route-level
  // @UseGuards(ThrottlerGuard) would run the guard a *second* time and
  // double-count each request (halving the effective limit), so only CsrfGuard is
  // added at the route level.
  @UseGuards(CsrfGuard)
  @Throttle(AUTH_THROTTLE)
  async register(
    @Body(new ZodValidationPipe(RegisterSchema)) body: RegisterDto,
    @Req() req: RequestWithUser,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.auth.register(body, {
      userAgent: req.headers['user-agent'],
      ip: req.ip,
    });
    this.issueSessionCookie(res, result.sessionId);
    return { user: result.user };
  }

  @Post('login')
  @HttpCode(200)
  // See register: rely on the global ThrottlerGuard + @Throttle to avoid
  // double-counting; only CsrfGuard is applied at the route level.
  @UseGuards(CsrfGuard)
  @Throttle(AUTH_THROTTLE)
  async login(
    @Body(new ZodValidationPipe(LoginSchema)) body: LoginDto,
    @Req() req: RequestWithUser,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.auth.login(body, {
      userAgent: req.headers['user-agent'],
      ip: req.ip,
    });
    this.issueSessionCookie(res, result.sessionId);
    return { user: result.user };
  }

  @Post('logout')
  @HttpCode(204)
  @UseGuards(AuthGuard, CsrfGuard)
  async logout(@Req() req: RequestWithUser, @Res({ passthrough: true }) res: Response) {
    if (!req.sessionId) {
      throw new UnauthorizedException();
    }
    await this.auth.logout(req.sessionId);
    res.clearCookie(SESSION_COOKIE, { path: '/' });
  }

  @Get('me')
  @UseGuards(AuthGuard)
  async me(@CurrentUser() user: AuthenticatedUser) {
    return this.auth.me(user.id);
  }
}
