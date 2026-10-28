import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as http from 'node:http';
import type { Server } from 'node:http';
import * as path from 'node:path';

/** What the server concluded about the session cookie of a request - recorded so a test can prove the cookie WAS (or was not) sent. */
export type SessionState = 'valid' | 'missing' | 'forged' | 'expired';

export interface AuthServerHandle {
  server: Server;
  baseUrl: string;
  /** Every request to a page or endpoint that depends on the session, in order, with what the server made of its cookie. */
  readonly seen: ReadonlyArray<{ path: string; session: SessionState }>;
  /** Mints a session cookie value the way `/login` does (for tests that plant a cookie by hand); `at` is the issue time in ms. */
  issueSession(user?: string, at?: number): string;
}

export interface AuthServerOptions {
  /** Signs the sessions this server issues and checks. A server with a different key does not know sessions another one issued. Default: see `loadSigningKey`. */
  signingKey?: string;
  /** How long a session lasts. Default one hour. */
  sessionSeconds?: number;
  /** The server's clock (ms) - a test moves it forward to expire a session without waiting. Default `Date.now`. */
  now?: () => number;
}

/** Where the default signing key lives: random per checkout, git-ignored with the rest of `.auth/`. */
const KEY_FILE = path.resolve(__dirname, '../../.auth/session.key');

/**
 * The key the sample servers sign sessions with: `AUTH_SESSION_KEY` if set, else a random key kept in `.auth/session.key`
 * (created on first use). One key shared by every server of this checkout is what lets the session saved by the `setup`
 * project (a different process, a server that no longer exists) be recognised by the server a later test starts - and a
 * server given another key is the "server that does not know this session".
 */
export function loadSigningKey(): string {
  if (process.env.AUTH_SESSION_KEY) return process.env.AUTH_SESSION_KEY;
  fs.mkdirSync(path.dirname(KEY_FILE), { recursive: true });
  try {
    fs.writeFileSync(KEY_FILE, crypto.randomBytes(32).toString('hex'), { flag: 'wx' }); // 'wx': never overwrite another worker's key
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
  }
  return fs.readFileSync(KEY_FILE, 'utf8').trim();
}

const sign = (key: string, payload: string) => crypto.createHmac('sha256', key).update(payload).digest('base64url');

/** `<payload>.<signature>`: the payload carries a random session id, the user and the expiry; the signature covers all of it. */
function mintSession(key: string, user: string, issuedAt: number, sessionSeconds: number): string {
  const payload = Buffer.from(JSON.stringify({ sid: crypto.randomBytes(16).toString('hex'), user, exp: issuedAt + sessionSeconds * 1000 })).toString('base64url');
  return `${payload}.${sign(key, payload)}`;
}

function checkSession(key: string, cookie: string | undefined, now: number): { state: SessionState; user?: string } {
  if (!cookie) return { state: 'missing' };
  const [payload, signature, ...rest] = cookie.split('.');
  if (!payload || !signature || rest.length > 0) return { state: 'forged' };
  const expected = Buffer.from(sign(key, payload));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !crypto.timingSafeEqual(expected, given)) return { state: 'forged' };
  try {
    const { user, exp } = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { user: string; exp: number };
    return now >= exp ? { state: 'expired' } : { state: 'valid', user };
  } catch {
    return { state: 'forged' };
  }
}

const cookieOf = (header: string | undefined, name: string): string | undefined =>
  header
    ?.split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`))
    ?.slice(name.length + 1);

/** Rendered by the server: whether the welcome banner or the login prompt is in the page is decided by the session, not by a script in the browser. */
const dashboardHtml = (signedIn: boolean) => `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8" /><title>Dashboard</title></head>
<body>
  ${signedIn ? '<div id="welcome">Welcome back!</div>' : '<div id="anonymous">Please log in</div>'}
</body>
</html>`;

const PROFILE_HTML = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8" /><title>Profile</title></head>
<body>
  <div id="profile-name">loading...</div>
  <script>
    fetch('/api/profile')
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error('not signed in'))))
      .then((profile) => { document.getElementById('profile-name').textContent = profile.name; })
      .catch(() => { document.getElementById('profile-name').textContent = 'Please log in to see your profile'; });
  </script>
</body>
</html>`;

// Mimics UI5's real id convention (an auto-generated view/component path
// prefix, then "--", then the developer-assigned logical id) - the same
// fixture shape referenced-automation-sap's own tests use to prove
// byControlId/waitForUI5Ready, reused here to demo those same helpers
// from within this hybrid repo's test suite.
const FIORI_STYLE_HTML = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8" /><title>Fiori-style fixture</title></head>
<body>
  <button id="__component0---mainView--addToCartBtn">Add to cart</button>
  <div id="busy-overlay" class="sapUiLocalBusyIndicator" style="display:none;">Loading...</div>
  <script>
    document.getElementById('__component0---mainView--addToCartBtn').addEventListener('click', () => {
      const overlay = document.getElementById('busy-overlay');
      overlay.style.display = 'block';
      setTimeout(() => { overlay.style.display = 'none'; }, 300);
    });
  </script>
</body>
</html>`;

/**
 * A tiny server proving session state can be shared between an API-driven
 * step and a UI step: POST /login issues a signed session (a random id, the user and an expiry, signed with the server's
 * key) as an HttpOnly `session` cookie, and the server itself checks that cookie - for dashboard.html (rendered for the
 * session it finds), for /api/profile (401 without a valid one) - so a forged, expired or missing cookie gets the
 * anonymous page, never the welcome. See features/hybrid-login.feature for how the two layers connect (the API client is built on
 * context.request, which shares its cookie jar with the browser context it belongs to) and features/session-validation.feature
 * for what it must reject.
 */
export function startAuthServer(options: AuthServerOptions = {}): Promise<AuthServerHandle> {
  const key = options.signingKey ?? loadSigningKey();
  const sessionSeconds = options.sessionSeconds ?? 3600;
  const now = options.now ?? Date.now;
  const seen: Array<{ path: string; session: SessionState }> = [];
  const sessionOf = (req: http.IncomingMessage, pathName: string) => {
    const result = checkSession(key, cookieOf(req.headers.cookie, 'session'), now());
    seen.push({ path: pathName, session: result.state });
    return result;
  };

  const server = http.createServer((req, res) => {
    if (req.method === 'POST' && req.url === '/login') {
      let body = '';
      req.on('data', (chunk) => (body += chunk));
      req.on('end', () => {
        const { username, password } = JSON.parse(body || '{}');
        if (username === 'ada' && password === 'secret') {
          const session = mintSession(key, username, now(), sessionSeconds);
          res.writeHead(200, {
            'Content-Type': 'application/json',
            'Set-Cookie': `session=${session}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${sessionSeconds}`,
          });
          res.end(JSON.stringify({ token: session, user: username }));
        } else {
          res.writeHead(401, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'invalid_credentials' }));
        }
      });
      return;
    }

    if (req.method === 'GET' && req.url === '/dashboard.html') {
      const session = sessionOf(req, '/dashboard.html');
      res.writeHead(200, { 'Content-Type': 'text/html', 'Cache-Control': 'no-store' });
      res.end(dashboardHtml(session.state === 'valid'));
      return;
    }

    if (req.method === 'GET' && req.url === '/profile.html') {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(PROFILE_HTML);
      return;
    }

    if (req.method === 'GET' && req.url === '/fiori-style.html') {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(FIORI_STYLE_HTML);
      return;
    }

    // The real (unmocked) endpoint the page above fetches at runtime - it needs a valid session; see
    // features/mocked-profile.feature for overriding it with mockApiRoute() instead of hitting this real handler.
    if (req.method === 'GET' && req.url === '/api/profile') {
      const session = sessionOf(req, '/api/profile');
      if (session.state !== 'valid') {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'unauthenticated', session: session.state }));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ name: 'Ada Lovelace', user: session.user }));
      return;
    }

    res.writeHead(404);
    res.end();
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      resolve({ server, baseUrl: `http://127.0.0.1:${port}`, seen, issueSession: (user = 'ada', at = now()) => mintSession(key, user, at, sessionSeconds) });
    });
  });
}

export function stopAuthServer(handle: AuthServerHandle): Promise<void> {
  return new Promise((resolve, reject) => {
    handle.server.close((err) => (err ? reject(err) : resolve()));
  });
}
