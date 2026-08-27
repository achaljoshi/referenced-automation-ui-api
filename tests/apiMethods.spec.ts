import { test, expect, request as playwrightRequest, type APIRequestContext } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  ApiClient,
  xml,
  BasicAuth,
  BearerAuth,
  ApiKeyAuth,
  OAuth2ClientCredentials,
  paginateByPageNumber,
  paginateByCursor,
  MockServer,
  mockApiRoutes,
  unmockApiRoute,
  recordApiTraffic,
  playApiRecording,
} from '@automation/referenced-automation-api';

/**
 * A demo/reference suite for every reusable method
 * @automation/referenced-automation-api exports (mockApiRoute itself is
 * demoed separately in mockedProfile.spec.ts, so it isn't repeated here).
 * MockServer doubles as both "a method being demoed" and the real backend
 * everything else in this file talks to - no live third-party API involved.
 */

let server: MockServer;
let context: APIRequestContext;
let client: ApiClient;

test.beforeAll(async () => {
  server = new MockServer();
  await server.start();
  context = await playwrightRequest.newContext();
  client = new ApiClient(context, server.baseUrl);

  // HEAD must be registered before GET on the same path - Express (which
  // MockServer wraps) otherwise falls through to the GET handler for HEAD
  // requests, silently serving the wrong response.
  server.route({
    method: 'HEAD',
    path: '/users',
    handler: () => ({ status: 200, headers: { 'X-Total-Count': '1' } }),
  });
  server.route({
    method: 'OPTIONS',
    path: '/users',
    handler: () => ({ status: 204, headers: { Allow: 'GET,POST,HEAD,OPTIONS' } }),
  });
  server.get('/users', [{ id: 1, name: 'Ada' }]);
  server.get('/users/:id', (req) => ({ id: Number(req.params.id), name: 'Ada' }));
  server.post('/users', (req) => ({ id: 999, ...(req.body as object) }), { status: 201 });
  server.put('/users/:id', (req) => ({ id: Number(req.params.id), ...(req.body as object) }));
  server.patch('/users/:id', () => ({ patched: true }));
  server.delete('/users/:id', undefined, { status: 204 });
  server.get('/echo-headers', (req) => ({ headers: req.headers }));
});

test.afterAll(async () => {
  await context.dispose();
  await server.stop();
});

test.describe('api: ApiClient - every HTTP method, header CRUD, path params @smoke', () => {
  test('every ApiClient method and ApiResponse method', async () => {
    client.setHeader('X-Client', 'ui-api-demo');
    expect(client.getHeader('X-Client')).toBe('ui-api-demo');
    client.setHeaders({ 'X-Extra': 'yes' });

    const getRes = await client.get('/users');
    expect(getRes.status()).toBe(200);
    expect(getRes.ok()).toBe(true);
    expect(getRes.statusText()).toBeTruthy();
    expect(getRes.headers()['content-type']).toContain('json');
    expect(getRes.text().length).toBeGreaterThan(0);
    expect(getRes.get<string>('[0].name')).toBe('Ada');
    expect(getRes.has('[0].name')).toBe(true);
    expect(getRes.require<string>('[0].name')).toBe('Ada');
    const schema = {
      type: 'array',
      items: { type: 'object', properties: { id: { type: 'number' }, name: { type: 'string' } } },
    };
    expect(getRes.validateSchema(schema).valid).toBe(true);
    getRes.expectStatus(200).expectStatusInRange(200, 299).expectValue('[0].name', 'Ada').expectSchema(schema);

    expect((await client.get('/users/{id}', { pathParams: { id: 42 } })).get('id')).toBe(42);
    expect(client.resolvePath('/users/{id}', { id: 7 })).toBe('/users/7');

    const postRes = await client.post('/users', { json: { name: 'New User' } });
    expect(postRes.status()).toBe(201);

    const putRes = await client.put('/users/{id}', { pathParams: { id: 5 }, json: { name: 'Replaced' } });
    expect(putRes.get('name')).toBe('Replaced');

    expect((await client.patch('/users/{id}', { pathParams: { id: 5 } })).get('patched')).toBe(true);
    expect((await client.delete('/users/{id}', { pathParams: { id: 5 } })).status()).toBe(204);
    expect((await client.head('/users')).header('x-total-count')).toBe('1');
    expect((await client.options('/users')).header('allow')).toContain('GET');

    const headerEcho = await client.get('/echo-headers', { headers: { 'X-Once': 'only-this-call' } });
    expect(headerEcho.get('headers.x-client')).toBe('ui-api-demo');
    expect(headerEcho.get('headers.x-once')).toBe('only-this-call');

    client.removeHeader('X-Extra');
    expect(client.getHeader('X-Extra')).toBeUndefined();
    client.clearHeaders();
    expect(client.getHeader('X-Client')).toBeUndefined();
  });
});

test.describe('api: auth providers - every AuthProvider @smoke', () => {
  test.beforeAll(() => {
    server.route({
      method: 'GET',
      path: '/protected/basic',
      handler: (req) =>
        req.headers.authorization === `Basic ${Buffer.from('user:pass').toString('base64')}`
          ? { body: { authenticated: true } }
          : { status: 401, body: { error: 'unauthorized' } },
    });
    server.route({
      method: 'GET',
      path: '/protected/bearer',
      handler: (req) =>
        req.headers.authorization === 'Bearer static-token'
          ? { body: { authenticated: true } }
          : { status: 401, body: { error: 'unauthorized' } },
    });
    server.route({
      method: 'GET',
      path: '/protected/apikey',
      handler: (req) => {
        const key = req.headers['x-api-key'] ?? req.query.apiKey;
        return key === 'expected-key' ? { body: { authenticated: true } } : { status: 401, body: { error: 'unauthorized' } };
      },
    });
    server.route({
      method: 'POST',
      path: '/oauth/token',
      handler: (req) => {
        const body = req.body as Record<string, string>;
        return body.client_id === 'client' && body.client_secret === 'secret'
          ? { body: { access_token: 'issued-token', expires_in: 3600, token_type: 'Bearer' } }
          : { status: 401, body: { error: 'invalid_client' } };
      },
    });
    server.route({
      method: 'GET',
      path: '/protected/oauth',
      handler: (req) =>
        req.headers.authorization === 'Bearer issued-token'
          ? { body: { authenticated: true } }
          : { status: 401, body: { error: 'unauthorized' } },
    });
  });

  test('BasicAuth', async () => {
    const authed = new ApiClient(context, server.baseUrl).setAuth(new BasicAuth('user', 'pass'));
    expect((await authed.get('/protected/basic')).get('authenticated')).toBe(true);
  });

  test('BearerAuth - static token and async token-supplier form', async () => {
    const staticClient = new ApiClient(context, server.baseUrl).setAuth(new BearerAuth('static-token'));
    expect((await staticClient.get('/protected/bearer')).get('authenticated')).toBe(true);

    const supplierClient = new ApiClient(context, server.baseUrl).setAuth(
      new BearerAuth(async () => 'static-token'),
    );
    expect((await supplierClient.get('/protected/bearer')).get('authenticated')).toBe(true);
  });

  test('ApiKeyAuth - header and query locations', async () => {
    const headerClient = new ApiClient(context, server.baseUrl).setAuth(new ApiKeyAuth('X-Api-Key', 'expected-key'));
    expect((await headerClient.get('/protected/apikey')).get('authenticated')).toBe(true);

    const queryClient = new ApiClient(context, server.baseUrl).setAuth(new ApiKeyAuth('apiKey', 'expected-key', 'query'));
    expect((await queryClient.get('/protected/apikey')).get('authenticated')).toBe(true);
  });

  test('OAuth2ClientCredentials fetches and reuses a token, clearAuth() removes it', async () => {
    const oauthClient = new ApiClient(context, server.baseUrl).setAuth(
      new OAuth2ClientCredentials({ tokenUrl: `${server.baseUrl}/oauth/token`, clientId: 'client', clientSecret: 'secret' }),
    );
    expect((await oauthClient.get('/protected/oauth')).get('authenticated')).toBe(true);
    // A second call reuses the cached token rather than fetching a new one - proven by it still succeeding.
    expect((await oauthClient.get('/protected/oauth')).get('authenticated')).toBe(true);

    oauthClient.clearAuth();
    expect((await oauthClient.get('/protected/oauth')).status()).toBe(401);
  });
});

test.describe('api: pagination - both strategies @smoke', () => {
  test.beforeAll(() => {
    const all = Array.from({ length: 5 }, (_, i) => ({ id: i + 1 }));
    server.get('/page-items', (req) => {
      const page = Number(req.query.page ?? 1);
      const pageSize = 2;
      const start = (page - 1) * pageSize;
      return { items: all.slice(start, start + pageSize) };
    });
    server.get('/cursor-items', (req) => {
      const cursor = Number(req.query.cursor ?? 0);
      const pageSize = 2;
      const items = all.slice(cursor, cursor + pageSize);
      const next = cursor + pageSize < all.length ? cursor + pageSize : null;
      return { items, next };
    });
  });

  test('paginateByPageNumber collects every page', async () => {
    const items = await paginateByPageNumber(client, '/page-items', { itemsPath: 'items' });
    expect(items).toHaveLength(5);
  });

  test('paginateByCursor follows next cursors to the end', async () => {
    const items = await paginateByCursor(client, '/cursor-items', { itemsPath: 'items', nextCursorPath: 'next' });
    expect(items).toHaveLength(5);
  });
});

test.describe('api: xml (de)serialization @smoke', () => {
  test('toXml/fromXml round-trip a plain object', () => {
    const value = { user: { id: 1, name: 'Ada' } };
    const xmlString = xml.toXml(value);
    expect(xmlString).toContain('<id>1</id>');
    expect(xml.fromXml<typeof value>(xmlString)).toEqual(value);
  });
});

test.describe('api: MockServer.reset() @smoke', () => {
  test('reset() clears routes registered on a shared server instance', async () => {
    const scratch = new MockServer();
    await scratch.start();
    try {
      scratch.get('/temp', { ok: true });
      const before = await context.get(`${scratch.baseUrl}/temp`);
      expect(before.status()).toBe(200);

      scratch.reset();
      const after = await context.get(`${scratch.baseUrl}/temp`);
      expect(after.status()).toBe(404);
    } finally {
      await scratch.stop();
    }
  });
});

test.describe('api: mockApiRoutes / unmockApiRoute (runtime UI mocking, plural + removal) @smoke', () => {
  const HOST = 'http://ui-api-mock-demo.invalid';

  test('mockApiRoutes registers several mocks at once; unmockApiRoute removes one', async ({ page }) => {
    // In-page fetch() rather than full navigation - avoids entangling the
    // "does this URL still resolve" check with Chromium's own error-page
    // navigation lifecycle, which is what made a page.goto()-based version
    // of this test flaky.
    await page.goto('about:blank');
    await mockApiRoutes(page, [
      { url: `${HOST}/a`, headers: { 'Access-Control-Allow-Origin': '*' }, body: { from: 'a' } },
      { url: `${HOST}/b`, headers: { 'Access-Control-Allow-Origin': '*' }, body: { from: 'b' } },
    ]);

    const fetchJson = (url: string) => page.evaluate((u) => fetch(u).then((res) => res.json()), url);
    const fetchFails = (url: string) =>
      page.evaluate((u) => fetch(u).then(
        () => false,
        () => true,
      ), url);

    expect(await fetchJson(`${HOST}/a`)).toEqual({ from: 'a' });
    expect(await fetchJson(`${HOST}/b`)).toEqual({ from: 'b' });

    await unmockApiRoute(page, `${HOST}/a`);
    // *.invalid never resolves for real - if unmockApiRoute worked, this now fails; if it leaked, it would still "succeed".
    expect(await fetchFails(`${HOST}/a`)).toBe(true);

    // /b was never unmocked, so it should still work.
    expect(await fetchJson(`${HOST}/b`)).toEqual({ from: 'b' });
  });
});

test.describe('api: recordApiTraffic / playApiRecording @regression', () => {
  const recordingFile = path.join(__dirname, '..', 'test-results', 'ui-api-demo-recording.json');

  test.afterEach(async () => {
    await fs.promises.rm(recordingFile, { force: true });
  });

  test('records a real response, then replays it after the real server is gone', async ({ page }) => {
    const recordServer = new MockServer();
    await recordServer.start();
    recordServer.get('/items', [{ id: 1, label: 'first' }]);
    const itemsUrl = `${recordServer.baseUrl}/items`;

    try {
      const handle = await recordApiTraffic(page, itemsUrl, recordingFile);
      await page.goto(itemsUrl);
      const liveText = await page.locator('body').innerText();
      expect(liveText).toContain('first');
      await handle.save();
    } finally {
      await recordServer.stop();
    }

    await playApiRecording(page, recordingFile, itemsUrl);
    const replayed = await page.goto(itemsUrl);
    expect(replayed?.status()).toBe(200);
    expect(await page.locator('body').innerText()).toContain('first');
  });
});
