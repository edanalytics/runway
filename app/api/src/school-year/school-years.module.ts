import { Module } from '@nestjs/common';
import { SchoolYearsController } from './school-years.controller';

@Module({
  controllers: [SchoolYearsController],
})
export class SchoolYearsModule {}
