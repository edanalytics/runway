import { Controller, Get, Param, ParseIntPipe, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { toGetOutputFileDto } from '@edanalytics/models';
import { OutputFilesService } from './output-files.service';
import { TenantOwnershipGuard } from '../auth/authorization/tenant-ownership.guard';
import { TenantResourceKey } from '../auth/authorization/tenant-resource-key.decorator';

@Controller()
@ApiTags('Output Files')
@TenantResourceKey('job')
@UseGuards(TenantOwnershipGuard)
export class OutputFilesController {
  constructor(private outputFilesService: OutputFilesService) {}

  @Get(':jobId')
  async findByJobId(@Param('jobId', new ParseIntPipe()) jobId: number) {
    const files = await this.outputFilesService.findByJobId(jobId);
    return toGetOutputFileDto(files);
  }
}
