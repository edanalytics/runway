import { SchoolYearConfig } from '@prisma/client';
import { partnerA, partnerX } from './partner-fixtures';
import { schoolYear2425, schoolYear2526 } from './school-year-fixtures';

type WithoutAuditSyc = Omit<SchoolYearConfig, 'modifiedById' | 'modifiedOn'>;

// Mirrors the migration seed: one row per active (non-retired) ODS config's
// distinct partner_id + school_year_id, with is_enabled=true, send_to_ods=true.
// Partner A has ODS configs for 2425 and 2526.
// Partner X has ODS config for 2425.
// School year 2324 has no ODS configs → no rows (defaults apply).

export const sycA2425: WithoutAuditSyc = {
  partnerId: partnerA.id,
  schoolYearId: schoolYear2425.id,
  isEnabled: true,
  sendToOds: true,
};

export const sycA2526: WithoutAuditSyc = {
  partnerId: partnerA.id,
  schoolYearId: schoolYear2526.id,
  isEnabled: true,
  sendToOds: true,
};

export const sycX2425: WithoutAuditSyc = {
  partnerId: partnerX.id,
  schoolYearId: schoolYear2425.id,
  isEnabled: true,
  sendToOds: true,
};

export const allSchoolYearConfigs = [sycA2425, sycA2526, sycX2425];
