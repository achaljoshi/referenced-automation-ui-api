import { ApiClient } from '@automation/referenced-automation-api';
import { request as playwrightRequest, type APIRequestContext } from '@playwright/test';
import { startAuthServer, stopAuthServer, type AuthServerHandle, type AuthServerOptions, type SessionState } from '../../../tests/support/authServer';
import type { Cleanups } from './cleanups';

/** The cookies a forger can hand the sample server: each must be refused, whatever the trick. */
export const FORGERIES: Record<string, (server: AuthServerHandle) => string> = {
  'the constant the old server handed out': () => 'issued-by-api',
  "a valid payload with someone else's signature": (server) => `${server.issueSession('ada').split('.')[0]}.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA`,
  'a different user under the real signature': (server) => {
    const [, signature] = server.issueSession('ada').split('.');
    const admin = Buffer.from(JSON.stringify({ sid: 'x', user: 'admin', exp: Date.now() + 3_600_000 })).toString('base64url');
    return `${admin}.${signature}`;
  },
  'an unsigned payload': (server) => server.issueSession('ada').split('.')[0] as string,
};

/**
 * What one session scenario carries between steps: which sample server it is talking to (the worker's shared one until a step
 * starts another), the clock of a server whose time a step moves on, and an API connection that does not share the browser's
 * cookies. Everything started here is stopped when the scenario ends.
 */
export class SessionScenario {
  /** The server the "the server recognised ..." steps ask. */
  server: AuthServerHandle;
  private clock?: { now: number };
  private detached?: { context: APIRequestContext; api: ApiClient };

  constructor(
    readonly shared: AuthServerHandle,
    private readonly cleanups: Cleanups,
  ) {
    this.server = shared;
  }

  async startServer(options: AuthServerOptions = {}): Promise<AuthServerHandle> {
    const server = await startAuthServer(options);
    this.cleanups.add(() => stopAuthServer(server));
    this.server = server;
    return server;
  }

  /** A server whose sessions last `sessionSeconds` and whose clock only moves when `moveClock` says so. */
  startServerWithClock(sessionSeconds: number): Promise<AuthServerHandle> {
    const clock = { now: Date.now() };
    this.clock = clock;
    return this.startServer({ now: () => clock.now, sessionSeconds });
  }

  moveClock(seconds: number): void {
    if (!this.clock) throw new Error('No server with a clock of its own: add "Given another sample server whose sessions last N seconds" first');
    this.clock.now += seconds * 1000;
  }

  forgedSession(how: string): string {
    const forge = FORGERIES[how];
    if (!forge) throw new Error(`Unknown forgery "${how}". Use one of: ${Object.keys(FORGERIES).join(', ')}`);
    return forge(this.server);
  }

  /** What the server concluded about the session cookie of the last dashboard request. */
  lastDashboardSession(): SessionState | undefined {
    return this.server.seen.filter((request) => request.path === '/dashboard.html').pop()?.session;
  }

  /** An API connection with its OWN cookie jar - not the browser context's - so a login through it never reaches the browser. */
  async detachedApi(): Promise<{ context: APIRequestContext; api: ApiClient }> {
    if (!this.detached) {
      const context = await playwrightRequest.newContext();
      this.cleanups.add(() => context.dispose());
      this.detached = { context, api: new ApiClient(context, this.server.baseUrl) };
    }
    return this.detached;
  }
}
