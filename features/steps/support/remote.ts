import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { ApiClient, RemoteRequestContext, type ApiResponse } from '@automation/referenced-automation-api';
import { remote, testing } from '@automation/referenced-automation-utils';
import type { AuthServerHandle } from '../../../tests/support/authServer';
import type { Cleanups } from './cleanups';

/**
 * A remote host - here the remote-desktop utility's stand-in agent, a Node program that speaks the same folder protocol as the
 * PowerShell agent, so this proves the wiring and NOT a real RDP session (NOT VERIFIED on a real host). In a real project
 * the RemoteHost comes from `remote.getRemoteHost()` (REMOTE_ENABLED=true and the REMOTE_* keys in .env.<env>.local) and
 * nothing else changes.
 */
export interface StandInHost {
  host: remote.RemoteHost;
  agent: InstanceType<typeof testing.StandInAgent>;
  shareDir: string;
}

export async function startStandInHost(prefix: string): Promise<StandInHost> {
  const shareDir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const agent = new testing.StandInAgent({ shareDir });
  await agent.start();
  const host = new remote.RemoteHost(testing.standInRemoteConfig(shareDir));
  await host.connect();
  return { host, agent, shareDir };
}

export async function stopStandInHost({ host, agent, shareDir }: StandInHost): Promise<void> {
  try {
    await host.close();
  } finally {
    try {
      await agent.stop();
    } finally {
      fs.rmSync(shareDir, { recursive: true, force: true });
    }
  }
}

/**
 * What one scenario does on the shared remote host: API calls made FROM it (the base URL is as the remote host sees it) and
 * database statements run ON it (the stand-in uses an in-memory SQLite; a real host uses REMOTE_DB_PROVIDER).
 */
export class RemoteScenario {
  private readonly api: ApiClient;
  private readonly db: remote.RemoteDbClient;
  private last?: ApiResponse;
  private seenBefore = 0;

  constructor(
    host: remote.RemoteHost,
    private readonly server: AuthServerHandle,
  ) {
    this.api = new ApiClient(new RemoteRequestContext(host).asApiRequestContext(), server.baseUrl);
    this.db = new remote.RemoteDbClient(host, { provider: 'sqlite', connectionString: ':memory:' });
  }

  async send(method: Parameters<ApiClient['request']>[0], pathName: string, options: Parameters<ApiClient['request']>[2] = {}): Promise<void> {
    this.seenBefore = this.server.seen.length;
    this.last = await this.api.request(method, pathName, options);
  }

  response(): ApiResponse {
    if (!this.last) throw new Error('The remote host has sent no request yet: add "When the remote host sends a ... request" first');
    return this.last;
  }

  /** Whether the sample server recorded a request after the last one the remote host sent (it records the ones that depend on a session). */
  serverSawNewRequest(): boolean {
    return this.server.seen.length > this.seenBefore;
  }

  async storeNote(id: number, note: string): Promise<void> {
    await this.db.update('CREATE TABLE IF NOT EXISTS checks (id INTEGER, note TEXT)');
    await this.db.update('INSERT INTO checks VALUES (?, ?)', [id, note]);
  }

  readNote(id: number): Promise<unknown> {
    return this.db.queryScalar('SELECT note FROM checks WHERE id = ?', [id]);
  }
}

/** A remote host of the scenario's own, whose agent a step may stop - without touching the shared host the other scenarios use. */
export class OwnRemoteHost {
  private own?: StandInHost;

  constructor(private readonly cleanups: Cleanups) {}

  async start(): Promise<void> {
    const own = await startStandInHost('ui-api-remote-dead-');
    this.own = own;
    this.cleanups.add(async () => {
      await own.agent.stop().catch(() => undefined);
      fs.rmSync(own.shareDir, { recursive: true, force: true });
    });
  }

  private started(): StandInHost {
    if (!this.own) throw new Error('No remote host of its own yet: add "Given a remote host with an agent of its own" first');
    return this.own;
  }

  crashAgent(): Promise<void> {
    return this.started().agent.crash();
  }

  ping(): Promise<unknown> {
    return this.started().host.ping();
  }
}
