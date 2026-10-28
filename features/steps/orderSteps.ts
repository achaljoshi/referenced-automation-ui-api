import { expect } from '@playwright/test';
import { createBdd } from 'playwright-bdd';
import { referenceFor, shortId } from '../../tests/support/flows/orderToCash';
import type { DownstreamSystem } from '../../tests/support/orderLandscape';
import { test } from './fixtures';

const { Given, When, Then } = createBdd(test);

// Steps for the order-to-cash trace: an order is created in SAP GUI under a correlation id, the (stand-in) order interface
// delivers it, and the systems around SAP are read back and checked against what SAP holds. The flow is
// tests/support/flows/orderToCash.ts; an order is called by the name the feature gives it ("order", "first", "second").
// The sentences that log on to SAP and start the landscape are the shared / steps.ts ones.

const SYSTEMS: readonly DownstreamSystem[] = ['database', 'sftp', 'fulfilment'];
const system = (word: string): DownstreamSystem => {
  if (!SYSTEMS.includes(word as DownstreamSystem)) throw new Error(`"${word}" is not a system the interface feeds. Use one of: ${SYSTEMS.join(', ')}`);
  return word as DownstreamSystem;
};

Given('the order {string} is traced by a correlation id of its own', ({ orders }, name: string) => {
  orders.giveOwnCorrelationId(name);
});

When('I look up the price of material {string} in the price API', async ({ orders, landscape, request }, material: string) => {
  await orders.lookUpPrice(landscape, request, material);
});

When('I create the sales order {string} in SAP for customer {string}, material {string}, quantity {int}', async ({ orders, sap, sapData, correlationId, vars }, name: string, customer: string, material: string, quantity: number) => {
  const order = await orders.create(sap, sapData, name, { customer, material, quantity }, correlationId);
  // the names a later step can use as {{order}}, {{orderCorrelationId}}, {{orderShortId}} ("order" being the name given here)
  vars.set(name, order.orderNo);
  vars.set(`${name}CorrelationId`, order.correlationId);
  vars.set(`${name}ShortId`, shortId(order.correlationId));
});

When('the order interface delivers the order {string} as SAP saved it', async ({ orders, landscape }, name: string) => {
  await orders.deliver(landscape, name);
});

When('the order interface delivers the order {string} as SAP saved it, leaving out the {word}', async ({ orders, landscape }, name: string, skipped: string) => {
  await orders.deliver(landscape, name, { skip: [system(skipped)] });
});

When('the order interface delivers the order {string} with the quantity {int} instead', async ({ orders, landscape }, name: string, quantity: number) => {
  // the interface delivers the wrong quantity everywhere - the kind of defect only a cross-system check finds
  await orders.deliver(landscape, name, { quantity });
});

When('I read the order {string} back from the database, the SFTP drop and the fulfilment API', async ({ orders, landscape }, name: string) => {
  await orders.readBack(landscape, name);
});

When('I try to read the order {string} back from every system for {int} milliseconds', async ({ orders, landscape }, name: string, ms: number) => {
  await orders.tryReadBack(landscape, name, ms);
});

Then('the systems agree with SAP about the order {string}', ({ orders }, name: string) => {
  expect(orders.problemsWith(name), 'the systems disagree about the order').toEqual([]);
});

Then('the reconciliation of the order {string} reports {string}', ({ orders }, name: string, problem: string) => {
  expect(orders.problemsWith(name)).toContain(problem);
});

Then('the reconciliation of the order {string} does not report the order number or the correlation id as wrong', ({ orders }, name: string) => {
  // what DID match is not reported
  expect(orders.problemsWith(name).some((p) => p.includes('order number') || p.includes('correlation'))).toBe(false);
});

Then('reading the order {string} back failed with a message matching {string}', ({ orders, vars }, name: string, pattern: string) => {
  const { readError } = orders.get(name);
  if (readError === undefined) throw new Error(`Reading order "${name}" back was expected to fail but it succeeded`);
  expect(readError instanceof Error ? readError.message : String(readError)).toMatch(new RegExp(vars.interpolate(pattern)));
});

Then('SAP holds the correlation id of the order {string} in its customer reference', ({ orders }, name: string) => {
  expect(orders.traceOf(name).sapReference).toBe(referenceFor(orders.get(name).correlationId));
});

Then('SAP holds different customer references for the orders {string} and {string}', ({ orders }, first: string, second: string) => {
  expect(orders.traceOf(first).sapReference).not.toBe(orders.traceOf(second).sapReference);
});

Then('the orders {string} and {string} have different correlation ids', ({ orders }, first: string, second: string) => {
  const [a, b] = [orders.get(first).correlationId, orders.get(second).correlationId];
  expect(b).not.toBe(a);
  expect(shortId(b)).not.toBe(shortId(a));
});

Then('SAP gave the orders {string} and {string} different order numbers', ({ orders }, first: string, second: string) => {
  expect(orders.get(first).orderNo).not.toBe(orders.get(second).orderNo); // SAP numbers each order itself
});

Then('SAP registered exactly the orders {string} and {string}, in that order', ({ orders, sapData }, first: string, second: string) => {
  expect(sapData.items.map((i) => i.id)).toEqual([orders.get(first).orderNo, orders.get(second).orderNo]);
});

Then('the database row of the order {string} carries its correlation id', ({ orders }, name: string) => {
  expect(orders.traceOf(name).db?.correlation_id).toBe(orders.get(name).correlationId);
});

Then('the database row of the order {string} has its own order number and the quantity {int}', ({ orders }, name: string, quantity: number) => {
  expect([orders.traceOf(name).db?.order_no, orders.traceOf(name).db?.quantity]).toEqual([orders.get(name).orderNo, quantity]);
});

Then('the SFTP file name of the order {string} contains its correlation id', ({ orders }, name: string) => {
  expect(orders.traceOf(name).file?.name).toContain(shortId(orders.get(name).correlationId));
});

Then('the SFTP file name of the order {string} does not contain the correlation id of the order {string}', ({ orders }, name: string, other: string) => {
  expect(orders.traceOf(name).file?.name).not.toContain(shortId(orders.get(other).correlationId));
});

Then('the fulfilment API received the order {string} under its correlation id', ({ orders }, name: string) => {
  expect(orders.traceOf(name).fulfilment?.correlationHeader).toBe(orders.get(name).correlationId);
});

Then('the SAP journal shows the transaction {string}', ({ sap }, tcode: string) => {
  expect(sap.journalText()).toContain(tcode);
});

Then('the SAP data report lists the order {string} as kept, not as cleaned', async ({ orders, sapData }, name: string) => {
  // Nothing in the flow undoes the order (the simulator forgets it with the session), so it is registered as KEPT, and the report must not say otherwise.
  const final = await sapData.cleanup();
  const entry = final.find((item) => item.id === orders.get(name).orderNo);
  expect(entry?.status).toBe('kept');
  expect(entry?.status).not.toBe('cleaned');
});
