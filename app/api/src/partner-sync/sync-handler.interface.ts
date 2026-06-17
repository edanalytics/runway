export interface SyncHandler {
  readonly sourceKey: string;
  readonly channel: string;
  sync(): Promise<void>;
}

export const SYNC_HANDLERS = 'SYNC_HANDLERS';
