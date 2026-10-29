import { Module } from '@nestjs/common';
import { OptionGroupsController } from './option-groups.controller.js';
import { OptionGroupsService } from './option-groups.service.js';

@Module({
  controllers: [OptionGroupsController],
  providers: [OptionGroupsService],
  exports: [OptionGroupsService],
})
export class OptionsModule {}
