import { Module } from '@nestjs/common';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { SessionService } from './session.service';

/**
 * Auth module. Exports SessionService in case other modules need session
 * introspection. AuthGuard lives in common/ and injects PrismaService directly.
 */
@Module({
  controllers: [AuthController],
  providers: [AuthService, SessionService],
  exports: [AuthService, SessionService],
})
export class AuthModule {}
