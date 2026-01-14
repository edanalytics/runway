import { Injectable, Logger } from '@nestjs/common';
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { AppConfigService } from '../config/app-config.service';

@Injectable()
export abstract class EventEmitterService {
  constructor(protected readonly appConfig: AppConfigService) {}
  abstract emit(label: string, payload: any): Promise<void>;
}

export class EventEmitterAwsEventBridge extends EventEmitterService {
  private readonly logger = new Logger(EventEmitterAwsEventBridge.name);
  private readonly eventBridgeClient = new EventBridgeClient({ region: process.env.AWS_REGION });
  private readonly source: string;

  constructor(appConfig: AppConfigService) {
    super(appConfig);
    this.source = `runway.${this.appConfig.get('ENVLABEL') ?? 'unknown-env'}`;
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

export class EventEmitterLogger extends EventEmitterService {
  private readonly logger = new Logger(EventEmitterLogger.name);
  async emit(label: string, payload: any) {
    this.logger.log(`Emitting event: ${label} with data: ${JSON.stringify(payload, null, 2)}`);
  }
}
export class EventEmitterNoop extends EventEmitterService {
  async emit(label: string, payload: any) {
    // do nothing
  }
}