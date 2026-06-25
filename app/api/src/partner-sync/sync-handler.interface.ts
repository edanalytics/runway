export interface SyncHandler {
  readonly sourceKey: string;
  sync(): Promise<void>;
}

export const SYNC_HANDLERS = 'SYNC_HANDLERS';
