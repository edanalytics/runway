import { Injectable, Logger } from '@nestjs/common';
import { SyncHandler } from '../sync-handler.interface';

@Injectable()
export class TxSyncHandler implements SyncHandler {
  readonly sourceKey = 'tx_sync';
  readonly channel = 'tx-sync';

  private readonly logger = new Logger(TxSyncHandler.name);

  async sync(): Promise<void> {
    this.logger.log('TX sync not yet implemented');
  }
}
