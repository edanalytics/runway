import { toGetSchoolYearDto } from '@edanalytics/models';
import { Controller, Get, Inject } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PrismaClient } from '@prisma/client';
import { PRISMA_APP_USER } from '../database';

@ApiTags('SchoolYear')
@Controller()
export class SchoolYearsController {
  constructor(@Inject(PRISMA_APP_USER) private prisma: PrismaClient) {}

  @Get()
  async findAll() {
    // Currently, just returns the school years used throughout the app.
    // If we someday do tenant or partner-specific years, this could be
    // modified to retrieve those based on the session context.
    // return toGetBigThingyDto(await this.prisma.bigThingy.findMany());
    return toGetSchoolYearDto(
      await this.prisma.schoolYear.findMany({ orderBy: { startYear: 'desc' } })
    );
  }
}
