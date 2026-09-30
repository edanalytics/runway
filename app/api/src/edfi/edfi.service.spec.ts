import { HttpService } from '@nestjs/axios';
import axios from 'axios';
import dns from 'dns';
import http from 'http';
import type { LookupAddress } from 'dns';
import type { AddressInfo } from 'net';
import { AppConfigService } from '../config/app-config.service';
import { EdfiService } from './edfi.service';
import {
  assertAllowedUrl,
  DisallowedUrlError,
  isPublicAddress,
  publicOnlyLookup,
} from './outbound-url-guard';

// Addresses the ipaddr.js mock classifies as public, so a test can stand up a "public" ODS on loopback.
const mockPublicAddresses = new Set<string>();
jest.mock('ipaddr.js', () => {
  const actual = jest.requireActual('ipaddr.js');
  return {
    ...actual,
    process: (address: string) =>
      mockPublicAddresses.has(address) ? { range: () => 'unicast' } : actual.process(address),
  };
});

afterEach(() => mockPublicAddresses.clear());

describe('isPublicAddress', () => {
  it.each([
    '127.0.0.1',
    '169.254.169.254', // link-local
    '10.0.0.1',
    '::1',
    '::ffff:127.0.0.1', // IPv4-mapped, judged by its IPv4 range
    'fd00::1',
    'not-an-ip',
  ])('rejects %s', (address) => {
    expect(isPublicAddress(address)).toBe(false);
  });

  it.each(['8.8.8.8', '::ffff:8.8.8.8', '2606:4700::1111'])('allows %s', (address) => {
    expect(isPublicAddress(address)).toBe(true);
  });
});

describe('assertAllowedUrl', () => {
  it.each([
    'http://127.0.0.1/',
    'http://2130706433/', // decimal 127.0.0.1
    'http://0x7f.1/', // hex shorthand 127.0.0.1
    'http://169.254.169.254/',
    'http://[::1]/',
    'http://[::ffff:127.0.0.1]/',
    'ftp://example.com/',
    'https://user:pass@example.com/',
    'not a url',
  ])('rejects %s', (url) => {
    expect(() => assertAllowedUrl(url)).toThrow(DisallowedUrlError);
  });

  it.each(['https://api.ed-fi.org/v7.1/api', 'http://93.184.216.34/', 'https://[2606:4700::1111]/'])(
    'allows %s',
    (url) => {
      expect(() => assertAllowedUrl(url)).not.toThrow();
    }
  );
});

describe('publicOnlyLookup', () => {
  const resolveTo = (addresses: LookupAddress[]) =>
    jest
      .spyOn(dns, 'lookup')
      .mockImplementation(((_host: string, _options: unknown, cb: (e: null, a: LookupAddress[]) => void) =>
        cb(null, addresses)) as unknown as typeof dns.lookup);

  afterEach(() => jest.restoreAllMocks());

  const lookup = (all: boolean) =>
    new Promise<{ err: Error | null; result: unknown[] }>((resolve) =>
      publicOnlyLookup('ods.example.com', { all }, (err, ...result) => resolve({ err, result }))
    );

  const publicAddresses = [
    { address: '8.8.8.8', family: 4 },
    { address: '2606:4700::1111', family: 6 },
  ];

  it('returns every address when all is requested (as Node 22 agents do)', async () => {
    resolveTo(publicAddresses);
    expect(await lookup(true)).toEqual({ err: null, result: [publicAddresses] });
  });

  it('returns the first address and family otherwise', async () => {
    resolveTo(publicAddresses);
    expect(await lookup(false)).toEqual({ err: null, result: ['8.8.8.8', 4] });
  });

  it('rejects a hostname if any address is non-public', async () => {
    resolveTo([...publicAddresses, { address: '10.0.0.1', family: 4 }]);
    expect((await lookup(true)).err).toBeInstanceOf(DisallowedUrlError);
  });
});

describe('EdfiService.testConnection', () => {
  let server: http.Server;
  let port: number;
  let requests: string[];
  let respond: (req: http.IncomingMessage, res: http.ServerResponse) => void;
  let isDev: boolean;
  let service: EdfiService;
  let warnings: string[];

  const json = (res: http.ServerResponse, body: unknown) => {
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify(body));
  };
  const odsResponse: typeof respond = (req, res) =>
    json(res, req.method === 'POST' ? { access_token: 'token' } : {});

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      requests.push(`${req.method} ${req.url}`);
      respond(req, res);
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    port = (server.address() as AddressInfo).port;
  });

  afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

  beforeEach(() => {
    requests = [];
    respond = odsResponse;
    isDev = false;
    const appConfig = { isDevEnvironment: () => isDev } as AppConfigService;
    service = new EdfiService(new HttpService(axios.create()), appConfig);
    warnings = [];
    jest
      .spyOn((service as any).logger, 'warn')
      .mockImplementation((message: unknown) => void warnings.push(String(message)));
  });

  afterEach(() => jest.restoreAllMocks());

  const connect = (host: string) => service.testConnection({ host, clientId: 'id', clientSecret: 'secret' });
  // Nothing listens on 127.0.0.2, so if the guard let a request through it would fail without a warning.
  const privateUrl = () => `http://127.0.0.2:${port}/`;

  it('does not request a loopback IP literal', async () => {
    expect(await connect(`http://127.0.0.1:${port}`)).toEqual({ status: 'ERROR', type: 'AUTH' });
    expect(requests).toEqual([]);
    expect(warnings).toEqual([expect.stringContaining('127.0.0.1')]);
  });

  it.each([
    ['a URL with userinfo and query', 'http://user:pass-value@127.0.0.1/?key=key-value', 'http://127.0.0.1'],
    ['an unparseable host', 'pass-value key-value', '(unparseable URL)'],
  ])('logs only the origin of %s', async (_label, host, logged) => {
    await connect(host);
    expect(warnings).toEqual([expect.stringContaining(`host ${logged}:`)]);
    expect(warnings[0]).not.toMatch(/pass-value|key-value/);
  });

  it('does not request a hostname that resolves to loopback', async () => {
    expect(await connect(`http://localhost:${port}`)).toEqual({ status: 'ERROR', type: 'AUTH' });
    expect(requests).toEqual([]);
  });

  it('allows private addresses in dev', async () => {
    isDev = true;
    expect(await connect(`http://127.0.0.1:${port}`)).toEqual({ status: 'SUCCESS' });
    expect(requests).toEqual(['GET /', 'POST /oauth/token']);
  });

  describe('with a public ODS', () => {
    beforeEach(() => mockPublicAddresses.add('127.0.0.1'));

    it('connects through the guard', async () => {
      expect(await connect(`http://127.0.0.1:${port}`)).toEqual({ status: 'SUCCESS' });
      expect(requests).toEqual(['GET /', 'POST /oauth/token']);
      expect(warnings).toEqual([]);
    });

    it('does not follow a redirect to a non-public address', async () => {
      respond = (req, res) => {
        res.writeHead(302, { location: privateUrl() });
        res.end();
      };
      expect(await connect(`http://127.0.0.1:${port}`)).toEqual({ status: 'ERROR', type: 'AUTH' });
      expect(warnings).toEqual([expect.stringContaining('127.0.0.2')]);
    });

    it('does not use an oauth URL that points to a non-public address', async () => {
      respond = (req, res) => json(res, { urls: { oauth: privateUrl() } });
      expect(await connect(`http://127.0.0.1:${port}`)).toEqual({ status: 'ERROR', type: 'AUTH' });
      expect(requests).toEqual(['GET /']);
      expect(warnings).toEqual([expect.stringContaining('127.0.0.2')]);
    });
  });
});
