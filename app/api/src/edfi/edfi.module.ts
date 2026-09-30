import { Module } from '@nestjs/common';
import { EdfiService } from './edfi.service';
import { HttpModule } from '@nestjs/axios';

@Module({
  imports: [HttpModule],
  providers: [EdfiService],
  exports: [EdfiService],
})
export class EdfiModule {
  //TODO: allow swapping a mock service in for testing or running locally
}
