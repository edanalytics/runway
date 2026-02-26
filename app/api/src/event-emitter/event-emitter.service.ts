import { Injectable, Logger } from '@nestjs/common';
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { AppConfigService } from '../config/app-config.service';

export interface EventEmitterService {
  emit(label: string, payload: any): Promise<void>;
}

export const EVENT_EMITTER_SERVICE = 'EventEmitterService';

@Injectable()
export class EventEmitterEventBridgeService implements EventEmitterService {
  private readonly logger = new Logger(EventEmitterEventBridgeService.name);
  private readonly eventBridgeClient: EventBridgeClient;
  private readonly source: string;

  constructor(private readonly appConfig: AppConfigService) {
    this.source = `runway.${this.appConfig.get('ENVLABEL') ?? 'unknown-env'}`;
    this.eventBridgeClient = new EventBridgeClient({ region: process.env.AWS_REGION });
  }

  async emit(label: string, payload: any) {
    // Sometimes an event is successfully sent but fails to trigger a rule. If we're not archiving
    // events (which we're not as of this writing), this log is the only way to sort out what's going on
    this.logger.log(`Emitting event: ${label} with data: ${JSON.stringify(payload)}`);

    try {
      const command = new PutEventsCommand({
        Entries: [
          {
            Time: new Date(),
            Source: this.source,
            DetailType: label,
            Detail: JSON.stringify(payload),
          },
        ],
      });
      const response = await this.eventBridgeClient.send(command);
      if (response.FailedEntryCount && response.FailedEntryCount > 0) {
        this.logger.error(
          `Failed to emit event: ${label} with data: ${JSON.stringify(
            payload
          )}. EventBridge response: ${JSON.stringify(response)}`
        );
      }
    } catch (error) {
      // failing to emit an event is not a critical error
      this.logger.error(`Error emitting event: ${error}`);
    }
  }
}

@Injectable()
export class EventEmitterLogService implements EventEmitterService {
  private readonly logger = new Logger(EventEmitterLogService.name);

  async emit(label: string, payload: any) {
    this.logger.log(`Event: ${label} — ${JSON.stringify(payload)}`);
  }
}

@Injectable()
export class EventEmitterNoopService implements EventEmitterService {
  async emit() {
    // intentionally empty
  }
}
