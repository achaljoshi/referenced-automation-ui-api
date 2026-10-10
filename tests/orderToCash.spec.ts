import { ApiClient } from '@automation/referenced-automation-api';
import { createSampleSapSystem, ensureLoggedIn, sapGuiTest } from '@automation/referenced-automation-sap';
import { getCorrelationId } from '@automation/referenced-automation-utils';
import { randomUUID } from 'node:crypto';
import { expect } from '@playwright/test';
import { collectTrace, createOrderInSap, lookUpPrice, reconcile, referenceFor, shortId } from './support/flows/orderToCash';
import { OrderLandscape, type DeliveredOrder, type DownstreamSystem } from './support/orderLandscape';

/**
 * ONE business scenario across four systems, traced by ONE correlation id:
 *
 *   REST price lookup  ->  SAP GUI sales order  ->  (SAP's interface)  ->  database + SFTP file + fulfilment API
 *
 * READ THIS BEFORE TRUSTING A GREEN RUN. These are HARNESS SELF-TESTS: SAP GUI is the SAP package's built-in simulator
 * and the "interface" is a stand-in (tests/support/orderLandscape.ts) that the TEST ITSELF calls (`landscape.deliver`)
 * with data it built from what it typed. So the reconciliation proves the harness can create an order, read it back from
 * every system, tie the systems together by one correlation id and report a disagreement or a missing delivery - not that a
 * real SAP interface delivers anything (only the simulator's order number is independent of the test). For a real
 * landscape: use a real SAP session (SAP_GUI_MODE / .env files), point the landscape at the real database, SFTP host and
 * API, and drop the `deliver()` call - SAP's own interface does that part; `collectTrace` and `reconcile` stay as they are.
 */
const test = sapGuiTest.extend<object, { landscape: OrderLandscape }>({
  sapGuiTransport: [
    async ({}, use) => {
      await use(() => createSampleSapSystem({ transitionDelayMs: 20 }));
    },
    { scope: 'worker' },
  ],
  landscape: [
    async ({}, use) => {
      const landscape = await OrderLandscape.start();
      await use(landscape);
      await landscape.stop();
    },
    { scope: 'worker' },
  ],
});
test.use({ sapGuiMode: 'attach' });

const creds = { client: '100', user: 'TESTUSER', password: 'correct-horse' };

test('harness self-test: an order saved in the SAP simulator is read back from the database, SFTP and the fulfilment API (delivered by the stand-in) and reconciles, under one correlation id @e2e', async ({ sap, sapData, landscape, request }) => {
  const correlationId = getCorrelationId() as string;
  await ensureLoggedIn(sap, creds);

  // 1. API: price lookup. ApiClient puts the test's correlation id on the request header by itself.
  const price = await lookUpPrice(new ApiClient(request, landscape.api.baseUrl), 'TG11');

  // 2. SAP GUI: the order. The correlation id goes into its customer reference, so it is visible inside SAP too.
  const orderNo = await createOrderInSap(sap, sapData, correlationId, { customer: '1000', material: 'TG11', quantity: 5 });
  const expected: DeliveredOrder = { orderNo, correlationId, customer: '1000', material: 'TG11', quantity: 5, price };

  // 3. The interface does its asynchronous work. THE STAND-IN delivers here, from the test's own data (SAP does this for real) -
  //    awaited, so a failing delivery fails the test with its reason instead of becoming an unhandled rejection.
  await landscape.deliver(expected);

  // 4. Read the order back from every system and check they agree with SAP.
  const trace = await collectTrace(landscape, orderNo, correlationId);
  expect(reconcile(expected, trace), 'the systems disagree about the order').toEqual([]);

  // 5. The proof that one value ties them all together.
  expect(trace.sapReference).toBe(referenceFor(correlationId));
  expect(trace.file?.name).toContain(shortId(correlationId));
  expect(trace.db?.correlation_id).toBe(correlationId);
  expect(trace.fulfilment?.correlationHeader).toBe(correlationId);
  expect(sap.journalText()).toContain('VA01');
});

test('a delivery that disagrees with SAP is caught, and says which system and which field @e2e', async ({ sap, sapData, landscape }) => {
  const correlationId = getCorrelationId() as string;
  await ensureLoggedIn(sap, creds);
  const orderNo = await createOrderInSap(sap, sapData, correlationId, { customer: '1000', material: 'TG12', quantity: 3 });
  const expected: DeliveredOrder = { orderNo, correlationId, customer: '1000', material: 'TG12', quantity: 3, price: 7.25 };

  // the interface delivers the wrong quantity everywhere - the kind of defect only a cross-system check finds
  await landscape.deliver({ ...expected, quantity: 30 });
  const trace = await collectTrace(landscape, orderNo, correlationId);

  const problems = reconcile(expected, trace);
  expect(problems).toContain('database: quantity is 30, SAP has 3');
  expect(problems).toContain('SFTP file: quantity is 30, SAP has 3');
  expect(problems).toContain('fulfilment API: quantity is 30, SAP has 3');
  expect(problems.some((p) => p.includes('order number') || p.includes('correlation'))).toBe(false); // what DID match is not reported
});

test('every order gets its own correlation id, so two orders never get confused', async ({ sap, sapData, landscape }) => {
  // Two orders, two DISTINCT correlation ids (one per order, as a real flow has) - not the test's one id twice.
  const first = randomUUID();
  const second = randomUUID();
  expect(second).not.toBe(first);
  expect(shortId(second)).not.toBe(shortId(first));
  await ensureLoggedIn(sap, creds);
  const a = await createOrderInSap(sap, sapData, first, { customer: '1000', material: 'TG11', quantity: 1 });
  const b = await createOrderInSap(sap, sapData, second, { customer: '1000', material: 'TG11', quantity: 2 });
  expect(a).not.toBe(b); // SAP numbers each order itself
  expect(sapData.items.map((i) => i.id)).toEqual([a, b]);

  await landscape.deliver({ orderNo: a, correlationId: first, customer: '1000', material: 'TG11', quantity: 1, price: 12.5 });
  await landscape.deliver({ orderNo: b, correlationId: second, customer: '1000', material: 'TG11', quantity: 2, price: 12.5 });
  const traceA = await collectTrace(landscape, a, first);
  const traceB = await collectTrace(landscape, b, second);
  // each id found ITS order in every system, and nothing of the other one
  expect(traceA.sapReference).toBe(referenceFor(first));
  expect(traceB.sapReference).toBe(referenceFor(second));
  expect(traceA.sapReference).not.toBe(traceB.sapReference);
  expect([traceA.db?.order_no, traceA.db?.quantity]).toEqual([a, 1]);
  expect([traceB.db?.order_no, traceB.db?.quantity]).toEqual([b, 2]);
  expect(traceA.file?.name).toContain(shortId(first));
  expect(traceA.file?.name).not.toContain(shortId(second));
  expect(traceB.fulfilment?.correlationHeader).toBe(second);
  expect(reconcile({ orderNo: a, correlationId: first, customer: '1000', material: 'TG11', quantity: 1, price: 12.5 }, traceA)).toEqual([]);
  expect(reconcile({ orderNo: b, correlationId: second, customer: '1000', material: 'TG11', quantity: 2, price: 12.5 }, traceB)).toEqual([]);
});

test('the order created in SAP is registered as KEPT, not cleaned: nothing here undoes it, and the report must not say it did @e2e', async ({ sap, sapData }) => {
  await ensureLoggedIn(sap, creds);
  const orderNo = await createOrderInSap(sap, sapData, getCorrelationId() as string, { customer: '1000', material: 'TG11', quantity: 1 });
  const final = await sapData.cleanup();
  const entry = final.find((item) => item.id === orderNo);
  expect(entry?.status).toBe('kept');
  expect(entry?.status).not.toBe('cleaned');
});

test('an order that never arrives is reported as missing in the first system that lacks it, quoting the correlation id @e2e', async ({ sap, sapData, landscape }) => {
  const correlationId = getCorrelationId() as string;
  await ensureLoggedIn(sap, creds);
  const orderNo = await createOrderInSap(sap, sapData, correlationId, { customer: '1000', material: 'TG11', quantity: 1 });
  // the interface is down: nothing is delivered
  await expect(collectTrace(landscape, orderNo, correlationId, 600)).rejects.toThrow(new RegExp(`no row for correlation id ${shortId(correlationId)} in sales_orders`));
});

// Each system the interface feeds, left out in turn: the verification must FAIL naming that system. (A fresh landscape per
// case: the shared one remembers the other tests' deliveries, and an order number alone could then find a stranger's.)
const MISSING: Array<[DownstreamSystem, RegExp]> = [
  ['database', /no row for correlation id \w+ in sales_orders/],
  ['sftp', /no file with \w+ in \/outbound/],
  ['fulfilment', /the fulfilment API never received order \d+/],
];
for (const [system, message] of MISSING) {
  test(`a delivery that skips the ${system} is caught, naming it @e2e`, async ({ sap, sapData }) => {
    const correlationId = getCorrelationId() as string;
    await ensureLoggedIn(sap, creds);
    const orderNo = await createOrderInSap(sap, sapData, correlationId, { customer: '1000', material: 'TG11', quantity: 1 });
    const landscape = await OrderLandscape.start();
    try {
      await landscape.deliver({ orderNo, correlationId, customer: '1000', material: 'TG11', quantity: 1, price: 12.5 }, 50, { skip: [system] });
      await expect(collectTrace(landscape, orderNo, correlationId, 600)).rejects.toThrow(message);
    } finally {
      await landscape.stop();
    }
  });
}
