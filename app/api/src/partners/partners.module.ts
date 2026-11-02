import { Module } from '@nestjs/common';
import { IdrsModule } from '../idrs/idrs.module';
import { PartnersController } from './partners.controller';
import { EarthbeamApiModule } from '../earthbeam/api/earthbeam-api.module';

@Module({
  imports: [EarthbeamApiModule, IdrsModule],
  controllers: [PartnersController],
})
export class PartnersModule {}
