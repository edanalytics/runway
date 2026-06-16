export type WithoutAudit<T> = Omit<
  T,
  | 'createdById'
  | 'createdOn'
  | 'modifiedById'
  | 'modifiedOn'
  | 'managedBy'
  | 'deletedOn'
  | 'isGlobal'
>;
