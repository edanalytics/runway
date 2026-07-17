import { Module } from '@nestjs/common';
import { SchoolYearConfigController } from './school-year-config.controller';
import { FileModule } from '../files/file.module';

@Module({
  imports: [FileModule],
  controllers: [SchoolYearConfigController],
})
export class SchoolYearConfigModule {}
