export const SyncManagers = {
  alSync: 'al_sync',
  txSync: 'tx_sync',
} as const;

export type SyncManager = (typeof SyncManagers)[keyof typeof SyncManagers] | null;
