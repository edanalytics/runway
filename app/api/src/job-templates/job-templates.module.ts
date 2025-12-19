import { Module } from '@nestjs/common';
import { JobsTemplatesController } from './job-templates.controller';
import { EarthbeamModule } from '../earthbeam/earthbeam.module';

@Module({
  imports: [EarthbeamModule],
  providers: [],
  controllers: [JobsTemplatesController],
})
export class JobTemplatesModule {}
