import { Module } from '@nestjs/common';
import {
  EVENT_EMITTER_SERVICE,
  EventEmitterEventBridgeService,
  EventEmitterLogService,
  EventEmitterNoopService,
} from './event-emitter.service';
import { AppConfigService } from '../config/app-config.service';

@Module({
  providers: [
    {
      provide: EVENT_EMITTER_SERVICE,
      inject: [AppConfigService],
      useFactory: (appConfig: AppConfigService) => {
        const handler = appConfig.get('LOCAL_EVENT_HANDLER');
        if (handler === 'log') {
          return new EventEmitterLogService();
        }
        if (handler === 'noop') {
          return new EventEmitterNoopService();
        }
        return new EventEmitterEventBridgeService(appConfig);
      },
    },
  ],
  exports: [EVENT_EMITTER_SERVICE],
})
export class EventEmitterModule {}
