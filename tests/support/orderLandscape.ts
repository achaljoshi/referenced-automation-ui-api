import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { MockServer } from '@automation/referenced-automation-api';
import { SftpClient, SqliteClient, testing } from '@automation/referenced-automation-utils';

export interface DeliveredOrder {
  orderNo: string;
  correlationId: string;
  customer: string;
  material: string;
  quantity: number;
  price: number;
}

/**
 * STAND-IN for what happens around SAP in a real landscape after a sales order is saved: the order interface
 * writes a row to a database, drops an XML file on an SFTP server and notifies a fulfilment service over REST.
 * Here all three are in-process (SQLite, the shared SFTP test server, a mock REST server) so the whole flow can be
 * run anywhere. In a real project, point the same flow at the real database, SFTP host and API (env files) and
 * delete `deliver()` - SAP's own interface does that part.
 */
export class OrderLandscape {
  /** What the fulfilment API received, headers included - proof of which correlation id reached it. */
  readonly fulfilments: Array<{ headers: Record<string, string | string[] | undefined>; body: Record<string, unknown> }> = [];
  private readonly folder = fs.mkdtempSync(path.join(os.tmpdir(), 'order-landscape-'));

  private constructor(
    readonly api: MockServer,
    readonly sftpServer: testing.SftpTestServerHandle,
    readonly sftp: SftpClient,
    readonly db: SqliteClient,
  ) {}

  static async start(): Promise<OrderLandscape> {
    const api = new MockServer();
    await api.start();
    const sftpServer = await testing.startSftpTestServer();
    const sftp = new SftpClient();
    await sftp.connect({ host: sftpServer.host, port: sftpServer.port, username: sftpServer.username, password: sftpServer.password });
    await sftp.mkdir('/outbound');
    const db = new SqliteClient();
    await db.update('CREATE TABLE sales_orders (order_no TEXT PRIMARY KEY, correlation_id TEXT, customer TEXT, material TEXT, quantity INTEGER, price REAL)');

    const landscape = new OrderLandscape(api, sftpServer, sftp, db);
    api.get('/prices/:material', (req) => ({ material: req.params.material, price: PRICES[String(req.params.material)] ?? 10 }));
    api.post(
      '/fulfilments',
      (req) => {
        landscape.fulfilments.push({ headers: req.headers, body: (req.body ?? {}) as Record<string, unknown> });
        return { id: `F-${landscape.fulfilments.length}`, status: 'RECEIVED' };
      },
      { status: 201 },
    );
    api.get('/fulfilments', (req) => landscape.fulfilments.filter((f) => f.body.orderNo === req.query.orderNo).map((f) => ({ ...f.body, status: 'RECEIVED' })));
    return landscape;
  }

  /**
   * The order interface: runs `delayMs` after being called, like a real asynchronous interface, which is why the
   * verification polls instead of sleeping. Resolves when everything has been delivered.
   */
  deliver(order: DeliveredOrder, delayMs = 250): Promise<void> {
    return new Promise((resolve, reject) => {
      setTimeout(async () => {
        try {
          await this.db.update('INSERT INTO sales_orders VALUES (?, ?, ?, ?, ?, ?)', [order.orderNo, order.correlationId, order.customer, order.material, order.quantity, order.price]);
          const file = path.join(this.folder, `ORDER_${order.orderNo}_${order.correlationId.slice(0, 8)}.xml`);
          fs.writeFileSync(file, `<order><no>${order.orderNo}</no><correlationId>${order.correlationId}</correlationId><customer>${order.customer}</customer><material>${order.material}</material><quantity>${order.quantity}</quantity></order>`);
          await this.sftp.upload(file, `/outbound/${path.basename(file)}`);
          const response = await fetch(`${this.api.baseUrl}/fulfilments`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Correlation-Id': order.correlationId },
            body: JSON.stringify({ orderNo: order.orderNo, material: order.material, quantity: order.quantity }),
          });
          if (!response.ok) throw new Error(`fulfilment API answered ${response.status}`);
          resolve();
        } catch (error) {
          reject(error);
        }
      }, delayMs);
    });
  }

  async stop(): Promise<void> {
    await this.sftp.close().catch(() => undefined);
    await this.sftpServer.stop().catch(() => undefined);
    await this.api.stop().catch(() => undefined);
    await this.db.close().catch(() => undefined);
    fs.rmSync(this.folder, { recursive: true, force: true });
  }
}

const PRICES: Record<string, number> = { TG11: 12.5, TG12: 7.25 };
