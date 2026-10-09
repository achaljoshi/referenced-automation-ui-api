import { ApiClient } from '@automation/referenced-automation-api';
import { sapExpect, type SapDataRegistry, type SapGuiSession } from '@automation/referenced-automation-sap';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { expect, test } from '@playwright/test';
import type { DeliveredOrder, OrderLandscape } from '../orderLandscape';
import { CreateOrderInitialPage, EasyAccessPage } from '../sap/pages';

/**
 * The order-to-cash flow as reusable steps. A test composes them; each is a `test.step`, so the HTML report, the
 * trace and the log show the business stages, and the SAME correlation id is on every hop:
 *
 *   REST call header  ->  SAP "Customer Reference" field  ->  database row  ->  SFTP file name  ->  fulfilment API header
 *
 * so one failing order can be followed through every system by searching for one value.
 */

/** What every channel reported about the order, for reconciliation. */
export interface OrderTrace {
  correlationId: string;
  sapReference: string;
  db?: Record<string, unknown>;
  file?: { name: string; content: string };
  fulfilment?: { body: Record<string, unknown>; correlationHeader?: string };
}

export const shortId = (correlationId: string): string => correlationId.slice(0, 8);
export const referenceFor = (correlationId: string): string => `E2E-${shortId(correlationId)}`;

export interface OrderRequest {
  customer: string;
  material: string;
  quantity: number;
}

export async function lookUpPrice(api: ApiClient, material: string): Promise<number> {
  return test.step(`API: price of ${material}`, async () => {
    const response = await api.get(`/prices/${material}`);
    response.expectStatus(200);
    return response.require<number>('price');
  });
}

/** Creates the order in SAP GUI, writing the correlation id into the order's customer reference, and registers it for cleanup. */
export async function createOrderInSap(sap: SapGuiSession, sapData: SapDataRegistry, correlationId: string, order: OrderRequest): Promise<string> {
  return test.step('SAP GUI: create sales order (VA01)', async () => {
    await new EasyAccessPage(sap).open('VA01');
    const initial = await new CreateOrderInitialPage(sap).waitUntilDisplayed();
    const overview = await initial.enter({ type: 'OR', salesOrg: '1000', channel: '10', division: '00' });
    await overview.customer.fill(order.customer);
    await overview.customerReference.fill(referenceFor(correlationId));
    await sapExpect(overview.customerReference).toHaveText(referenceFor(correlationId)); // SAP itself holds the correlation id
    await overview.addItem(0, { material: order.material, quantity: String(order.quantity) });
    await sap.evidence('order filled in');
    await overview.save.click();
    const orderNo = await sapData.captureFromStatusBar('SalesOrder', /Order (\d+) has been saved/, {
      // a real project cancels or deletes the test order here; the registry guarantees this runs even if the test fails
      cleanup: async () => undefined,
    });
    await sap.evidence('order saved');
    return orderNo;
  });
}

/** Reads the order back from every system the interface should have reached. Polls: the interface is asynchronous. */
export async function collectTrace(landscape: OrderLandscape, orderNo: string, correlationId: string, timeoutMs = 8000): Promise<OrderTrace> {
  const trace: OrderTrace = { correlationId, sapReference: referenceFor(correlationId) };

  await test.step('DB: the order arrived', async () => {
    await expect
      .poll(async () => (await landscape.db.query('SELECT * FROM sales_orders WHERE correlation_id = ?', [correlationId])).length, { timeout: timeoutMs, message: `no row for correlation id ${shortId(correlationId)} in sales_orders` })
      .toBe(1);
    trace.db = (await landscape.db.query<Record<string, unknown>>('SELECT * FROM sales_orders WHERE correlation_id = ?', [correlationId]))[0];
  });

  await test.step('SFTP: the order file arrived', async () => {
    await expect
      .poll(async () => (await landscape.sftp.list('/outbound')).map((f) => f.name).find((n) => n.includes(shortId(correlationId))), { timeout: timeoutMs, message: `no file with ${shortId(correlationId)} in /outbound` })
      .toBeDefined();
    const name = (await landscape.sftp.list('/outbound')).map((f) => f.name).find((n) => n.includes(shortId(correlationId))) as string;
    const local = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'order-file-')), name);
    await landscape.sftp.download(`/outbound/${name}`, local); // over SFTP, so the file is proven to be servable, not just present
    trace.file = { name, content: fs.readFileSync(local, 'utf8') };
  });

  await test.step('API: the fulfilment service was notified', async () => {
    await expect
      .poll(() => landscape.fulfilments.some((f) => f.body.orderNo === orderNo), { timeout: timeoutMs, message: `the fulfilment API never received order ${orderNo}` })
      .toBe(true);
    const received = landscape.fulfilments.find((f) => f.body.orderNo === orderNo);
    trace.fulfilment = { body: received?.body ?? {}, correlationHeader: String(received?.headers['x-correlation-id'] ?? '') };
  });

  return trace;
}

/** Compares what SAP said with what every other system holds. An empty list means the landscape agrees. */
export function reconcile(expected: DeliveredOrder, trace: OrderTrace): string[] {
  const problems: string[] = [];
  const differs = (system: string, field: string, want: unknown, got: unknown) => String(want) !== String(got) && problems.push(`${system}: ${field} is ${String(got)}, SAP has ${String(want)}`);

  if (trace.db) {
    differs('database', 'order number', expected.orderNo, trace.db.order_no);
    differs('database', 'quantity', expected.quantity, trace.db.quantity);
    differs('database', 'material', expected.material, trace.db.material);
    differs('database', 'price', expected.price, trace.db.price);
  }
  if (trace.file) {
    for (const [field, want] of [['no', expected.orderNo], ['quantity', expected.quantity], ['material', expected.material], ['correlationId', expected.correlationId]] as const) {
      const got = new RegExp(`<${field}>([^<]*)</${field}>`).exec(trace.file.content)?.[1];
      differs('SFTP file', field, want, got ?? '(missing)');
    }
  }
  if (trace.fulfilment) {
    differs('fulfilment API', 'quantity', expected.quantity, trace.fulfilment.body.quantity);
    differs('fulfilment API', 'correlation id header', expected.correlationId, trace.fulfilment.correlationHeader);
  }
  return problems;
}
