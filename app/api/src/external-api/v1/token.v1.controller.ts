import { Public } from 'api/src/auth/login/public.decorator';
import { ExternalApiTokenGuard } from '../auth/external-api-token.guard';
import { Controller, Header, Post, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiBearerAuth } from '@nestjs/swagger';
import { ExternalApiScope, ExternalApiScopeType } from '../auth/external-api-scope.decorator';
import { ExternalApiScopes } from '../external-api-token-scopes.decorator';
import { extractAllowedPartnerCodesFromScopes } from '../auth/external-api-partner-scope.helpers';

/**
 * Partner codes are validated against this before being interpolated into the
 * verify response, which echoes them back to the caller.
 *
 * User management only emits alphanumeric partner IDs, but Partner.id is an
 * unconstrained VarChar and IDs in use include hyphens, so the pattern stays
 * permissive rather than matching that guarantee exactly. It only has to be
 * narrow enough that an echoed value is inert.
 *
 * Validated here rather than in extractAllowedPartnerCodesFromScopes on
 * purpose: that helper also backs isPartnerAllowed, where dropping an
 * unrecognized code would silently deny access rather than just omit it from a
 * message.
 */
const PARTNER_CODE_PATTERN = /^[A-Za-z0-9_-]+$/;

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
  // Pinned because this response echoes token content: without it a plain
  // string return is served as a type the browser will interpret. Paired with
  // PARTNER_CODE_PATTERN above.
  @Header('Content-Type', 'text/plain; charset=utf-8')
  @ExternalApiScope('create:jobs') // might need to change this scope to something else later, but currently all endpoints require create:jobs so all usable tokens will need that scope, too
  async verifyToken(@ExternalApiScopes() scopes: ExternalApiScopeType[]) {
    const allowedPartnerCodes = extractAllowedPartnerCodesFromScopes(scopes).filter((code) =>
      PARTNER_CODE_PATTERN.test(code)
    );
    return allowedPartnerCodes.length === 0
      ? 'Token is valid for no partners. No scope of the form "partner:partner-code" was found on the token.'
      : allowedPartnerCodes.length === 1
      ? 'Token is valid for partner: ' + allowedPartnerCodes[0]
      : 'Token is valid for partners: ' + allowedPartnerCodes.join(', ');
  }
}
