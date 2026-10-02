import { HttpService } from '@nestjs/axios';
import axios from 'axios';
import dns from 'dns';
import type http from 'http';
import https from 'https';
import ipaddr from 'ipaddr.js';
import type { LookupAddress } from 'dns';
import type { AddressInfo } from 'net';
import { generate as generateCert } from 'selfsigned';
import { AppConfigService } from '../config/app-config.service';
import { EdfiService } from './edfi.service';
import {
  assertAllowedUrl,
  DisallowedUrlError,
  isPublicAddress,
  publicOnlyHttpsAgent,
  publicOnlyLookup,
} from './outbound-url-guard';

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
    'https://127.0.0.1/',
    'https://2130706433/', // decimal 127.0.0.1
    'https://0x7f.1/', // hex shorthand 127.0.0.1
    'https://169.254.169.254/',
    'https://[::1]/',
    'https://[::ffff:127.0.0.1]/',
    'http://ods.example.com/',
    'ftp://example.com/',
    'https://user:pass@example.com/',
    'not a url',
  ])('rejects %s', (url) => {
    expect(() => assertAllowedUrl(url)).toThrow(DisallowedUrlError);
  });

  it.each([
    'https://api.ed-fi.org/v7.1/api',
    'https://93.184.216.34/',
    'https://[2606:4700::1111]/',
  ])('allows %s', (url) => {
    expect(() => assertAllowedUrl(url)).not.toThrow();
  });
});

describe('publicOnlyLookup', () => {
  const resolveTo = (addresses: LookupAddress[]) =>
    jest
      .spyOn(dns, 'lookup')
      .mockImplementation(((
        _host: string,
        _options: unknown,
        cb: (e: null, a: LookupAddress[]) => void
      ) => cb(null, addresses)) as unknown as typeof dns.lookup);

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
  let server: https.Server;
  let port: number;
  let requests: string[];
  let respond: (req: http.IncomingMessage, res: http.ServerResponse) => void;
  let isDev: boolean;
  let service: EdfiService;
  let warnings: string[];
  // Dev requests skip the guard, so they use this agent instead of publicOnlyHttpsAgent.
  let devHttpsAgent: https.Agent;

  const json = (res: http.ServerResponse, body: unknown) => {
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify(body));
  };
  const odsResponse: typeof respond = (req, res) =>
    json(res, req.method === 'POST' ? { access_token: 'token' } : {});

  beforeAll(async () => {
    // Self-signed cert for localhost / 127.0.0.1. Both agents trust it; Jest gives each test
    // file its own module registry, so the change to the guard's agent stays in this file.
    const { cert, private: key } = await generateCert(
      [{ name: 'commonName', value: 'localhost' }],
      { algorithm: 'sha256' }
    );
    publicOnlyHttpsAgent.options.ca = cert;
    devHttpsAgent = new https.Agent({ ca: cert });
    server = https.createServer({ key, cert }, (req, res) => {
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
    const httpService = new HttpService(axios.create({ httpsAgent: devHttpsAgent }));
    service = new EdfiService(httpService, appConfig);
    warnings = [];
    jest
      .spyOn((service as any).logger, 'warn')
      .mockImplementation((message: unknown) => void warnings.push(String(message)));
  });

  afterEach(() => jest.restoreAllMocks());

  const connect = (host: string) =>
    service.testConnection({ host, clientId: 'id', clientSecret: 'secret' });
  // Nothing listens on 127.0.0.2, so if the guard let a request through it would fail without a warning.
  const privateUrl = () => `https://127.0.0.2:${port}/`;

  it('does not request a loopback IP literal', async () => {
    expect(await connect(`https://127.0.0.1:${port}`)).toEqual({ status: 'ERROR', type: 'AUTH' });
    expect(requests).toEqual([]);
    expect(warnings).toEqual([expect.stringContaining('127.0.0.1')]);
  });

  it.each([
    [
      'a URL with userinfo and query',
      'https://user:pass-value@127.0.0.1/?key=key-value',
      'https://127.0.0.1',
    ],
    ['an unparseable host', 'pass-value key-value', '(unparseable URL)'],
  ])('logs only the origin of %s', async (_label, host, logged) => {
    await connect(host);
    expect(warnings).toEqual([expect.stringContaining(`host ${logged}:`)]);
    expect(warnings[0]).not.toMatch(/pass-value|key-value/);
  });

  it('does not request a hostname that resolves to loopback', async () => {
    expect(await connect(`https://localhost:${port}`)).toEqual({ status: 'ERROR', type: 'AUTH' });
    expect(requests).toEqual([]);
  });

  it('allows private addresses in dev', async () => {
    isDev = true;
    expect(await connect(`https://127.0.0.1:${port}`)).toEqual({ status: 'SUCCESS' });
    expect(requests).toEqual(['GET /', 'POST /oauth/token']);
  });

  describe('with a public ODS', () => {
    // Classify the test server's address as public, so a "public" ODS can run on loopback.
    beforeEach(() => {
      const realProcess = ipaddr.process;
      jest
        .spyOn(ipaddr, 'process')
        .mockImplementation((address) =>
          address === '127.0.0.1'
            ? ({ range: () => 'unicast' } as unknown as ReturnType<typeof ipaddr.process>)
            : realProcess.call(ipaddr, address)
        );
    });

    it('connects through the guard', async () => {
      expect(await connect(`https://127.0.0.1:${port}`)).toEqual({ status: 'SUCCESS' });
      expect(requests).toEqual(['GET /', 'POST /oauth/token']);
      expect(warnings).toEqual([]);
    });

    it('does not follow a redirect to a non-public address', async () => {
      respond = (req, res) => {
        res.writeHead(302, { location: privateUrl() });
        res.end();
      };
      expect(await connect(`https://127.0.0.1:${port}`)).toEqual({ status: 'ERROR', type: 'AUTH' });
      expect(warnings).toEqual([expect.stringContaining('127.0.0.2')]);
    });

    it('does not use an oauth URL that points to a non-public address', async () => {
      respond = (req, res) => json(res, { urls: { oauth: privateUrl() } });
      expect(await connect(`https://127.0.0.1:${port}`)).toEqual({ status: 'ERROR', type: 'AUTH' });
      expect(requests).toEqual(['GET /']);
      expect(warnings).toEqual([expect.stringContaining('127.0.0.2')]);
    });
  });
});
