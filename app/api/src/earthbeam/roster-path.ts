const ROSTER_FILE_NAME = 'studentEducationOrganizationAssociations.jsonl';

export function rosterFileKey(
  tenant: { partnerId: string; tenantCode: string },
  schoolYear: { endYear: number },
): string {
  return `__rosters/${tenant.partnerId}/${tenant.tenantCode}/${schoolYear.endYear}/${ROSTER_FILE_NAME}`;
}
