import { Module } from '@nestjs/common';
import { SchoolYearConfigController } from './school-year-config.controller';

@Module({
  controllers: [SchoolYearConfigController],
})
export class SchoolYearConfigModule {}
