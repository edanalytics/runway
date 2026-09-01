import { Controller, Get, Param, ParseIntPipe, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { toGetOutputFileDto } from '@edanalytics/models';
import { OutputFilesService } from './output-files.service';
import { TenantOwnershipGuard } from '../auth/authorization/tenant-ownership.guard';
import { TenantResourceKey } from '../auth/authorization/tenant-resource-key.decorator';
import { Authorize } from '../auth/helpers/authorize.decorator';
import { AllowMetatenant } from '../auth/authorization/allow-metatenant.decorator';

@Controller()
@ApiTags('Output Files')
@TenantResourceKey('job')
@UseGuards(TenantOwnershipGuard)
export class OutputFilesController {
  constructor(private outputFilesService: OutputFilesService) {}

  @Get(':jobId')
  @AllowMetatenant('job.metatenant.output-files.read')
  @Authorize('job.output-files.read')
  async findByJobId(@Param('jobId', new ParseIntPipe()) jobId: number) {
    const files = await this.outputFilesService.findByJobId(jobId);
    return toGetOutputFileDto(files);
  }
}
