import { Module } from '@nestjs/common';
import { HouseholdsService } from './households.service';
import { InvitesService } from './invites.service';
import { HouseholdController, HouseholdsController } from './households.controller';
import { InvitesController } from './invites.controller';

@Module({
  controllers: [HouseholdController, HouseholdsController, InvitesController],
  providers: [HouseholdsService, InvitesService],
  exports: [HouseholdsService, InvitesService],
})
export class HouseholdsModule {}
