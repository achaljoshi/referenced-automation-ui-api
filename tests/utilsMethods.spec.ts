import { test, expect } from '@playwright/test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  crypto,
  dateUtils,
  randomUtils,
  jsonUtils,
  yamlUtils,
  csvUtils,
  excelUtils,
  getPath,
  setPath,
  hasPath,
  requirePath,
  validateSchema,
  SqliteClient,
  emailUtils,
  SmtpClient,
  SftpClient,
  CommonsError,
  testing,
} from '@automation/referenced-automation-utils';
const { startSmtpTestServer, stopSmtpTestServer, startSftpTestServer, stopSftpTestServer } = testing;
type SmtpTestServerHandle = testing.SmtpTestServerHandle;
type SftpTestServerHandle = testing.SftpTestServerHandle;

/**
 * A demo/reference suite for every reusable method
 * @automation/referenced-automation-utils exports - "if I import utils into
 * this repo, here's a real, working example of calling each thing it
 * offers." Grouped by module, one test per module (matching utils' own
 * spec-file organization), each exercising every function/method that
 * module exports against real inputs/servers, not mocks.
 */

test.describe('utils: crypto @smoke', () => {
  test('every crypto function', () => {
    expect(crypto.md5Hex('hello')).toMatch(/^[0-9a-f]{32}$/);
    expect(crypto.sha1Hex('hello')).toMatch(/^[0-9a-f]{40}$/);
    expect(crypto.sha256Hex('hello')).toMatch(/^[0-9a-f]{64}$/);
    expect(crypto.sha512Hex('hello')).toMatch(/^[0-9a-f]{128}$/);
    expect(crypto.hmacSha256Hex('hello', 'secret')).toMatch(/^[0-9a-f]{64}$/);
    expect(crypto.hmacSha1Hex('hello', 'secret')).toMatch(/^[0-9a-f]{40}$/);

    const encoded = crypto.base64Encode('hello world');
    expect(crypto.base64Decode(encoded)).toBe('hello world');

    expect(crypto.mask('4111111111111111')).toBe('************1111');
  });
});

test.describe('utils: dateUtils @smoke', () => {
  test('every dateUtils function', () => {
    const d = dateUtils.parseDate('2026-01-15');
    expect(dateUtils.formatDate(d)).toBe('2026-01-15');

    const dt = dateUtils.parseDateTime('2026-01-15 10:30:00');
    expect(dateUtils.formatDateTime(dt)).toBe('2026-01-15 10:30:00');

    expect(dateUtils.formatDate(dateUtils.addDays(d, 5))).toBe('2026-01-20');
    expect(dateUtils.formatDate(dateUtils.addMonths(d, 1))).toBe('2026-02-15');
    expect(dateUtils.formatDateTime(dateUtils.addHours(dt, 2))).toBe('2026-01-15 12:30:00');
    expect(dateUtils.formatDateTime(dateUtils.addMinutes(dt, 30))).toBe('2026-01-15 11:00:00');

    const later = dateUtils.addDays(d, 10);
    expect(dateUtils.daysBetween(d, later)).toBe(10);
    expect(dateUtils.isBefore(d, later)).toBe(true);
    expect(dateUtils.isAfter(later, d)).toBe(true);

    const millis = dateUtils.toEpochMillis(dt);
    expect(dateUtils.formatDateTime(dateUtils.fromEpochMillis(millis))).toBe('2026-01-15 10:30:00');

    expect(typeof dateUtils.today).toBe('function');
    expect(typeof dateUtils.now).toBe('function');
    expect(dateUtils.today().isValid()).toBe(true);
    expect(dateUtils.now().isValid()).toBe(true);
    expect(dateUtils.timestampForFileName()).toMatch(/^\d{8}-\d{6}-\d{3}$/);
  });
});

test.describe('utils: randomUtils @smoke', () => {
  test('every randomUtils function', () => {
    expect(randomUtils.firstName().length).toBeGreaterThan(0);
    expect(randomUtils.lastName().length).toBeGreaterThan(0);
    expect(randomUtils.fullName().length).toBeGreaterThan(0);
    expect(randomUtils.email()).toMatch(/@/);
    expect(randomUtils.email('qa')).toMatch(/^qa/);
    expect(randomUtils.phoneNumber().length).toBeGreaterThan(0);
    expect(randomUtils.streetAddress().length).toBeGreaterThan(0);
    expect(randomUtils.city().length).toBeGreaterThan(0);
    expect(randomUtils.country().length).toBeGreaterThan(0);
    expect(randomUtils.companyName().length).toBeGreaterThan(0);
    expect(randomUtils.jobTitle().length).toBeGreaterThan(0);
    expect(randomUtils.uuid()).toMatch(/^[0-9a-f-]{36}$/);

    const n = randomUtils.number(1, 10);
    expect(n).toBeGreaterThanOrEqual(1);
    expect(n).toBeLessThanOrEqual(10);
    expect(randomUtils.alphaNumeric(8)).toHaveLength(8);
    expect(randomUtils.numericString(6)).toMatch(/^\d{6}$/);
    expect(randomUtils.futureDate(30).isAfter(dateUtils.now())).toBe(true);
    expect(randomUtils.pastDate(30).isBefore(dateUtils.now())).toBe(true);
    expect(randomUtils.creditCardNumber().replace(/\D/g, '').length).toBeGreaterThanOrEqual(12);
    expect(typeof randomUtils.faker.string.uuid).toBe('function');
  });
});

test.describe('utils: jsonUtils / yamlUtils / csvUtils / excelUtils @smoke', () => {
  let tmpDir: string;

  test.beforeAll(async () => {
    tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'ui-api-utils-demo-'));
  });

  test.afterAll(async () => {
    await fs.promises.rm(tmpDir, { recursive: true, force: true });
  });

  test('every jsonUtils function', async () => {
    const data = { user: { name: 'Ada', roles: ['admin', 'qa'] } };
    const json = jsonUtils.toJson(data);
    expect(jsonUtils.fromJson(json)).toEqual(data);
    expect(jsonUtils.toPrettyJson(data)).toContain('\n');
    expect(jsonUtils.readAt<string>(json, 'user.name')).toBe('Ada');

    const filePath = path.join(tmpDir, 'data.json');
    await fs.promises.writeFile(filePath, json);
    expect(jsonUtils.fromJsonFile(filePath)).toEqual(data);
  });

  test('every yamlUtils function', async () => {
    const data = { environment: 'qa', retries: 2 };
    const yaml = yamlUtils.toYaml(data);
    expect(yamlUtils.fromYaml(yaml)).toEqual(data);

    const filePath = path.join(tmpDir, 'data.yaml');
    await fs.promises.writeFile(filePath, yaml);
    expect(yamlUtils.fromYamlFile(filePath)).toEqual(data);
  });

  test('every csvUtils function', async () => {
    const rows = [
      { id: '1', name: 'Ada' },
      { id: '2', name: 'Grace' },
    ];
    const csv = csvUtils.toCsv(rows);
    expect(csvUtils.parseCsv(csv)).toEqual(rows);

    const filePath = path.join(tmpDir, 'data.csv');
    csvUtils.writeCsvFile(filePath, rows);
    expect(csvUtils.parseCsvFile(filePath)).toEqual(rows);
  });

  test('every excelUtils function', async () => {
    const rows = [
      { id: 1, name: 'Ada' },
      { id: 2, name: 'Grace' },
    ];
    const filePath = path.join(tmpDir, 'data.xlsx');
    await excelUtils.writeSheet(filePath, rows);
    const readBack = await excelUtils.readSheet(filePath);
    expect(readBack).toEqual(rows);
  });
});

test.describe('utils: object-path traversal and schema validation @smoke', () => {
  test('every getPath/setPath/hasPath/requirePath function', () => {
    const source = { data: { users: [{ name: 'Ada' }] } };
    expect(getPath<string>(source, 'data.users[0].name')).toBe('Ada');
    expect(getPath(source, 'data.missing', 'fallback')).toBe('fallback');
    expect(hasPath(source, 'data.users[0].name')).toBe(true);
    expect(hasPath(source, 'data.missing')).toBe(false);
    expect(requirePath<string>(source, 'data.users[0].name')).toBe('Ada');

    const target = { a: { b: 1 } };
    setPath(target, 'a.c', 2);
    expect(target).toEqual({ a: { b: 1, c: 2 } });
  });

  test('validateSchema', () => {
    const schema = {
      type: 'object',
      required: ['name'],
      properties: { name: { type: 'string' } },
    };
    expect(validateSchema({ name: 'Ada' }, schema).valid).toBe(true);
    const invalid = validateSchema({}, schema);
    expect(invalid.valid).toBe(false);
    expect(invalid.errorsText.length).toBeGreaterThan(0);
  });
});

test.describe('utils: CommonsError @smoke', () => {
  test('a typed error consuming code can catch by class, with a wrapped cause', () => {
    const cause = new Error('root cause');
    expect(() => {
      throw new CommonsError('something specific to this framework went wrong', { cause });
    }).toThrow(CommonsError);

    try {
      throw new CommonsError('wrapped', { cause });
    } catch (err) {
      expect(err).toBeInstanceOf(CommonsError);
      expect((err as CommonsError).name).toBe('CommonsError');
      expect((err as CommonsError).cause).toBe(cause);
    }
  });
});

test.describe('utils: DbClient / SqliteClient @smoke', () => {
  test('every SqliteClient method (the DbClient contract)', async () => {
    const db = new SqliteClient(':memory:');
    try {
      await db.update('CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT)');
      await db.update('INSERT INTO users (id, name) VALUES (?, ?)', [1, 'Ada']);

      const rows = await db.query<{ id: number; name: string }>('SELECT * FROM users');
      expect(rows).toEqual([{ id: 1, name: 'Ada' }]);

      const count = await db.queryScalar<number>('SELECT COUNT(*) FROM users');
      expect(count).toBe(1);
    } finally {
      await db.close();
    }
  });
});

test.describe('utils: emailUtils / SmtpClient @smoke', () => {
  let server: SmtpTestServerHandle;

  test.beforeAll(async () => {
    server = await startSmtpTestServer();
  });

  test.afterAll(async () => {
    await stopSmtpTestServer(server);
  });

  test('emailUtils.sendEmail (one-shot)', async () => {
    await emailUtils.sendEmail(
      { host: server.host, port: server.port, secure: false, auth: { user: server.username, pass: server.password } },
      { from: 'a@example.com', to: 'b@example.com', subject: 'One-shot', text: 'via emailUtils.sendEmail' },
    );
    expect(server.received.some((m) => m.subject === 'One-shot')).toBe(true);
  });

  test('SmtpClient.verify/send/close (pooled connection)', async () => {
    const smtp = new SmtpClient({
      host: server.host,
      port: server.port,
      secure: false,
      auth: { user: server.username, pass: server.password },
    });
    try {
      await expect(smtp.verify()).resolves.toBe(true);
      const result = await smtp.send({ from: 'a@example.com', to: 'b@example.com', subject: 'Pooled', text: 'via SmtpClient' });
      expect(result.accepted).toEqual(['b@example.com']);
      expect(server.received.some((m) => m.subject === 'Pooled')).toBe(true);
    } finally {
      smtp.close();
    }
  });
});

test.describe('utils: SftpClient (the WinSCP-equivalent client) @smoke', () => {
  test.describe.configure({ mode: 'serial' });

  let server: SftpTestServerHandle;
  let client: SftpClient;
  let localDir: string;

  test.beforeAll(async () => {
    server = await startSftpTestServer();
    client = new SftpClient();
    await client.connect({ host: server.host, port: server.port, username: server.username, password: server.password });
    localDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'ui-api-sftp-demo-'));
  });

  test.afterAll(async () => {
    await client.close();
    await stopSftpTestServer(server);
    await fs.promises.rm(localDir, { recursive: true, force: true });
  });

  test('every SftpClient method', async () => {
    const localPath = path.join(localDir, 'report.csv');
    await fs.promises.writeFile(localPath, 'id,name\n1,Ada\n');

    await client.upload(localPath, '/report.csv');
    expect(await client.exists('/report.csv')).toBe('-');

    const downloadedPath = path.join(localDir, 'downloaded.csv');
    await client.download('/report.csv', downloadedPath);
    expect(await fs.promises.readFile(downloadedPath, 'utf-8')).toBe('id,name\n1,Ada\n');

    await client.mkdir('/archive');
    expect(await client.exists('/archive')).toBe('d');

    const entries = await client.list('/');
    expect(entries.map((e) => e.name).sort()).toEqual(['archive', 'report.csv']);

    await client.delete('/report.csv');
    expect(await client.exists('/report.csv')).toBe(false);

    await client.rmdir('/archive');
    expect(await client.exists('/archive')).toBe(false);
  });
});
