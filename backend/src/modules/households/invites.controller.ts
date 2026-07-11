import { Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../../common/guards/auth.guard';
import { CsrfGuard } from '../../common/guards/csrf.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { InvitesService } from './invites.service';

/**
 * The invited user's side of the in-app invitation flow: view your own pending
 * invites, and accept/decline them. All routes are AuthGuard-scoped to the
 * current user; the service enforces that only the invited user may respond.
 */
@Controller()
@UseGuards(AuthGuard)
export class InvitesController {
  constructor(private readonly invites: InvitesService) {}

  // GET /me/invites, the current user's pending received invites.
  @Get('me/invites')
  async received(@CurrentUser('id') userId: string) {
    return this.invites.listReceived(userId);
  }

  // POST /invites/:id/accept, join the household (invited user only).
  @Post('invites/:id/accept')
  @UseGuards(CsrfGuard)
  async accept(@Param('id') id: string, @CurrentUser('id') userId: string) {
    return this.invites.accept(id, userId);
  }

  // POST /invites/:id/decline, decline the invite (invited user only).
  @Post('invites/:id/decline')
  @UseGuards(CsrfGuard)
  async decline(@Param('id') id: string, @CurrentUser('id') userId: string) {
    return this.invites.decline(id, userId);
  }
}
