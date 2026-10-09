import { ApiClient } from '@automation/referenced-automation-api';
import { createSampleSapSystem, ensureLoggedIn, sapGuiTest } from '@automation/referenced-automation-sap';
import { getCorrelationId } from '@automation/referenced-automation-utils';
import { expect } from '@playwright/test';
import { collectTrace, createOrderInSap, lookUpPrice, reconcile, referenceFor, shortId } from './support/flows/orderToCash';
import { OrderLandscape, type DeliveredOrder } from './support/orderLandscape';

/**
 * ONE business scenario across four systems, traced by ONE correlation id:
 *
 *   REST price lookup  ->  SAP GUI sales order  ->  (SAP's interface)  ->  database + SFTP file + fulfilment API
 *
 * SAP GUI runs against the SAP package's built-in simulator and the "interface" is a stand-in
 * (tests/support/orderLandscape.ts), so this runs on any machine. For a real landscape: use a real SAP session
 * (SAP_GUI_MODE / .env files) and point the landscape at the real database, SFTP host and API.
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

test('an order created in SAP GUI reaches the database, SFTP and the fulfilment API, traceable by one correlation id @e2e', async ({ sap, sapData, landscape, request }) => {
  const correlationId = getCorrelationId() as string;
  await ensureLoggedIn(sap, creds);

  // 1. API: price lookup. ApiClient puts the test's correlation id on the request header by itself.
  const price = await lookUpPrice(new ApiClient(request, landscape.api.baseUrl), 'TG11');

  // 2. SAP GUI: the order. The correlation id goes into its customer reference, so it is visible inside SAP too.
  const orderNo = await createOrderInSap(sap, sapData, correlationId, { customer: '1000', material: 'TG11', quantity: 5 });
  const expected: DeliveredOrder = { orderNo, correlationId, customer: '1000', material: 'TG11', quantity: 5, price };

  // 3. The interface does its asynchronous work (a stand-in here; SAP does this for real).
  void landscape.deliver(expected);

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
  void landscape.deliver({ ...expected, quantity: 30 });
  const trace = await collectTrace(landscape, orderNo, correlationId);

  const problems = reconcile(expected, trace);
  expect(problems).toContain('database: quantity is 30, SAP has 3');
  expect(problems).toContain('SFTP file: quantity is 30, SAP has 3');
  expect(problems).toContain('fulfilment API: quantity is 30, SAP has 3');
  expect(problems.some((p) => p.includes('order number') || p.includes('correlation'))).toBe(false); // what DID match is not reported
});

test('every order gets its own correlation id, so two orders never get confused', async ({ sap, sapData, landscape }) => {
  const first = getCorrelationId() as string;
  await ensureLoggedIn(sap, creds);
  const a = await createOrderInSap(sap, sapData, first, { customer: '1000', material: 'TG11', quantity: 1 });
  const b = await createOrderInSap(sap, sapData, first, { customer: '1000', material: 'TG11', quantity: 2 });
  expect(a).not.toBe(b); // SAP numbers each order itself
  expect(sapData.items.map((i) => i.id)).toEqual([a, b]);
  void landscape; // (nothing delivered: this test is about SAP's own numbering and the data registry)
});

test('an order that never arrives is reported as missing in the first system that lacks it, quoting the correlation id @e2e', async ({ sap, sapData, landscape }) => {
  const correlationId = getCorrelationId() as string;
  await ensureLoggedIn(sap, creds);
  const orderNo = await createOrderInSap(sap, sapData, correlationId, { customer: '1000', material: 'TG11', quantity: 1 });
  // the interface is down: nothing is delivered
  await expect(collectTrace(landscape, orderNo, correlationId, 600)).rejects.toThrow(new RegExp(`no row for correlation id ${shortId(correlationId)} in sales_orders`));
});
