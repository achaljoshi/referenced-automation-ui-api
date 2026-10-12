import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { expect, test } from '@playwright/test';

/**
 * Working inside this repo on Windows (PowerShell): the documentation must give a PowerShell form wherever it sets an
 * environment variable, the commands it names must exist after an install, and the README must carry the "Windows first run"
 * section with the errors a first run hits. The checks are exported functions so the negative controls prove each one
 * fails on a bad input.
 *
 * This repo has no `bin` of its own: `ui-codegen-to-playwright`, `api-curl-to-playwright`, `automation-*` ... come from its
 * dependencies and are linked into node_modules/.bin by the install, which is where `npm run` and `npx` look.
 */
const root = path.resolve(__dirname, '..');
const read = (relative: string) => fs.readFileSync(path.join(root, relative), 'utf8');
const walk = (dir: string, accept: (file: string) => boolean): string[] =>
  fs.existsSync(path.join(root, dir))
    ? fs.readdirSync(path.join(root, dir), { withFileTypes: true }).flatMap((entry) => {
        const relative = `${dir}/${entry.name}`;
        return entry.isDirectory() ? walk(relative, accept) : accept(relative) ? [relative] : [];
      })
    : [];

/** The documents a person reads and copies from. CHANGELOG.md is history and is left out. */
const DOCS = ['README.md', 'CONTRIBUTING.md', ...walk('docs', (f) => f.endsWith('.md'))];
/** Everything that may name an `npx <bin>`: the docs, the install scripts, the pipeline and the committed reference of variables. */
const COMMAND_FILES = [...DOCS, ...walk('scripts', () => true), '.gitlab-ci.yml', '.env.example', '.env.local.example'];

const binDir = path.join(root, 'node_modules', '.bin');
const binExists = (dir: string, name: string) => fs.existsSync(path.join(dir, name)) || fs.existsSync(path.join(dir, `${name}.cmd`));
const SKIP_BIN_CHECK = 'node_modules/.bin is missing: the install did not run (README: Windows first run) - run the setup script, then this test checks the commands';

// ---- the commands scripts and docs name -----------------------------------------------------------------------------

/** The first word of every command in package.json scripts (after `&&`, `||`, `;`, `|` and NAME=value prefixes), minus `npm` / `node` themselves. */
export function binsOfScripts(scripts: Record<string, string>): string[] {
  const bins = new Set<string>();
  for (const command of Object.values(scripts)) {
    for (const segment of command.split(/&&|\|\||;|\|/)) {
      const words = segment.trim().split(/\s+/).filter((word) => word !== '');
      while (words.length > 0 && /^[A-Za-z_][A-Za-z0-9_]*=/.test(words[0] as string)) words.shift();
      const first = words[0];
      if (!first || ['npm', 'node', 'npx'].includes(first)) continue;
      bins.add(first);
    }
  }
  return [...bins].sort();
}

/** The names that are not in `dir` (a node_modules/.bin), counting a Windows `name.cmd` shim. */
export const missingBins = (names: string[], dir: string): string[] => names.filter((name) => !binExists(dir, name));

/** The command after every `npx` (flags such as --yes skipped); `<placeholders>` and prose are ignored. */
export function npxCommands(text: string): string[] {
  const found = new Set<string>();
  for (const match of text.matchAll(/\bnpx[ \t]+(?:--?[A-Za-z][\w-]*[ \t]+)*([a-z@][\w./@-]*)/g)) found.add(match[1] as string);
  return [...found].sort();
}

// ---- POSIX-only snippets -----------------------------------------------------------------------------------------------

/**
 * Fenced code blocks that set an environment variable the POSIX way (`NAME=value npx ...`, `NAME=value npm ...`,
 * `export NAME=...`) with no PowerShell form (`$env:`) inside the block or in the 6 lines before and after it.
 * Returns "line N: <the line>" for each.
 */
export function posixOnlySnippets(markdown: string): string[] {
  const lines = markdown.split(/\r?\n/);
  const problems: string[] = [];
  const value = `(?:"[^"]*"|'[^']*'|\\S*)`;
  const posix = new RegExp(`^\\s*(?:export\\s+[A-Z][A-Z0-9_]*=|(?:[A-Z][A-Z0-9_]*=${value}\\s+)+(?:npx|npm)\\b)`);
  let open: number | undefined;
  lines.forEach((line, index) => {
    if (!/^\s*```/.test(line)) return;
    if (open === undefined) {
      open = index;
      return;
    }
    const from = open;
    const block = lines.slice(from + 1, index);
    const around = lines.slice(Math.max(0, from - 6), Math.min(lines.length, index + 7)).join('\n');
    if (!around.includes('$env:')) {
      block.forEach((blockLine, offset) => {
        if (posix.test(blockLine)) problems.push(`line ${from + 2 + offset}: ${blockLine.trim()}`);
      });
    }
    open = undefined;
  });
  return problems;
}

/** Lines with `playwright test` followed by a path that uses a backslash (Playwright reads it as a pattern and finds "No tests found"). */
export function backslashTestPaths(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line, index) => ({ line, number: index + 1 }))
    .filter(({ line }) => /playwright test[^`\n]*[\w.-]\\[\w.\\-]/.test(line))
    .map(({ line, number }) => `line ${number}: ${line.trim()}`);
}

// ---- the VS Code debug configurations ---------------------------------------------------------------------------------

/**
 * Problems that stop a VS Code debug configuration working on Windows: a `program` that is a node_modules/.bin entry (on
 * Windows npm writes a shell script and a .cmd there, neither of which node can run - the JavaScript file is
 * node_modules/@playwright/test/cli.js), a program file that does not exist, and `${relativeFile}` in the arguments
 * (VS Code gives it backslashes on Windows, so Playwright finds "No tests found"; `${fileBasename}` has none).
 */
export function launchProblems(launchJson: string, exists: (file: string) => boolean): string[] {
  const launch = JSON.parse(launchJson.replace(/^\s*\/\/.*$/gm, '')) as { configurations: Array<{ name: string; program?: string; args?: string[] }> };
  const problems: string[] = [];
  for (const config of launch.configurations) {
    const program = config.program ?? '';
    if (/node_modules\/\.bin\//.test(program)) problems.push(`${config.name}: program ${program} is a .bin shim, not JavaScript on Windows - use node_modules/@playwright/test/cli.js`);
    else if (!exists(program.replace('${workspaceFolder}/', ''))) problems.push(`${config.name}: program ${program} does not exist`);
    if ((config.args ?? []).some((arg) => arg.includes('${relativeFile}'))) problems.push(`${config.name}: \${relativeFile} has backslashes on Windows - use \${fileBasename}`);
  }
  return problems;
}

// ---- the tests ---------------------------------------------------------------------------------------------------------

test.describe('commands: every bin the scripts and docs name exists after an install', () => {
  test('every bin a package.json script runs is in node_modules/.bin (this repo has no bin of its own: they come from the dependencies)', () => {
    test.skip(!fs.existsSync(binDir), SKIP_BIN_CHECK);
    const pkg = JSON.parse(read('package.json')) as { scripts: Record<string, string>; bin?: unknown };
    expect(pkg.bin, 'this repo has no bin; if it gets one, document how a clone makes it available').toBeUndefined();
    const bins = binsOfScripts(pkg.scripts);
    for (const bin of ['bddgen', 'playwright', 'tsc', 'eslint', 'ui-codegen-to-playwright', 'api-curl-to-playwright', 'automation-scan-secrets']) {
      expect(bins, `the scan should see ${bin} in the scripts`).toContain(bin);
    }
    expect(missingBins(bins, binDir), 'run the setup script: these commands come from the installed dependencies').toEqual([]);
  });

  test('every `npx <bin>` in the README, docs, scripts, pipeline and .env.example is a real bin', () => {
    test.skip(!fs.existsSync(binDir), SKIP_BIN_CHECK);
    const named = new Map<string, string[]>();
    for (const file of COMMAND_FILES) for (const command of npxCommands(read(file))) named.set(command, [...(named.get(command) ?? []), file]);
    expect([...named.keys()], 'the scan should see the npx forms').toEqual(expect.arrayContaining(['playwright', 'ui-codegen-to-playwright', 'api-curl-to-playwright']));
    const missing = missingBins([...named.keys()], binDir);
    expect(missing.map((name) => `${name} (${named.get(name)?.join(', ')})`), 'named after npx but not in node_modules/.bin').toEqual([]);
  });
});

test.describe('documentation works in PowerShell', () => {
  test('no README / CONTRIBUTING / docs snippet sets a variable the POSIX way without a PowerShell form nearby', () => {
    expect(DOCS.length).toBeGreaterThanOrEqual(2);
    const bad = DOCS.flatMap((file) => posixOnlySnippets(read(file)).map((problem) => `${file} ${problem}`));
    expect(bad, 'add a PowerShell form next to it: $env:NAME = "value"; npx playwright test').toEqual([]);
    expect(read('README.md')).toContain('$env:ENV = "stage"; $env:BROWSER = "firefox"; npx playwright test');
    expect(read('README.md')).toContain('Remove-Item Env:BROWSER');
  });

  test('no document, script or pipeline file shows `playwright test` with a backslash path', () => {
    const bad = COMMAND_FILES.flatMap((file) => backslashTestPaths(read(file)).map((problem) => `${file} ${problem}`));
    expect(bad, 'use forward slashes (tests/x.spec.ts) or -g "title"').toEqual([]);
  });

  test('setup.bat tells a PowerShell user how to set BROWSER and how to run itself', () => {
    const bat = read('scripts/setup.bat');
    expect(bat).toContain('$env:BROWSER = "msedge"; npm test');
    expect(bat).toContain('set BROWSER=msedge');
    expect(bat).toContain('PowerShell: .\\scripts\\setup.bat');
    expect(read('README.md')).toContain('.\\scripts\\setup.bat --local');
  });

  test('the VS Code debug configurations run on Windows: they start the Playwright CLI file and pass no backslash path', () => {
    const launch = read('.vscode/launch.json');
    expect(JSON.parse(launch).configurations.length).toBeGreaterThanOrEqual(2);
    expect(launchProblems(launch, (file) => fs.existsSync(path.join(root, file)))).toEqual([]);
  });

  test('the README has a "Windows first run" section with the install, the run commands and the common first errors', () => {
    const readme = read('README.md');
    const start = readme.search(/^## Windows first run\s*$/m);
    expect(start, 'a "## Windows first run" heading').toBeGreaterThanOrEqual(0);
    const section = readme.slice(start).split(/^## (?!Windows first run)/m)[0] as string;
    for (const text of [
      '.\\scripts\\setup.bat',
      '.\\scripts\\setup.bat --local',
      'referenced-automation-utils',
      'referenced-automation-sap',
      'npm run install:browsers',
      'npm test',
      'npx playwright test tests/',
      '-g "',
      '--project=',
      "'tsc' is not recognized",
      "'bddgen' is not recognized",
      'No tests found',
      'Cannot find module',
      'Illegal characters in path',
      'rimraf --glob dist "*.tgz"',
      "Executable doesn't exist",
      'npx playwright install',
      'PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD',
      'a file called `.env.local` is never read',
      'LOG_LEVEL',
      'real environment only',
    ]) {
      expect(section, `the Windows first run section should contain: ${text}`).toContain(text);
    }
    expect(section, 'this repo is not the SAP repo: no Java setup here').not.toMatch(/JAVA_HOME|\bJDK\b/);
    expect(readme).toContain('(#windows-first-run)');
    expect(readme, 'the converters are documented with the way to pass other arguments').toContain('npm run convert:ui -- ');
    expect(readme).toContain('node_modules/.bin');
  });
});

test.describe('negative controls: each check reports a bad input', () => {
  test('binsOfScripts reads every command of a script, and missingBins names the one that is not installed', () => {
    expect(binsOfScripts({ a: 'bddgen && playwright test', b: 'npm run a', c: 'FOO=1 qux --x | grep y; node x.js', d: 'a || b' })).toEqual(['a', 'b', 'bddgen', 'grep', 'playwright', 'qux']);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bins-'));
    try {
      fs.writeFileSync(path.join(dir, 'present'), '');
      fs.writeFileSync(path.join(dir, 'shimmed.cmd'), '');
      expect(missingBins(['present', 'shimmed', 'definitely-not-installed'], dir)).toEqual(['definitely-not-installed']);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('npxCommands finds the command after npx, skips flags, placeholders and prose', () => {
    expect(npxCommands('run `npx playwright test` or npx --yes ui-codegen-to-playwright x, then npx <bin> and `npx` alone')).toEqual(['playwright', 'ui-codegen-to-playwright']);
    expect(npxCommands('npx definitely-not-a-bin --help')).toEqual(['definitely-not-a-bin']);
  });

  test('a POSIX-only snippet is flagged and a snippet with a PowerShell form is accepted', () => {
    const bad = 'Run it:\n\n```bash\nENV=stage BROWSER=firefox npx playwright test\nexport NPM_REGISTRY_URL=https://x\nBROWSER="msedge" npm test\n```\n';
    expect(posixOnlySnippets(bad)).toEqual([
      'line 4: ENV=stage BROWSER=firefox npx playwright test',
      'line 5: export NPM_REGISTRY_URL=https://x',
      'line 6: BROWSER="msedge" npm test',
    ]);
    const good = `${bad}\n\`\`\`powershell\n$env:ENV = "stage"; $env:BROWSER = "firefox"; npx playwright test\n\`\`\`\n`;
    expect(posixOnlySnippets(good)).toEqual([]);
    const inside = '```text\nBROWSER=firefox npx playwright test      (PowerShell: $env:BROWSER = "firefox"; npx playwright test)\n```\n';
    expect(posixOnlySnippets(inside)).toEqual([]);
    const far = `${bad}\n${'filler\n'.repeat(8)}\n\`\`\`powershell\n$env:X = "1"\n\`\`\`\n`;
    expect(posixOnlySnippets(far)).toHaveLength(3); // a PowerShell block more than 6 lines away does not count
    expect(posixOnlySnippets('plain text BROWSER=firefox npm test, outside any fence')).toEqual([]);
    expect(posixOnlySnippets('```bash\nnpm test\nnpx playwright test tests/a.spec.ts\n```\n')).toEqual([]);
  });

  test('a debug configuration with a .bin shim, a missing program or ${relativeFile} is reported', () => {
    const config = (program: string, arg: string) => JSON.stringify({ configurations: [{ name: 'Debug', program, args: ['test', arg] }] });
    const here = () => true;
    expect(launchProblems(config('${workspaceFolder}/node_modules/@playwright/test/cli.js', '${fileBasename}'), here)).toEqual([]);
    expect(launchProblems(config('${workspaceFolder}/node_modules/.bin/playwright', '${fileBasename}'), here).join('\n')).toContain('.bin shim');
    expect(launchProblems(config('${workspaceFolder}/node_modules/@playwright/test/cli.js', '${relativeFile}'), here).join('\n')).toContain('backslashes');
    expect(launchProblems(config('${workspaceFolder}/missing.js', '${fileBasename}'), () => false).join('\n')).toContain('does not exist');
  });

  test('a backslash path after playwright test is flagged, a forward-slash path is not', () => {
    expect(backslashTestPaths('npx playwright test tests\\hybridSession.spec.ts')).toHaveLength(1);
    expect(backslashTestPaths('x\nnpx playwright test --project=chromium tests\\a\\b.spec.ts')).toEqual(['line 2: npx playwright test --project=chromium tests\\a\\b.spec.ts']);
    expect(backslashTestPaths('npx playwright test tests/hybridSession.spec.ts')).toEqual([]);
    expect(backslashTestPaths('npx playwright test -g "title"')).toEqual([]);
  });
});
