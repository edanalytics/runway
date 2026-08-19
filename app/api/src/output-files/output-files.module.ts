import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { OutputFilesController } from './output-files.controller';
import { OutputFilesService } from './output-files.service';
import { AddJobToReqMiddleware } from '../jobs/job-on-req.middleware';

@Module({
  providers: [OutputFilesService],
  controllers: [OutputFilesController],
})
export class OutputFilesModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(AddJobToReqMiddleware).forRoutes(OutputFilesController);
  }
}
