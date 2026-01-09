import { Public } from 'api/src/auth/login/public.decorator';
import { ExternalApiTokenGuard } from '../auth/external-api-token.guard';
import { Controller, Post, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiBearerAuth } from '@nestjs/swagger';
import { ExternalApiScope } from '../auth/external-api-scope.decorator';

@Controller('token')
@ApiTags('External API - Token')
@ApiBearerAuth() // Does not impact actual auth. Rather, it tells Swagger to include a bearer token when sending requests to these endpoints.
@Public() // do not require a session
@UseGuards(ExternalApiTokenGuard) // but do require a valid token
export class ExternalApiV1TokenController {
  @ApiOperation({
    summary: 'Verify a token',
    description:
      "Endpoint that can be used to verify the a token without performing any operations in the system. Note that this endpoint requires the 'create:jobs' scope.",
  })
  @Post('verify')
  @ExternalApiScope('create:jobs') // might need to change this scope to something else later, but currently all endpoints require create:jobs so all usable tokens will need that scope, too
  async verifyToken() {
    return 'ok';
  }
}
