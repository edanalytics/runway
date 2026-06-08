import { Module } from '@nestjs/common';
import { PartnersController } from './partners.controller';
import { EarthbeamApiModule } from '../earthbeam/api/earthbeam-api.module';

@Module({
  imports: [EarthbeamApiModule],
  providers: [],
  controllers: [PartnersController],
})
export class PartnersModule {}
