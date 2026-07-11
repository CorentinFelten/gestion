import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Role } from '@prisma/client';
import type { RequestWithUser } from '../../common/types/authenticated-user';
import { AuthGuard } from '../../common/guards/auth.guard';
import { HouseholdMemberGuard } from '../../common/guards/household-member.guard';
import { RoleGuard } from '../../common/guards/role.guard';
import { CsrfGuard } from '../../common/guards/csrf.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { HouseholdsService } from './households.service';
import { InvitesService } from './invites.service';
import {
  CreateHouseholdSchema,
  CreateInviteSchema,
  UpdateHouseholdSchema,
  type CreateHouseholdDto,
  type CreateInviteDto,
  type UpdateHouseholdDto,
} from './dto/household.dto';

/**
 * Singular alias (PLAN.md §12 single-household simplification): `GET /household`
 * returns the caller's one household, or 404 if they have none. Some frontend
 * flows resolve the household this way rather than taking the array's first item.
 */
@Controller('household')
@UseGuards(AuthGuard)
export class HouseholdController {
  constructor(private readonly households: HouseholdsService) {}

  @Get()
  async getMine(@CurrentUser('id') userId: string) {
    const list = await this.households.listForUser(userId);
    if (list.length === 0) {
      throw new NotFoundException('No household');
    }
    return list[0];
  }
}

@Controller('households')
@UseGuards(AuthGuard)
export class HouseholdsController {
  constructor(
    private readonly households: HouseholdsService,
    private readonly invites: InvitesService,
  ) {}

  @Get()
  async list(@CurrentUser('id') userId: string) {
    return this.households.listForUser(userId);
  }

  @Post()
  @UseGuards(CsrfGuard)
  async create(
    @CurrentUser('id') userId: string,
    @Body(new ZodValidationPipe(CreateHouseholdSchema)) body: CreateHouseholdDto,
  ) {
    return this.households.create(userId, body);
  }

  @Get(':id')
  @UseGuards(HouseholdMemberGuard)
  async getOne(@Param('id') id: string, @CurrentUser('id') userId: string) {
    return this.households.getById(id, userId);
  }

  // Global household settings (name + base currency) may be managed by ANY member
  // of the household (product decision), not just owner/admin, so only membership
  // (HouseholdMemberGuard) + CSRF are required, no RoleGuard. Destructive membership
  // moderation (member removal, admin invites) remains role-gated below.
  @Patch(':id')
  @UseGuards(HouseholdMemberGuard, CsrfGuard)
  async update(
    @Param('id') id: string,
    @CurrentUser('id') userId: string,
    @Body(new ZodValidationPipe(UpdateHouseholdSchema)) body: UpdateHouseholdDto,
  ) {
    return this.households.update(id, body, userId);
  }

  @Get(':id/members')
  @UseGuards(HouseholdMemberGuard)
  async members(@Param('id') id: string) {
    return this.households.listMembers(id);
  }

  @Delete(':id/members/:userId')
  @HttpCode(204)
  @UseGuards(HouseholdMemberGuard, RoleGuard, CsrfGuard)
  @Roles('owner', 'admin')
  async removeMember(
    @Param('id') id: string,
    @Param('userId') userId: string,
    @CurrentUser('id') actorUserId: string,
  ) {
    await this.households.removeMember(id, userId, actorUserId);
  }

  // Registered users the owner/admin may invite (no household, no pending invite here).
  @Get(':id/invitable-users')
  @UseGuards(HouseholdMemberGuard, RoleGuard)
  @Roles('owner', 'admin')
  async invitableUsers(@Param('id') id: string) {
    return this.invites.invitableUsers(id);
  }

  // Pending invites sent for this household (owner/admin management view).
  @Get(':id/invites')
  @UseGuards(HouseholdMemberGuard, RoleGuard)
  @Roles('owner', 'admin')
  async listInvites(@Param('id') id: string) {
    return this.invites.listSent(id);
  }

  @Post(':id/invites')
  @UseGuards(HouseholdMemberGuard, RoleGuard, CsrfGuard)
  @Roles('owner', 'admin')
  async invite(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(CreateInviteSchema)) body: CreateInviteDto,
    @CurrentUser('id') actorUserId: string,
    @Req() req: RequestWithUser & { householdRole?: Role },
  ) {
    // HouseholdMemberGuard attaches the caller's role; the service uses it to
    // ensure only an owner may grant an admin role (SEC-03).
    return this.invites.create(id, body, req.householdRole as Role, actorUserId);
  }

  @Delete(':id/invites/:inviteId')
  @HttpCode(204)
  @UseGuards(HouseholdMemberGuard, RoleGuard, CsrfGuard)
  @Roles('owner', 'admin')
  async revokeInvite(@Param('id') id: string, @Param('inviteId') inviteId: string) {
    await this.invites.revoke(id, inviteId);
  }
}
