import * as http from 'node:http';
import type { Server } from 'node:http';

export interface AuthServerHandle {
  server: Server;
  baseUrl: string;
}

const DASHBOARD_HTML = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8" /><title>Dashboard</title></head>
<body>
  <div id="welcome" style="display:none">Welcome back!</div>
  <div id="anonymous">Please log in</div>
  <script>
    if (document.cookie.split('; ').some((c) => c.startsWith('session='))) {
      document.getElementById('welcome').style.display = 'block';
      document.getElementById('anonymous').style.display = 'none';
    }
  </script>
</body>
</html>`;

const PROFILE_HTML = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8" /><title>Profile</title></head>
<body>
  <div id="profile-name">loading...</div>
  <script>
    fetch('/api/profile')
      .then((res) => res.json())
      .then((profile) => { document.getElementById('profile-name').textContent = profile.name; });
  </script>
</body>
</html>`;

/**
 * A tiny server proving session state can be shared between an API-driven
 * step and a UI step: POST /login sets a `session` cookie via the API
 * client, and dashboard.html (a plain page, no JS framework) reflects it
 * purely from document.cookie - no token manually copy-pasted between the
 * two. See tests/hybridSession.spec.ts for how the two layers connect
 * (context.request shares its cookie jar with the browser context it
 * belongs to).
 */
export function startAuthServer(): Promise<AuthServerHandle> {
  const server = http.createServer((req, res) => {
    if (req.method === 'POST' && req.url === '/login') {
      let body = '';
      req.on('data', (chunk) => (body += chunk));
      req.on('end', () => {
        const { username, password } = JSON.parse(body || '{}');
        if (username === 'ada' && password === 'secret') {
          res.writeHead(200, {
            'Content-Type': 'application/json',
            'Set-Cookie': 'session=issued-by-api; Path=/',
          });
          res.end(JSON.stringify({ token: 'issued-by-api', user: username }));
        } else {
          res.writeHead(401, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'invalid_credentials' }));
        }
      });
      return;
    }

    if (req.method === 'GET' && req.url === '/dashboard.html') {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(DASHBOARD_HTML);
      return;
    }

    if (req.method === 'GET' && req.url === '/profile.html') {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(PROFILE_HTML);
      return;
    }

    // The real (unmocked) endpoint the page above fetches at runtime - see
    // tests/mockedProfile.spec.ts for overriding this with mockApiRoute()
    // instead of hitting this real handler.
    if (req.method === 'GET' && req.url === '/api/profile') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ name: 'Ada Lovelace' }));
      return;
    }

    res.writeHead(404);
    res.end();
  });

  return new Promise((resolve) => {
    server.listen(0, () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      resolve({ server, baseUrl: `http://127.0.0.1:${port}` });
    });
  });
}

export function stopAuthServer(handle: AuthServerHandle): Promise<void> {
  return new Promise((resolve, reject) => {
    handle.server.close((err) => (err ? reject(err) : resolve()));
  });
}
