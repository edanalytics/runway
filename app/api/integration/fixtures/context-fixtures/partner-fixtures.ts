import { Partner } from '@prisma/client';
import { WithoutAudit } from '../utils/created-modified';
import { idpA, idpX } from './idp-fixtures';

export const partnerA: WithoutAudit<Partner> = {
  id: 'partner-a',
  name: 'Partner A',
  idpId: idpA.id,
  descriptorNamespace: 'partner-a',
};

export const partnerC: WithoutAudit<Partner> = {
  id: 'partner-c',
  name: 'Partner C',
  idpId: idpA.id, // shares idp with partner A
  descriptorNamespace: 'partner-c',
};

export const partnerX: WithoutAudit<Partner> = {
  id: 'partner-x',
  name: 'Partner X',
  idpId: idpX.id,
  descriptorNamespace: null,
};
