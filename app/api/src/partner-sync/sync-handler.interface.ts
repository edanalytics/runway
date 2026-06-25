export interface SyncHandler {
  readonly sourceKey: string;
  sync(): Promise<void>;
}