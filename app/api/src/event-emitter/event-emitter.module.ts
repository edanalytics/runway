import { Module } from '@nestjs/common';
import {
  EventEmitterService,
  EventEmitterLogger,
  EventEmitterAwsEventBridge,
  EventEmitterNoop,
} from './event-emitter.service';
import { AppConfigService } from '../config/app-config.service';

@Module({
  providers: [
    {
      provide: EventEmitterService,
      useFactory: (appConfig: AppConfigService) => {
        const localEvents = appConfig.get('LOCAL_EVENTS');
        if (localEvents === 'log') {
          return new EventEmitterLogger(appConfig);
        } else if (localEvents === 'noop') {
          return new EventEmitterNoop(appConfig);
        } else {
          return new EventEmitterAwsEventBridge(appConfig);
        }
      },
      inject: [AppConfigService],
    },
  ],
  exports: [EventEmitterService],
})
export class EventEmitterModule {}