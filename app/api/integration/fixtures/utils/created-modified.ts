export type WithoutAudit<T> = Omit<T, 'createdById' | 'createdOn' | 'modifiedById' | 'modifiedOn' | 'syncManaged' | 'deletedOn' | 'children' | 'isGlobal'>;
