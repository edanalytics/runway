/**
 * The full IDRS student-search route for a partner's tenant. The configured
 * base url stays untouched elsewhere: it is also the OAuth audience, which
 * must match verbatim.
 */
export function idrsStudentSearchUrl(
  baseUrl: string,
  partnerId: string,
  tenantCode: string
): string {
  return `${baseUrl.replace(/\/+$/, '')}/partners/${encodeURIComponent(
    partnerId
  )}/tenants/${encodeURIComponent(tenantCode)}/students/search`;
}
