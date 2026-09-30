import { Module } from '@nestjs/common';
import { EdfiService } from './edfi.service';
import { HttpModule } from '@nestjs/axios';
import { AppConfigModule } from '../config/app-config.module';

@Module({
  imports: [HttpModule, AppConfigModule],
  providers: [EdfiService],
  exports: [EdfiService],
})
export class EdfiModule {
  //TODO: allow swapping a mock service in for testing or running locally
}
