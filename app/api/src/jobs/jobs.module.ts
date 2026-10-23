import { MiddlewareConsumer, Module, NestModule, RequestMethod } from '@nestjs/common';
import { JobsService } from './jobs.service';
import { StudentMatchReviewService } from './student-match-review.service';
import { StudentMatchSubmitService } from './student-match-submit.service';
import { JobsController } from './jobs.controller';
import { EarthbeamModule } from '../earthbeam/earthbeam.module';
import { FileModule } from '../files/file.module';
import { AddJobToReqMiddleware } from './job-on-req.middleware';
import { IdrsModule } from '../idrs/idrs.module';

@Module({
  imports: [EarthbeamModule, FileModule, IdrsModule],
  providers: [JobsService, StudentMatchReviewService, StudentMatchSubmitService],
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
