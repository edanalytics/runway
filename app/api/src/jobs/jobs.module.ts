import { MiddlewareConsumer, Module, NestModule, RequestMethod } from '@nestjs/common';
import { JobsService } from './jobs.service';
import { JobsController } from './jobs.controller';
import { EarthbeamModule } from '../earthbeam/earthbeam.module';
import { FileModule } from '../files/file.module';
import { AddJobToReqMiddleware } from './job-on-req.middleware';

@Module({
  imports: [EarthbeamModule, FileModule],
  providers: [JobsService],
  exports: [JobsService],
  controllers: [JobsController],
})
export class JobsModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(AddJobToReqMiddleware)
      .exclude(
        { path: 'jobs', method: RequestMethod.GET },
        { path: 'jobs', method: RequestMethod.POST }
      )
      .forRoutes(JobsController);
  }
}
