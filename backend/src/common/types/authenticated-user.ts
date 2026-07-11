import type { Request } from 'express';

/**
 * The shape attached to `req.user` by AuthGuard after a valid session.
 * Feature agents read this via the `@CurrentUser()` decorator.
 */
export interface AuthenticatedUser {
  id: string;
  email: string;
  displayName: string;
  preferredCurrency: string;
  locale: string;
}

export interface RequestWithUser extends Request {
  user?: AuthenticatedUser;
  sessionId?: string;
}
