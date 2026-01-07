import { Controller, ForbiddenException, Post, Req, UseGuards } from '@nestjs/common';
import { Public } from 'api/src/auth/login/public.decorator';
import { JobsService } from 'api/src/jobs/jobs.service';
import { ExternalApiTokenGuard } from '../external-api-token.guard';
import { ExternalApiScope } from '../external-api-scope.decorator';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { TokenPayload } from '../external-api-token-payload.decorator';
import { ExternalApiTokenPayload } from 'api/src/types/express';

@Controller('jobs')
@ApiTags('External API - Jobs')
@ApiBearerAuth() // Does not impact actual auth. Rather, it tells Swagger to include a bearer token when sending requests to these endpoints.
@Public() // do not require a session
@UseGuards(ExternalApiTokenGuard) // but do require a valid token
export class ExternalApiJobsV1Controller {
  constructor(private readonly jobsService: JobsService) {}

  @Post()
  @ExternalApiScope('create:jobs')
  async initialize(@TokenPayload() token: ExternalApiTokenPayload) {
    // TODO: all the stuff:
    // 1. validate partner + tenant
    // 2. check other inputs
    // 3. create the job
    return 'ok';
  }
}
