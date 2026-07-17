import { Logger, Module } from '@nestjs/common';
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
        const localEmitter = appConfig.get('LOCAL_EVENT_EMITTER');
        if (localEmitter && !appConfig.isDevEnvironment()) {
          new Logger('EventEmitterModule').warn(
            `LOCAL_EVENT_EMITTER=${localEmitter} is set but NODE_ENV is not "development"`
          );
        }
        if (localEmitter === 'log') {
          return new EventEmitterLogService();
        }
        if (localEmitter === 'noop') {
          return new EventEmitterNoopService();
        }
        return new EventEmitterEventBridgeService(appConfig);
      },
    },
  ],
  exports: [EVENT_EMITTER_SERVICE],
})
export class EventEmitterModule {}
