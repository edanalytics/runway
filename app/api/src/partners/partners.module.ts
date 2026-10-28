import { Module } from '@nestjs/common';
import { IdrsModule } from '../idrs/idrs.module';
import { PartnerMatchingModeService } from './partner-matching-mode.service';
import { PartnersController } from './partners.controller';
import { EarthbeamApiModule } from '../earthbeam/api/earthbeam-api.module';

@Module({
  imports: [EarthbeamApiModule, IdrsModule],
  providers: [PartnerMatchingModeService],
  controllers: [PartnersController],
})
export class PartnersModule {}
