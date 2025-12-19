import { MiddlewareConsumer, Module, NestModule, RequestMethod } from '@nestjs/common';
import { OdsConfigController } from './ods-config.controller';
import { OdsConfigService } from './ods-config.service';
import { EdfiModule } from '../edfi/edfi.module';
import { EncryptionModule } from '../encryption/encryption.module';
import { AddOdsConfigMiddleware } from './ods-config.middleware';

@Module({
  imports: [EdfiModule, EncryptionModule],
  controllers: [OdsConfigController],
  providers: [OdsConfigService],
})
export class OdsConfigModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(AddOdsConfigMiddleware)
      .exclude(
        // Not a fan of how the path is specified here and needs to magically
        // match up with the path the controller is associated with in the routes.
        // I do, however, want this middleware to apply by default to all routes
        // in this controller since the guard reliues on it. I'drather error on
        // the side of it running than not. Still, should be a clearer way.
        {
          path: 'ods-configs',
          method: RequestMethod.GET,
        },
        {
          path: 'ods-configs',
          method: RequestMethod.POST,
        }
      )
      .forRoutes(OdsConfigController);
  }
}
