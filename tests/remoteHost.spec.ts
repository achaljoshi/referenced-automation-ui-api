import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { test, expect } from '@automation/referenced-automation-ui';
import { ApiClient, RemoteRequestContext } from '@automation/referenced-automation-api';
import { remote, testing } from '@automation/referenced-automation-utils';
import { startAuthServer, stopAuthServer, type AuthServerHandle } from './support/authServer';
import { ANONYMOUS } from './support/authState';
import { createDashboardPage } from './support/DashboardPage';

/**
 * One test, two machines: the UI steps run in a browser on the test machine (for example an AWS WorkSpace), and the API
 * and database steps run on the remote RDP host through the remote-desktop utility (docs/REMOTE_DESKTOP.md in
 * referenced-automation-utils). Here the "remote host" is the utility's stand-in agent, a Node program that speaks the
 * same folder protocol as the PowerShell agent - so this proves the wiring, NOT a real RDP session (NOT VERIFIED on a real
 * host). In a real project the RemoteHost comes from `remote.getRemoteHost()` (REMOTE_ENABLED=true and the REMOTE_* keys in
 * .env.<env>.local) and nothing else in the test changes.
 */
test.use({ storageState: ANONYMOUS });

let server: AuthServerHandle;
let shareDir: string;
let agent: InstanceType<typeof testing.StandInAgent>;
let host: remote.RemoteHost;

test.beforeAll(async () => {
  server = await startAuthServer();
  shareDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ui-api-remote-'));
  agent = new testing.StandInAgent({ shareDir });
  await agent.start();
  host = new remote.RemoteHost(testing.standInRemoteConfig(shareDir));
  await host.connect();
});

test.afterAll(async () => {
  await host.close();
  await agent.stop();
  fs.rmSync(shareDir, { recursive: true, force: true });
  await stopAuthServer(server);
});

test.describe('UI steps here, API and database steps on the remote host', () => {
  test('the browser sees the anonymous page, then the REMOTE host logs in and reads the profile @e2e', async ({ page }) => {
    // 1. UI step on the test machine
    const dashboard = createDashboardPage(page);
    await dashboard.goto(`${server.baseUrl}/dashboard.html`);
    await dashboard.expectAnonymous();

    // 2. API steps made FROM the remote host (the base URL is as the remote host sees it)
    const remoteApi = new ApiClient(new RemoteRequestContext(host).asApiRequestContext(), server.baseUrl);
    const login = await remoteApi.post('/login', { json: { username: 'ada', password: 'secret' } });
    login.expectStatus(200).expectValue('user', 'ada');
    const before = server.seen.length;
    const unauthenticated = await remoteApi.get('/api/profile');
    expect(unauthenticated.status(), 'the remote call carries no browser session, so the server must refuse it').toBe(401);
    expect(server.seen.length).toBeGreaterThan(before); // the request really reached the server, from the host
  });

  test('a database step on the remote host writes and reads back @regression', async () => {
    // 3. database steps on the remote host (the stand-in uses an in-memory SQLite; a real host uses REMOTE_DB_PROVIDER)
    const db = new remote.RemoteDbClient(host, { provider: 'sqlite', connectionString: ':memory:' });
    await db.update('CREATE TABLE IF NOT EXISTS checks (id INTEGER, note TEXT)');
    await db.update('INSERT INTO checks VALUES (?, ?)', [1, 'created in the UI test']);
    expect(await db.queryScalar('SELECT note FROM checks WHERE id = ?', [1])).toBe('created in the UI test');
  });

  test('when the remote agent stops, the failure says so instead of hanging @regression', async () => {
    const own = fs.mkdtempSync(path.join(os.tmpdir(), 'ui-api-remote-dead-'));
    const dead = new testing.StandInAgent({ shareDir: own });
    await dead.start();
    const dedicated = new remote.RemoteHost(testing.standInRemoteConfig(own));
    await dedicated.connect();
    try {
      await dead.crash();
      await expect(dedicated.ping()).rejects.toMatchObject({ code: 'AGENT_STALE' });
    } finally {
      await dead.stop().catch(() => undefined);
      fs.rmSync(own, { recursive: true, force: true });
    }
  });
});
