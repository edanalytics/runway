import { User } from '@prisma/client';
import { WithoutAudit } from './utils/created-modified';
import { idpA, idpX } from './context-fixtures/idp-fixtures';

export const userA: WithoutAudit<User> = {
  // need id to start high so we don't conflict with auto-incrementing ids
  // when users are created on the fly
  id: 1000,
  email: 'user-a@test.com',
  givenName: 'firstA',
  familyName: 'lastA',
  idpId: idpA.id,
  externalUserId: 'user-a@test.com',
};

export const userB: WithoutAudit<User> = {
  id: 1001,
  email: 'user-b@test.com',
  givenName: 'firstB',
  familyName: 'lastB',
  idpId: idpA.id,
  externalUserId: 'user-b@test.com',
};

export const userX: WithoutAudit<User> = {
  id: 1002,
  email: 'user-x@test.com',
  givenName: 'firstX',
  familyName: 'lastX',
  idpId: idpX.id,
  externalUserId: 'user-x@test.com',
};
