import { ClassSerializerInterceptor, Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory, Reflector } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import pg from 'pg';
import pgSession from 'connect-pg-simple';
import session from 'express-session';
import passport from 'passport';
import { AppModule } from './app/app.module';
import { AppConfigService } from './config/app-config.service';
import { migrate } from './database';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const globalPrefix = 'api';
  const configService = app.get(AppConfigService);

  const pgConfig = await configService.postgresPoolConfig();
  const pgPool = new pg.Pool(pgConfig);

  const existingSchema = await pgPool.query(
    "select schema_name from information_schema.schemata where schema_name = 'appsession'"
  );
  if (existingSchema.rowCount === 0) await pgPool.query('create schema appsession');

  if (!pgConfig.database) {
    throw new Error('Must specify database to run migrations.');
  }
  await migrate(pgPool, pgConfig.database);

  app.use(
    session({
      store: new (pgSession(session))({
        createTableIfMissing: true,
        pool: pgPool,
        schemaName: 'appsession',
        ttl: 60 * 60 * 2, // 2hr (if omitted defaults to 24hr)
      }),
      // cryptographic signing is not necessary here. expressSession is very generic and there are other ways of using it for which signing is important.
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

  app.setGlobalPrefix(globalPrefix);
  app.useGlobalPipes(new ValidationPipe({ transform: true, stopAtFirstError: false }));

  const idpRows = await pgPool.query(
    'select fe_home from identity_provider where fe_home is not null'
  );
  if (idpRows.rowCount === 0) {
    // still boot since we the api could still be used
    Logger.error('No FE hosts found in identity_provider table');
  }
  app.enableCors({
    origin: idpRows.rows.map((row) => row.fe_home),
    credentials: true,
    exposedHeaders: 'location',
  });
  app.useGlobalInterceptors(
    new ClassSerializerInterceptor(app.get(Reflector), {
      excludeExtraneousValues: true,
    })
  );

  const port = process.env.PORT || 3333;
  if (process.env.NODE_ENV === 'development') {
    const config = new DocumentBuilder()
      .setTitle('Runway')
      .setDescription('Endpoints for Runway, the app')
      .setVersion('1.0')
      .build();
    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup('api', app, document);
  }

  if (process.env.LOCAL_EXECUTOR === 'docker') {
    // local case
    await app.listen(port, '0.0.0.0');
  } else {
    // deployed case
    await app.listen(port);
  }
  Logger.log(`🚀 Application is running on: http://localhost:${port}/${globalPrefix}`);
}

bootstrap();
