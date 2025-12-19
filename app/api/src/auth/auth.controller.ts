import { IPassportSession, toGetSessionDataDto } from '@edanalytics/models';
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Inject,
  Logger,
  Next,
  NotImplementedException,
  Param,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { randomUUID } from 'crypto';
import { Request, Response, NextFunction } from 'express';
import passport from 'passport';
import { Pool } from 'pg';
import { CustomNotFoundException } from '../utils/custom-exceptions';
import { Public } from './login/public.decorator';
import { ReqSession } from './helpers/session.decorator';
import { IdentityProviderService } from './login/identity-provider.service';
import { IdentityProvider, User } from '@prisma/client';

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  logger = new Logger('AuthController');
  constructor(
    private identityProviderService: IdentityProviderService,
    @Inject('DatabaseService') private pgPool: Pool
  ) {}

  @Public()
  @Get('/login')
  login(
    @Res() res: Response,
    @Req() req: Request,
    @Query('origin') origin: string | undefined,
    @Query('forceLogin') forceLogin: string | undefined,
    @Next() next: NextFunction
  ) {
    if (!origin) {
      throw new BadRequestException('Origin is required');
    }

    const idpReg = this.identityProviderService.idpRegistrationsForOrigin(origin);
    if (!idpReg?.config) {
      throw new BadRequestException('No IdP registration found for this origin');
    }
    passport.authenticate(this.identityProviderService.passportKey(idpReg.id), {
      state: Buffer.from(
        JSON.stringify({
          redirect: req.query?.redirect ?? '/',
          random: randomUUID(),
        })
      ).toString('base64url'),
      ...(forceLogin ? { prompt: 'login', tenant_code: 'null', partner_code: 'null' } : {}),
    })(req, res, next);
  }

  @Public()
  @Get('/callback/:idpId')
  async loginCallback(
    @Param('idpId') idpId: string,
    @Res() res: Response,
    @Req() req: Request,
    @Next() next: NextFunction
  ) {
    let redirect = '/';
    const idpRegistration = this.identityProviderService.idpRegistrationForId(idpId);
    if (!idpRegistration) {
      throw new CustomNotFoundException();
    }
    try {
      if (typeof req.query.state === 'string') {
        redirect = JSON.parse(Buffer.from(req.query.state, 'base64url').toString()).redirect;
      }
    } catch (error) {
      // no redirect
    }
    passport.authenticate(this.identityProviderService.passportKey(idpId), {
      successRedirect: `${idpRegistration.feHome}${redirect}`,
      failureRedirect: `${idpRegistration.feHome}/unauthenticated`,
      passReqToCallback: true,
    })(req, res, next);
  }

  @Post('logout')
  async logout(@ReqSession() user: { user: User }, @Res() res: Response, @Req() req: Request) {
    const idpId = user.user.idpId;
    const idpSessionId = req.session.passport?.user.idpSessionId;
    const idToken = req.session.passport?.user.idToken;

    req.session.destroy(async (err) => {
      if (err) {
        this.logger.error('Failed to terminate local session on logout request.');
      }
      const idpRegistration = this.identityProviderService.idpRegistrationForId(idpId);
      if (!idpRegistration) {
        throw new CustomNotFoundException();
      }
      const client = idpRegistration.client;

      // EdGraph and Keycloak require id_token_hint in order to bypass the logout confirmation page,
      // and id_token_hint works with Auth0/UM, too. HOWEVER(!), ID tokens from UM can be large because
      // they contain heimdall responses and other claims (e.g. tenant info, apps). This can cause issues
      // for browsers, proxies and other intermediaries. We need to ensure the ID token is small enough
      // to be included in a response header on this request (nginx issued 502s when I used a token that
      // was 4.3KB in development) and then be included in the query params of the URL when the client
      // redirects to the IdP. We're using 3KB as a limit here. That will stay under the nginx default
      // of a 4KB limit on a single header and leave plenty of room when it gets added to the URL, which
      // should be able to handle 8kb, per IETF RFC 9110 https://datatracker.ietf.org/doc/html/rfc9110#section-4.1-5.
      // Keycloak and EdGraph tokens seems to be under 3kb, so this should work for them. UM works fine
      // with logout_hint, so this works for UM, even if all UM tokens are over the 3kb limit.
      //
      // Note that we can't know exactly how large the ID token can be without causing issues, since that
      // depends on the browser and intermediaries, so we need to decide in which direction to err. We err
      // in the direction of NOT including the id_token_hint. If we exceed the limit, the request fails; either
      // Runway issues a 502 or the redirect is blocked. If we stay under the limit but do not include
      // the id_token_hint param, the user will still be redirected to their IdP and will get a logout
      // confirmation page, allowing them to complete their logout. Omitting the id_token_hint param
      // when we're uncertain allows the user to still log out, so that's what we do.
      const hint =
        idToken && new TextEncoder().encode(idToken).length / 1024 < 3 // 3KB limit
          ? `&id_token_hint=${idToken}`
          : idpSessionId
          ? `&logout_hint=${idpSessionId}`
          : '';
      res.setHeader(
        'location',
        client.endSessionUrl() +
          '&post_logout_redirect_uri=' +
          encodeURIComponent(idpRegistration.feHome) +
          hint
      );
      // Issue a 200 and allow caller to handle the redirect since a 303 results in a CORS error.
      res.status(200).send("Redirect to 'location' header");
    });
  }

  @Public()
  @Post('/backchannel-logout/:idpId')
  async backchannelLogout(
    @Param('idpId') idpId: IdentityProvider['id'],
    @Body() { logout_token }: { logout_token: string }
  ) {
    throw new NotImplementedException('Backchannel logout is not implemented');

    /**
     * The below code needs to be tested and reviewed to make sure it works
     * as intented. I spent some time trying to get it ot work locally, but
     * I'm having issues initiating the backchannel logout from Keycloak.
     *
     * Rather than expose untested auth-related functionality, we'll throw
     * an error and implement when/if we need it and can confirm it works.
     */

    // const validateTokenResult = await this.identityProviderService.validateJwt(logout_token);

    // if (validateTokenResult.status === 'VALID_TOKEN') {
    //   const iss = validateTokenResult.token.payload.iss;
    //   const deleteResults = await this.pgPool.query(
    //     `DELETE FROM "appsession"."session" where "sess"->'passport'->'user'->'idpId' = $1 AND "sess"->'passport'->'user'->'idpSessionId' = $2`,
    //     [idpId, logout_token]
    //   );
    // } else if (validateTokenResult.status === 'INVALID_TOKEN') {
    //   throw new CustomUnauthorizedException();
    // } else if (validateTokenResult.status === 'TOKEN_ISSUER_NOT_REGISTERED') {
    //   throw new CustomUnauthorizedException();
    // }
  }

  @Get('me')
  async me(@ReqSession() passportSession: IPassportSession) {
    return toGetSessionDataDto(passportSession);
  }
}
