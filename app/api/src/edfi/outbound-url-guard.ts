import { isIP, type LookupFunction } from 'net';
import { lookup as dnsLookup } from 'dns';
import https from 'https';
import ipaddr from 'ipaddr.js';

/**
 * Restricts outbound requests to user-supplied URLs (e.g. an ODS host) to https
 * destinations that resolve only to public addresses.
 */

export class DisallowedUrlError extends Error {}

/** axios and follow-redirects wrap errors, so the guard's error may be nested in `cause`. */
export const findDisallowedUrlError = (error: unknown): DisallowedUrlError | undefined => {
  if (error instanceof DisallowedUrlError) return error;
  if (error instanceof Error) return findDisallowedUrlError((error as { cause?: unknown }).cause);
  return undefined;
};

/**
 * Only ordinary public unicast is allowed. ipaddr.js classifies addresses into the IANA
 * special-purpose ranges (RFC 6890 registries: private, loopback, link-local, etc.) and reports
 * everything else as 'unicast', so a range it knows about is refused without us listing it.
 */
export const isPublicAddress = (address: string): boolean => {
  if (!ipaddr.isValid(address)) return false;
  // process() unwraps IPv4-mapped IPv6 (::ffff:a.b.c.d) so it's judged by its IPv4 range.
  return ipaddr.process(address).range() === 'unicast';
};

/**
 * Synchronous checks on the URL itself. Hostnames are checked at connect time by
 * `publicOnlyLookup`, but Node skips DNS lookup for IP literals, so those are checked here.
 */
export const assertAllowedUrl = (rawUrl: string): URL => {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new DisallowedUrlError('Invalid URL');
  }
  // https only: these requests can carry credentials.
  if (url.protocol !== 'https:') {
    throw new DisallowedUrlError(`Protocol not allowed: ${url.protocol}`);
  }
  if (url.username || url.password) {
    throw new DisallowedUrlError('Credentials in URL not allowed');
  }
  // WHATWG URL normalizes numeric forms (e.g. 2130706433, 0x7f.1) to dotted IPv4; IPv6 keeps brackets.
  const host = url.hostname.replace(/^\[(.*)\]$/, '$1');
  if (isIP(host) && !isPublicAddress(host)) {
    throw new DisallowedUrlError(`Address not allowed: ${host}`);
  }
  return url;
};

/**
 * DNS lookup that fails if a hostname resolves to any non-public address. Doing this in the
 * socket's lookup (rather than resolving up front) means the checked address is the one
 * connected to.
 */
export const publicOnlyLookup: LookupFunction = (hostname, options, callback) => {
  dnsLookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return callback(err, '', 0);
    const blocked = addresses.find((a) => !isPublicAddress(a.address));
    if (blocked) {
      return callback(
        new DisallowedUrlError(`${hostname} resolves to disallowed address ${blocked.address}`),
        '',
        0
      );
    }
    if (options.all) return callback(null, addresses);
    callback(null, addresses[0].address, addresses[0].family);
  });
};

export const publicOnlyHttpsAgent = new https.Agent({ lookup: publicOnlyLookup });
