import { SchoolYearConfig } from '@prisma/client';
import { partnerA, partnerX } from './partner-fixtures';
import { schoolYear2425, schoolYear2526 } from './school-year-fixtures';
import { WithoutAudit } from '../utils/created-modified';

// Partner A: 2425 (sendToOds=true), 2526 (sendToOds=false).
// Partner X: 2425 (sendToOds=true).
// School year 2324 has no config rows for either partner (defaults apply).

export const sycA2425: WithoutAudit<SchoolYearConfig> = {
  partnerId: partnerA.id,
  schoolYearId: schoolYear2425.id,
  isEnabled: true,
  sendToOds: true,
};

export const sycA2526: WithoutAudit<SchoolYearConfig> = {
  partnerId: partnerA.id,
  schoolYearId: schoolYear2526.id,
  isEnabled: true,
  sendToOds: false,
};

export const sycX2425: WithoutAudit<SchoolYearConfig> = {
  partnerId: partnerX.id,
  schoolYearId: schoolYear2425.id,
  isEnabled: true,
  sendToOds: true,
};

export const allSchoolYearConfigs = [sycA2425, sycA2526, sycX2425];
