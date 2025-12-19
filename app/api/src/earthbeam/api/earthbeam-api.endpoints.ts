export const EARTHBEAM_AUTH_BASE_ROUTE = 'earthbeam/auth';
export const EARTHBEAM_API_BASE_ROUTE = 'earthbeam/jobs';

export const earthbeamInitEndpoint = (runId: number | ':runId') =>
  `api/${EARTHBEAM_AUTH_BASE_ROUTE}/${runId}/init`;

export const earthbeamJobInfoEndpoint = (runId: number | ':runId') =>
  `api/${EARTHBEAM_API_BASE_ROUTE}/${runId}`;

export const earthbeamStatusUpdateEndpoint = (runId: number | ':runId') =>
  `api/${EARTHBEAM_API_BASE_ROUTE}/${runId}/status`;

export const earthbeamErrorUpdateEndpoint = (runId: number | ':runId') =>
  `api/${EARTHBEAM_API_BASE_ROUTE}/${runId}/error`;

export const earthbeamSummaryEndpoint = (runId: number | ':runId') =>
  `api/${EARTHBEAM_API_BASE_ROUTE}/${runId}/summary`;

export const earthbeamUnmatchedIdsEndpoint = (runId: number | ':runId') =>
  `api/${EARTHBEAM_API_BASE_ROUTE}/${runId}/unmatched-ids`;
