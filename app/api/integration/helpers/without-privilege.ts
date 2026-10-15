import { GetSessionDataDto, PrivilegeKey } from '@edanalytics/models';

/**
 * Runs `fn` with `privilege` taken from every session. Roles are fixed sets,
 * so this is how a test reaches a user who lacks one privilege of their role.
 */
export const withoutPrivilege = async <T>(privilege: PrivilegeKey, fn: () => Promise<T>) => {
  const { get } = Object.getOwnPropertyDescriptor(GetSessionDataDto.prototype, 'privileges')!;
  const privileges = jest
    .spyOn(GetSessionDataDto.prototype, 'privileges', 'get')
    .mockImplementation(function (this: GetSessionDataDto) {
      const granted: Set<PrivilegeKey> = get!.call(this);
      granted.delete(privilege);
      return granted;
    });
  try {
    return await fn();
  } finally {
    privileges.mockRestore();
  }
};
