import { Body, Controller, Get, Param, Patch, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../../common/guards/auth.guard';
import { CsrfGuard } from '../../common/guards/csrf.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { UsersService } from './users.service';
import { UpdateProfileSchema, type UpdateProfileDto } from './dto/user.dto';

@Controller()
@UseGuards(AuthGuard)
export class UsersController {
  constructor(private readonly users: UsersService) {}

  // GET /users/me, full private profile of the authenticated user.
  @Get('users/me')
  async getMe(@CurrentUser('id') userId: string) {
    return this.users.getProfile(userId);
  }

  // PATCH /users/me, update own profile (name, avatar, preferred currency, locale).
  @Patch('users/me')
  @UseGuards(CsrfGuard)
  async updateMe(
    @CurrentUser('id') userId: string,
    @Body(new ZodValidationPipe(UpdateProfileSchema)) body: UpdateProfileDto,
  ) {
    return this.users.updateProfile(userId, body);
  }

  // GET /users/:id, public display info, scoped to co-members of the caller.
  @Get('users/:id')
  async getOne(@CurrentUser('id') callerId: string, @Param('id') id: string) {
    return this.users.getPublicProfile(callerId, id);
  }
}
