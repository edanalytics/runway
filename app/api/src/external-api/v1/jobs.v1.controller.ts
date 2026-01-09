import { Controller, ForbiddenException, Inject, Param, Post, UseGuards } from '@nestjs/common';
import { Public } from 'api/src/auth/login/public.decorator';
import { JobsService } from 'api/src/jobs/jobs.service';
import { ExternalApiTokenGuard } from '../auth/external-api-token.guard';
import { ExternalApiScope, ExternalApiScopeType } from '../auth/external-api-scope.decorator';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ExternalApiScopes } from '../external-api-token-scopes.decorator';
import { PrismaClient } from '@prisma/client';
import { PRISMA_READ_ONLY } from 'api/src/database/database.service';
import { isPartnerAllowed } from '../auth/external-api-partner-scope.helpers';

@Controller('jobs')
@ApiTags('External API - Jobs')
@ApiBearerAuth() // Does not impact actual auth. Rather, it tells Swagger to include a bearer token when sending requests to these endpoints.
@Public() // do not require a session
@UseGuards(ExternalApiTokenGuard) // but do require a valid token
export class ExternalApiV1JobsController {
  constructor(
    private readonly jobsService: JobsService,
    @Inject(PRISMA_READ_ONLY) private readonly prismaRO: PrismaClient
  ) {}

  @Post(':partnerCode/:tenantCode')
  @ExternalApiScope('create:jobs')
  async initialize(
    @ExternalApiScopes() scopes: ExternalApiScopeType[],
    @Param('partnerCode') partnerCode: string,
    @Param('tenantCode') tenantCode: string
  ) {
    // ensure there's a scope that matches the partner code from the request
    if (!isPartnerAllowed(scopes, partnerCode)) {
      throw new ForbiddenException(`Invalid partner code: ${partnerCode}`);
    }

    const tenant = this.prismaRO.tenant.findUnique({
      where: {
        code_partnerId: {
          code: tenantCode,
          partnerId: partnerCode,
        },
      },
    });

    if (!tenant) {
      throw new ForbiddenException(
        `Invalid tenant code: ${tenantCode} for partner: ${partnerCode}`
      );
    }

    // TODO: all the stuff:
    // 2. check other inputs
    // 3. create the job
    return 'ok';
  }
}
