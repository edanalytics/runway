/* eslint-disable */

import { Test, TestingModule } from '@nestjs/testing';
import { ClassSerializerInterceptor, ValidationPipe } from '@nestjs/common';
import { AppModule } from '../../../../src/app/app.module';
import expressSession from 'express-session';
import passport from 'passport';
import sessionStore from '../../session/session-store';
import { Reflector } from '@nestjs/core';
import { FileService } from 'api/src/files/file.service';
import { prepareMockOIDC } from '../../oidc/openid-client-mock';
import { initExternalApiTokenMock, getLocalJWKS } from '../../external-api/token-helper';
import { ExternalApiAuthService } from '../../../../src/external-api/auth/external-api.auth.service';

// For the most part, this mimics the bootstrapping done in src/main.ts,
// with some modifications to accommodate the fact that this app is used
// in integrration tests. For example we don't need to worry about CORS.
export const initApp = async function () {
  try {
    // create the test app instance
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(FileService) // S3 mock
      .useValue({
        getPresignedUploadUrl: jest
          .fn()
          .mockImplementation((f) => Promise.resolve(`s3-test-upload-url://${f.fullPath}`)),
        getPresignedDownloadUrl: jest
          .fn()
          .mockImplementation((f) => Promise.resolve(`s3-test-download-url://${f.fullPath}`)),
        listFilesAtPath: jest.fn().mockResolvedValue(['test-file-1', 'test-file-2']),
      })
      .compile();

    prepareMockOIDC(); // mock openid-client, must be called before app is created

    // Mock external API token verification to use local test keys
    await initExternalApiTokenMock();
    const externalApiAuthService = moduleFixture.get(ExternalApiAuthService);
    jest.spyOn(externalApiAuthService, 'getKeySet').mockResolvedValue(getLocalJWKS());

    const app = moduleFixture.createNestApplication();

    app.use(
      expressSession({
        store: sessionStore.client(),
        secret: 'my-secret',
        resave: false,
        saveUninitialized: false,
        cookie: { secure: 'auto' },
      })
    );
    app.use(passport.initialize());
    app.use(passport.session());
    passport.serializeUser((user, done) => {
      done(null, user);
    });
    passport.deserializeUser<Express.User>((user, done) => {
      done(null, user);
    });

    app.useGlobalPipes(new ValidationPipe({ transform: true, stopAtFirstError: false }));
    app.useGlobalInterceptors(
      new ClassSerializerInterceptor(app.get(Reflector), {
        excludeExtraneousValues: true,
      })
    );

    await app.init();
    return app;
  } catch (error) {
    console.error('❌ Failed to initialize NestJS test app:', error);
    throw error;
  }
};
