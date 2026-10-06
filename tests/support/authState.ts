import * as path from 'node:path';

/** Where tests/auth.setup.ts saves the logged-in browser state, and where every project reads it from. Git-ignored. */
export const AUTH_FILE = path.resolve(__dirname, '../../.auth/user.json');

/** A browser context with no cookies - for tests whose point is the anonymous state, or doing the login themselves. */
export const ANONYMOUS = { cookies: [], origins: [] };
