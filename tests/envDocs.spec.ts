import * as fs from 'node:fs';
import * as path from 'node:path';
import { expect, test } from '@playwright/test';

/**
 * Drift guard for the configuration reference: `.env.example` documents EVERY environment variable this repo reads
 * (or that the shared packages read on its behalf), the README table lists the same set, and `.env.local.example` has a
 * template line for every secret. The checks are plain functions, exported below, so the negative controls can prove each
 * one fails on a bad input.
 *
 * What is scanned (comments are stripped first, so a variable only mentioned in a comment does not count):
 *   own code   playwright.config.ts, every .ts under tests/ and features/ (specs included, except the two documentation
 *              guards themselves - envDocs.spec.ts and windowsDocs.spec.ts hold synthetic snippets), features/*.feature
 *              ({{env:NAME}}), scripts/*.sh and scripts/*.bat (variables read but not assigned in the script),
 *              .gitlab-ci.yml (the CI_* variables GitLab itself provides are ignored).
 *              Patterns: <anything>.get / getOptional / getInt / getBoolean / getList('NAME'), process.env.NAME,
 *              process.env['NAME'] (also `process.env.NAME ??=`), baseUrlKey: 'NAME'.
 *   shared     the BUILT files of @automation/referenced-automation-utils that createPlaywrightConfig, the logger, the random
 *              utilities and loadEnv run: dist/playwright/config.js, logger/logger.js, random/randomUtils.js, config/env.js.
 *   all dist   every dist/**\/*.js of the four @automation packages (utils, api, ui, sap): a key listed in .env.example is
 *              acceptable when one of them reads it (REMOTE_*, API_VIA_REMOTE, SAP_*), even if this repo's own code does not.
 * Not scanned: a variable that is only read through a computed name (process.env[name]).
 */
const root = path.resolve(__dirname, '..');
const read = (relative: string) => fs.readFileSync(path.join(root, relative), 'utf8');
const DOC_GUARDS = new Set(['tests/envDocs.spec.ts', 'tests/windowsDocs.spec.ts']);
const NAME = '[A-Z][A-Z0-9_]*';

/** Keys that are read by something this scan cannot see; each needs a reason. Everything else in .env.example must be read by the code. */
export const PASS_THROUGH: Record<string, string> = {
  TZ: 'Node itself reads it (the process time zone); no JavaScript in this repo or the @automation packages mentions it',
};

// ---- comment stripping ------------------------------------------------------------------------------------------------

/** Removes block comments and `//` comments that start a line or follow whitespace (so `http://x` in a string survives). */
export function stripJsComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '$1');
}
/** Removes whole-line `#` comments (shell, YAML, Gherkin, dotenv). */
export function stripHashComments(source: string): string {
  return source.replace(/^\s*#.*$/gm, '');
}
/** Removes whole-line `REM` and `::` comments of a batch file. */
export function stripBatchComments(source: string): string {
  return source.replace(/^\s*(?:REM\b|::).*$/gim, '');
}

// ---- what a source reads ----------------------------------------------------------------------------------------------

/** Variables read by TypeScript / JavaScript: config readers (`env.get('X')`, `loadEnv().getInt('X')`), process.env.X, process.env['X'], baseUrlKey: 'X'. */
export function readsFromScript(source: string): Set<string> {
  const code = stripJsComments(source);
  const found = new Set<string>();
  const patterns = [
    new RegExp(`\\.(?:get|getOptional|getInt|getBoolean|getList)\\(\\s*['"\`](${NAME})['"\`]`, 'g'),
    /process\.env\.([A-Za-z_][A-Za-z0-9_]*)/g,
    /process\.env\[\s*['"`]([A-Za-z_][A-Za-z0-9_]*)['"`]\s*\]/g,
    new RegExp(`baseUrlKey\\s*(?:\\?\\?|:)\\s*['"](${NAME})['"]`, 'g'),
  ];
  for (const pattern of patterns) for (const match of code.matchAll(pattern)) found.add(match[1] as string);
  return found;
}

/** Variables a bash script reads (`$X`, `${X:-}`) without assigning them itself: those come from the caller's environment. */
export function readsFromShell(source: string): Set<string> {
  const code = stripHashComments(source);
  const assigned = new Set<string>();
  for (const m of code.matchAll(new RegExp(`^\\s*(?:export\\s+|local\\s+|readonly\\s+)?(${NAME})=`, 'gm'))) assigned.add(m[1] as string);
  for (const m of code.matchAll(new RegExp(`\\bfor\\s+(${NAME})\\s+in\\b`, 'g'))) assigned.add(m[1] as string);
  const found = new Set<string>();
  for (const m of code.matchAll(new RegExp(`\\$\\{?(${NAME})`, 'g'))) if (!assigned.has(m[1] as string)) found.add(m[1] as string);
  return found;
}

/** Variables a cmd batch file reads (`%X%`, `if defined X`) without a `set X=` of its own. */
export function readsFromBatch(source: string): Set<string> {
  const code = stripBatchComments(source);
  const assigned = new Set<string>(['ERRORLEVEL', 'CD', 'DATE', 'TIME', 'RANDOM']);
  for (const m of code.matchAll(new RegExp(`\\bset\\s+(?:/[a-z]\\s+)?"?(${NAME})=`, 'gi'))) assigned.add(m[1] as string);
  const found = new Set<string>();
  const reads = [...code.matchAll(new RegExp(`(?<!%)%(${NAME})%`, 'g')), ...code.matchAll(new RegExp(`\\bdefined\\s+(${NAME})`, 'gi'))];
  for (const m of reads) if (!assigned.has((m[1] as string).toUpperCase())) found.add(m[1] as string);
  return found;
}

/** Variables a GitLab pipeline reads (`$X`, `${X:-}`); the CI_* variables are GitLab's own. */
export function readsFromPipeline(source: string): Set<string> {
  const found = new Set<string>();
  for (const m of stripHashComments(source).matchAll(new RegExp(`\\$\\{?(${NAME})`, 'g'))) if (!/^CI_/.test(m[1] as string)) found.add(m[1] as string);
  return found;
}

/** Variables a Gherkin feature reads with `{{env:NAME}}` or `{{env:NAME|fallback}}`. */
export function readsFromFeature(source: string): Set<string> {
  const found = new Set<string>();
  for (const m of stripHashComments(source).matchAll(new RegExp(`\\{\\{env:(${NAME})`, 'g'))) found.add(m[1] as string);
  return found;
}

// ---- .env.example ----------------------------------------------------------------------------------------------------

export interface EnvEntry {
  name: string;
  /** The comment lines directly above the variable line (no blank line between). */
  comment: string[];
  line: number;
}

/** One entry per commented variable line `# NAME=...`, with the comment block directly above it. */
export function parseEnvExample(text: string): EnvEntry[] {
  const entries: EnvEntry[] = [];
  let pending: string[] = [];
  text.split(/\r?\n/).forEach((line, index) => {
    if (line.trim() === '') {
      pending = [];
      return;
    }
    const variable = new RegExp(`^# (${NAME})=`).exec(line);
    if (variable) {
      entries.push({ name: variable[1] as string, comment: pending, line: index + 1 });
      pending = [];
    } else if (line.startsWith('#')) {
      pending.push(line);
    } else {
      pending = [];
    }
  });
  return entries;
}

export const secretOf = (entry: EnvEntry): 'YES' | 'no' | undefined => {
  const match = /\| Secret: (YES|no)\b/.exec(entry.comment.join('\n'));
  return match ? (match[1] as 'YES' | 'no') : undefined;
};

/** Problems with the metadata lines of every entry: Read from, Values, Default, Required, Secret, Example (and a description above them). */
export function metadataProblems(entries: EnvEntry[]): string[] {
  const problems: string[] = [];
  for (const entry of entries) {
    const text = entry.comment.join('\n');
    const need: Array<[string, RegExp]> = [
      ['Read from:', /^# Read from: \S/m],
      ['Values:', /^# Values: \S/m],
      ['Default:', /^# Default: \S/m],
      ['Required:', /\| Required: \S/],
      ['Secret:', /\| Secret: (?:YES|no)\b/],
      ['Example:', new RegExp(`^# Example(?: \\([^)]*\\))?: ${entry.name}=`, 'm')],
    ];
    for (const [label, pattern] of need) if (!pattern.test(text)) problems.push(`${entry.name} (line ${entry.line}): the comment block lacks "${label}"`);
    const first = entry.comment[0] ?? '';
    if (!first || /^# (?:Read from|Values|Default|Example)/.test(first)) problems.push(`${entry.name} (line ${entry.line}): no description line above the metadata`);
    if (secretOf(entry) === 'YES' && !/Secret: YES - /.test(text)) problems.push(`${entry.name}: "Secret: YES" must say where the value goes ("Secret: YES - .env.<name>.local ...")`);
  }
  return problems;
}

/** Variables the code reads that `.env.example` does not document. */
export function undocumented(reads: Iterable<string>, entries: EnvEntry[]): string[] {
  const documented = new Set(entries.map((entry) => entry.name));
  return [...new Set(reads)].filter((name) => !documented.has(name)).sort();
}

/** Documented variables that nothing reads: not this repo's code, not the shared packages, and not on the pass-through list. */
export function unreadEntries(entries: EnvEntry[], readSets: Array<Set<string>>, passThrough: Record<string, string> = PASS_THROUGH): string[] {
  const read = new Set(readSets.flatMap((set) => [...set]));
  return entries.map((entry) => entry.name).filter((name) => !read.has(name) && !(name in passThrough)).sort();
}

/** The "TIP - quoting values" paragraph must appear exactly once. */
export const tipCount = (text: string): number => text.split(/\r?\n/).filter((line) => /^# TIP - quoting values/.test(line)).length;

// ---- README table -----------------------------------------------------------------------------------------------------

/** The rows of the Configuration reference table: name -> value of the Secret column. */
export function readmeTable(readme: string): { header: string[]; rows: Map<string, string>; duplicates: string[] } {
  const start = readme.search(/^## Configuration reference\s*$/m);
  const section = start < 0 ? '' : readme.slice(start).split(/^## (?!Configuration reference)/m)[0] ?? '';
  const rows = new Map<string, string>();
  const duplicates: string[] = [];
  let header: string[] = [];
  for (const line of section.split(/\r?\n/)) {
    if (!line.startsWith('|')) continue;
    const cells = line.replace(/^\||\|\s*$/g, '').split('|').map((cell) => cell.trim());
    if (cells[0] === 'Name') header = cells;
    const name = new RegExp(`^\`(${NAME})\`$`).exec(cells[0] ?? '');
    if (!name) continue;
    if (rows.has(name[1] as string)) duplicates.push(name[1] as string);
    rows.set(name[1] as string, cells.length === 5 ? (cells[4] as string) : `(${cells.length} columns)`);
  }
  return { header, rows, duplicates };
}

/** Differences between the README table and `.env.example`: missing or extra names, a wrong Secret column, a wrong header. */
export function tableProblems(entries: EnvEntry[], readme: string): string[] {
  const { header, rows, duplicates } = readmeTable(readme);
  const problems: string[] = [];
  if (header.join(' | ') !== 'Name | Purpose | Default | Required | Secret') problems.push(`the table header is "${header.join(' | ')}", expected "Name | Purpose | Default | Required | Secret"`);
  for (const name of duplicates) problems.push(`${name} is listed twice in the README table`);
  const documented = new Map(entries.map((entry) => [entry.name, secretOf(entry)] as const));
  for (const [name, secret] of documented) {
    if (!rows.has(name)) problems.push(`${name} is in .env.example but not in the README table`);
    else if (rows.get(name) !== secret) problems.push(`${name}: Secret is "${rows.get(name)}" in the README table but "${secret}" in .env.example`);
  }
  for (const name of rows.keys()) if (!documented.has(name)) problems.push(`${name} is in the README table but not in .env.example`);
  return problems;
}

// ---- .env.local.example ----------------------------------------------------------------------------------------------

/** Every `Secret: YES` key has a template line with a "<placeholder>" in double quotes; nothing else is there, and nothing looks like a real secret. */
export function localExampleProblems(entries: EnvEntry[], localExample: string): string[] {
  const problems: string[] = [];
  const secrets = entries.filter((entry) => secretOf(entry) === 'YES').map((entry) => entry.name);
  const lines = new Map<string, string>();
  for (const line of localExample.split(/\r?\n/)) {
    const match = new RegExp(`^(?:# )?(${NAME})=(.*)$`).exec(line);
    if (match) lines.set(match[1] as string, match[2] as string);
  }
  for (const name of secrets) if (!lines.has(name)) problems.push(`${name} is a secret in .env.example but has no line in .env.local.example`);
  for (const [name, value] of lines) {
    if (!secrets.includes(name)) problems.push(`${name} is in .env.local.example but is not a "Secret: YES" key of .env.example`);
    if (!/^"<[a-z][a-z0-9 -]*>"$/.test(value)) problems.push(`${name}: the value ${value} is not a "<placeholder>" in double quotes - it must not look like a real secret`);
  }
  return problems;
}

// ---- gathering the sources --------------------------------------------------------------------------------------------

const walk = (dir: string, accept: (file: string) => boolean): string[] =>
  fs.existsSync(path.join(root, dir))
    ? fs.readdirSync(path.join(root, dir), { withFileTypes: true }).flatMap((entry) => {
        const relative = `${dir}/${entry.name}`;
        return entry.isDirectory() ? walk(relative, accept) : accept(relative) ? [relative] : [];
      })
    : [];

/** What this repo's own files read, per file (so a failure can say where). */
export function ownReads(): Map<string, Set<string>> {
  const reads = new Map<string, Set<string>>();
  const scripts = ['playwright.config.ts', ...walk('tests', (f) => f.endsWith('.ts') && !DOC_GUARDS.has(f)), ...walk('features', (f) => f.endsWith('.ts'))];
  for (const file of scripts) reads.set(file, readsFromScript(read(file)));
  for (const file of walk('features', (f) => f.endsWith('.feature'))) reads.set(file, readsFromFeature(read(file)));
  for (const file of walk('scripts', (f) => f.endsWith('.sh'))) reads.set(file, readsFromShell(read(file)));
  for (const file of walk('scripts', (f) => f.endsWith('.bat'))) reads.set(file, readsFromBatch(read(file)));
  reads.set('.gitlab-ci.yml', readsFromPipeline(read('.gitlab-ci.yml')));
  return reads;
}

const utilsDist = path.join(root, 'node_modules', '@automation', 'referenced-automation-utils', 'dist');
export const SHARED_FILES = ['playwright/config.js', 'logger/logger.js', 'random/randomUtils.js', 'config/env.js'];

/** The keys the shared utils code reads: createPlaywrightConfig, the logger, the random utilities, loadEnv (ENV / ENVIRONMENT). */
export function sharedReads(): Map<string, Set<string>> {
  const reads = new Map<string, Set<string>>();
  for (const file of SHARED_FILES) {
    const full = path.join(utilsDist, file);
    expect(fs.existsSync(full), `${full} must exist: install and build the dependencies (README: Windows first run)`).toBe(true);
    reads.set(file, readsFromScript(fs.readFileSync(full, 'utf8')));
  }
  return reads;
}

/** Everything any @automation package's dist reads. */
export function allDistReads(): Set<string> {
  const found = new Set<string>();
  const packages = path.join(root, 'node_modules', '@automation');
  const files = (dir: string): string[] =>
    fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => (entry.isDirectory() ? files(path.join(dir, entry.name)) : entry.name.endsWith('.js') ? [path.join(dir, entry.name)] : []));
  for (const pkg of fs.readdirSync(packages)) {
    const dist = path.join(packages, pkg, 'dist');
    if (!fs.existsSync(dist)) continue;
    for (const file of files(dist)) for (const name of readsFromScript(fs.readFileSync(file, 'utf8'))) found.add(name);
  }
  return found;
}

const union = (maps: Map<string, Set<string>>): Set<string> => new Set([...maps.values()].flatMap((set) => [...set]));
const where = (maps: Map<string, Set<string>>, names: string[]): string =>
  names.map((name) => `${name} (${[...maps].filter(([, set]) => set.has(name)).map(([file]) => file).join(', ')})`).join('; ');

// ---- the tests --------------------------------------------------------------------------------------------------------

test.describe('configuration reference: .env.example, README table, .env.local.example', () => {
  const example = read('.env.example');
  const entries = parseEnvExample(example);

  test('the scan sees what it should - it cannot pass by finding nothing', () => {
    const own = ownReads();
    const ownKeys = union(own);
    const shared = union(sharedReads());
    const dist = allDistReads();
    expect(shared.size, 'shared keys found in the built utils files').toBeGreaterThanOrEqual(30);
    expect(ownKeys.size, 'keys this repo reads itself').toBeGreaterThanOrEqual(12);
    expect(dist.size, 'keys any @automation package reads').toBeGreaterThanOrEqual(80);
    expect(entries.length, 'variables documented in .env.example').toBeGreaterThanOrEqual(60);
    for (const key of ['BROWSER', 'HEADLESS', 'DEVICE', 'RETRIES', 'TEST_TIMEOUT_MS', 'LOG_LEVEL', 'LOG_FILE_PER_WORKER', 'RANDOM_SEED', 'ENV', 'ENVIRONMENT', 'BASE_URL', 'CI', 'TEST_WORKER_INDEX']) {
      expect(shared.has(key), `${key} should be discovered in the shared utils files`).toBe(true);
    }
    for (const key of ['AUTH_SESSION_KEY', 'API_PASSWORD', 'HYBRID_PASSWORD', 'SAP_USER', 'SAP_PASSWORD', 'SAP_CLIENT', 'BASE_URL', 'NPM_REGISTRY_URL', 'USE_LOCAL_PACKAGES', 'PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD', 'PLAYWRIGHT_DOWNLOAD_HOST', 'AUDIT_RUN_GATES']) {
      expect(ownKeys.has(key), `${key} should be discovered in this repo's own files`).toBe(true);
    }
    for (const key of ['REMOTE_ENABLED', 'REMOTE_RDP_HOST', 'API_VIA_REMOTE', 'REMOTE_API_BASE_URL', 'SAP_GUI_MODE', 'SAP_GUI_SIMULATOR', 'SAP_GUI_TRANSPORT']) {
      expect(dist.has(key), `${key} should be discovered in the @automation packages' dist`).toBe(true);
    }
    for (const key of ['BROWSER', 'AUTH_SESSION_KEY', 'SAP_GUI_MODE', 'REMOTE_RDP_PASSWORD', 'NPM_REGISTRY_URL', 'TZ']) {
      expect(entries.map((entry) => entry.name), `.env.example should document ${key}`).toContain(key);
    }
  });

  test('(a) every variable this repo reads is documented in .env.example', () => {
    const own = ownReads();
    const missing = undocumented(union(own), entries);
    expect(missing, `read by the code but missing from .env.example: ${where(own, missing)}`).toEqual([]);
  });

  test('(b) every shared key createPlaywrightConfig, the logger and loadEnv read is documented in .env.example', () => {
    const shared = sharedReads();
    const missing = undocumented(union(shared), entries);
    expect(missing, `read by the shared utils code but missing from .env.example: ${where(shared, missing)}`).toEqual([]);
  });

  test('(c) .env.example lists no variable that nothing reads', () => {
    const unread = unreadEntries(entries, [union(ownReads()), union(sharedReads()), allDistReads()]);
    expect(unread, 'documented but read by no code here or in the @automation packages (add it to PASS_THROUGH with a reason only if something outside reads it)').toEqual([]);
  });

  test('(c) every pass-through entry is documented, justified, and really not read by any scanned code', () => {
    const scanned = [union(ownReads()), union(sharedReads()), allDistReads()];
    for (const [name, reason] of Object.entries(PASS_THROUGH)) {
      expect(reason.length, `${name} needs a reason`).toBeGreaterThan(20);
      expect(entries.map((entry) => entry.name), `${name} is on the pass-through list but not in .env.example`).toContain(name);
      expect(scanned.some((set) => set.has(name)), `${name} is read by scanned code, so it does not belong on the pass-through list`).toBe(false);
    }
  });

  test('(d) every variable block has Read from, Values, Default, Required, Secret and Example lines', () => {
    expect(metadataProblems(entries)).toEqual([]);
    expect(new Set(entries.map((entry) => entry.name)).size, 'a variable is documented twice').toBe(entries.length);
  });

  test('(e) the README Configuration reference table lists the same keys as .env.example, with the same Secret marks', () => {
    const readme = read('README.md');
    expect(tableProblems(entries, readme)).toEqual([]);
    expect(readme.slice(readme.search(/^## Configuration reference\s*$/m)), 'the section links to the utils reference for the shared keys').toContain('referenced-automation-utils/blob/master/.env.example');
  });

  test('(f) .env.local.example has a placeholder line for every Secret: YES key and nothing real-looking', () => {
    expect(entries.filter((entry) => secretOf(entry) === 'YES').length, 'secret keys in .env.example').toBeGreaterThanOrEqual(5);
    expect(localExampleProblems(entries, read('.env.local.example'))).toEqual([]);
  });

  test('(g) the quoting TIP appears exactly once in .env.example', () => {
    expect(tipCount(example)).toBe(1);
  });

  test('the committed .env.<name> files and .env.local.example carry no secret values', () => {
    for (const file of ['.env.dev', '.env.qa', '.env.stage']) {
      const keys = read(file).split(/\r?\n/).filter((line) => /^[A-Z]/.test(line)).map((line) => line.split('=')[0] as string);
      const secrets = entries.filter((entry) => secretOf(entry) === 'YES').map((entry) => entry.name);
      expect(keys.filter((key) => secrets.includes(key)), `${file} must not hold a secret key`).toEqual([]);
    }
  });
});

test.describe('negative controls: each check reports a bad input', () => {
  const documented = (block: string) => parseEnvExample(`# =====\n\n${block}\n`);
  const GOOD = [
    '# What it is for.',
    '# Read from: .env files or the real environment',
    '# Values: text',
    '# Default: unset | Required: no | Secret: no',
    '# Example: A_KEY=1',
    '# A_KEY=',
  ].join('\n');

  test('a key a source reads but .env.example does not list is reported (a)/(b)', () => {
    const snippet = "const id = env.get('SOME_NEW_KEY'); const n = loadEnv().getInt('ANOTHER_NEW_KEY'); const x = process.env.PROC_KEY; const y = process.env['BRACKET_KEY']; process.env.SET_KEY ??= 'x'; // env.get('IN_A_COMMENT')";
    const reads = readsFromScript(snippet);
    expect([...reads].sort()).toEqual(['ANOTHER_NEW_KEY', 'BRACKET_KEY', 'PROC_KEY', 'SET_KEY', 'SOME_NEW_KEY']);
    expect(undocumented(reads, documented(GOOD))).toEqual(['ANOTHER_NEW_KEY', 'BRACKET_KEY', 'PROC_KEY', 'SET_KEY', 'SOME_NEW_KEY']);
    expect(undocumented(['A_KEY'], documented(GOOD))).toEqual([]);
    expect(readsFromScript("createPlaywrightConfig({ baseUrlKey: 'MY_BASE' });")).toEqual(new Set(['MY_BASE']));
  });

  test('shell, batch, pipeline and feature readers find real-environment reads and ignore the script\'s own variables', () => {
    expect([...readsFromShell('LOCAL=0\nif [ -n "${NPM_REGISTRY_URL:-}" ]; then echo "$LOCAL $OTHER_READ"; fi\n# $COMMENTED\nfor ARG in a; do echo $ARG; done')].sort()).toEqual(['NPM_REGISTRY_URL', 'OTHER_READ']);
    expect([...readsFromBatch('set "LOCAL=1"\nif "%USE_LOCAL%"=="1" echo %LOCAL%\nif defined NPM_URL (echo x)\nREM %COMMENTED%\necho %ERRORLEVEL%')].sort()).toEqual(['NPM_URL', 'USE_LOCAL']);
    expect([...readsFromPipeline('script:\n  - echo "$CI_COMMIT_REF_SLUG ${MY_VAR:-} $BROWSER"\n# $COMMENTED')].sort()).toEqual(['BROWSER', 'MY_VAR']);
    expect([...readsFromFeature('# {{env:COMMENTED}}\nGiven "{{env:HYBRID_PASSWORD|secret}}" and "{{env:OTHER}}" and "{{uuid}}"')].sort()).toEqual(['HYBRID_PASSWORD', 'OTHER']);
  });

  test('a documented key nothing reads is reported (c), unless it is on the pass-through list', () => {
    const entries = documented(GOOD.replace(/A_KEY/g, 'NOBODY_READS_ME'));
    expect(unreadEntries(entries, [new Set(['SOMETHING_ELSE'])], {})).toEqual(['NOBODY_READS_ME']);
    expect(unreadEntries(entries, [new Set(['NOBODY_READS_ME'])], {})).toEqual([]);
    expect(unreadEntries(entries, [new Set()], { NOBODY_READS_ME: 'read by the operating system' })).toEqual([]);
  });

  test('a block missing a metadata line is reported, naming the line (d)', () => {
    expect(metadataProblems(documented(GOOD))).toEqual([]);
    for (const label of ['Read from', 'Values', 'Default', 'Example']) {
      const broken = GOOD.split('\n').filter((line) => !line.startsWith(`# ${label}`)).join('\n');
      expect(metadataProblems(documented(broken)).join('\n'), `without ${label}`).toContain('A_KEY');
    }
    expect(metadataProblems(documented(GOOD.replace(' | Required: no', ''))).join('\n')).toContain('"Required:"');
    expect(metadataProblems(documented(GOOD.replace('Secret: no', 'Secret: maybe'))).join('\n')).toContain('"Secret:"');
    expect(metadataProblems(documented(GOOD.replace('Secret: no', 'Secret: YES'))).join('\n')).toContain('must say where');
    expect(metadataProblems(documented(GOOD.replace('# What it is for.\n', ''))).join('\n')).toContain('no description');
  });

  test('a README table with an extra, a missing or a mismarked key is reported (e)', () => {
    const entries = documented(GOOD).concat(documented(GOOD.replace(/A_KEY/g, 'B_SECRET').replace('Secret: no', 'Secret: YES - x')));
    const table = (rows: string[]) => `## Configuration reference\n\n| Name | Purpose | Default | Required | Secret |\n|---|---|---|---|---|\n${rows.join('\n')}\n\n## Next\n`;
    const good = table(['| `A_KEY` | p | unset | no | no |', '| `B_SECRET` | p | unset | no | YES |']);
    expect(tableProblems(entries, good)).toEqual([]);
    expect(tableProblems(entries, table(['| `A_KEY` | p | unset | no | no |'])).join('\n')).toContain('B_SECRET is in .env.example but not in the README table');
    expect(tableProblems(entries, table([...good.split('\n').filter((l) => l.startsWith('| `')), '| `C_EXTRA` | p | unset | no | no |'])).join('\n')).toContain('C_EXTRA is in the README table but not in .env.example');
    expect(tableProblems(entries, good.replace('| YES |', '| no |')).join('\n')).toContain('B_SECRET: Secret is "no" in the README table but "YES" in .env.example');
    expect(tableProblems(entries, good.replace('| Secret |', '| Hidden |')).join('\n')).toContain('table header');
    expect(tableProblems(entries, 'no such section').join('\n')).toContain('A_KEY is in .env.example but not in the README table');
  });

  test('.env.local.example without a secret, with an unknown key or with a real-looking value is reported (f)', () => {
    const entries = documented(GOOD.replace(/A_KEY/g, 'B_SECRET').replace('Secret: no', 'Secret: YES - x'));
    expect(localExampleProblems(entries, '# B_SECRET="<b-secret>"\n')).toEqual([]);
    expect(localExampleProblems(entries, '# header only\n').join('\n')).toContain('B_SECRET is a secret in .env.example but has no line');
    expect(localExampleProblems(entries, '# B_SECRET="<b-secret>"\n# OTHER="<x>"\n').join('\n')).toContain('OTHER is in .env.local.example but is not');
    expect(localExampleProblems(entries, '# B_SECRET="Xk3!realLooking9"\n').join('\n')).toContain('must not look like a real secret');
    expect(localExampleProblems(entries, 'B_SECRET=hunter2\n').join('\n')).toContain('must not look like a real secret');
  });

  test('the quoting TIP count is exact (g)', () => {
    expect(tipCount('# TIP - quoting values (dotenv rules):\n# x\n')).toBe(1);
    expect(tipCount('# nothing\n')).toBe(0);
    expect(tipCount('# TIP - quoting values (a)\n# TIP - quoting values (b)\n')).toBe(2);
  });
});
