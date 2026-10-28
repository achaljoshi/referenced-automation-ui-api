import { randomUUID } from 'node:crypto';
import { ApiClient } from '@automation/referenced-automation-api';
import type { SapDataRegistry, SapGuiSession } from '@automation/referenced-automation-sap';
import type { APIRequestContext } from '@playwright/test';
import { collectTrace, createOrderInSap, lookUpPrice, reconcile, type OrderRequest, type OrderTrace } from '../../../tests/support/flows/orderToCash';
import type { DeliveredOrder, DownstreamSystem, OrderLandscape } from '../../../tests/support/orderLandscape';

/** One order of the scenario, by the name the feature gives it: what SAP saved, what was expected everywhere else, and what was read back. */
export interface TrackedOrder {
  name: string;
  correlationId: string;
  orderNo: string;
  request: OrderRequest;
  /** What every system should hold; set when the interface delivers. */
  expected?: DeliveredOrder;
  trace?: OrderTrace;
  /** What reading the order back threw, for "failed with a message matching". */
  readError?: unknown;
}

/**
 * What one order-to-cash scenario carries between steps. The flow itself (SAP page objects, the polling read-back, the
 * reconciliation) is tests/support/flows/orderToCash.ts; this only keeps the orders, prices and correlation ids by name.
 */
export class OrderScenario {
  private readonly orders = new Map<string, TrackedOrder>();
  private readonly prices = new Map<string, number>();
  private readonly ownIds = new Map<string, string>();

  get(name: string): TrackedOrder {
    const order = this.orders.get(name);
    if (!order) throw new Error(`No order called "${name}" yet. Known: ${[...this.orders.keys()].join(', ') || '(none)'}`);
    return order;
  }

  /** The order gets a correlation id of its own (as in a real flow, one per order) instead of the scenario's. */
  giveOwnCorrelationId(name: string): void {
    this.ownIds.set(name, randomUUID());
  }

  async lookUpPrice(landscape: OrderLandscape, request: APIRequestContext, material: string): Promise<void> {
    this.prices.set(material, await lookUpPrice(new ApiClient(request, landscape.api.baseUrl), material));
  }

  async create(sap: SapGuiSession, sapData: SapDataRegistry, name: string, request: OrderRequest, scenarioCorrelationId: string): Promise<TrackedOrder> {
    const correlationId = this.ownIds.get(name) ?? scenarioCorrelationId;
    const orderNo = await createOrderInSap(sap, sapData, correlationId, request);
    const order: TrackedOrder = { name, correlationId, orderNo, request };
    this.orders.set(name, order);
    return order;
  }

  /** The interface delivers what SAP saved - or, to prove a disagreement is caught, something different - and leaves out the systems in `skip`. */
  async deliver(landscape: OrderLandscape, name: string, options: { quantity?: number; skip?: readonly DownstreamSystem[] } = {}): Promise<void> {
    const order = this.get(name);
    const price = this.prices.get(order.request.material);
    if (price === undefined) throw new Error(`The price of ${order.request.material} is not known: add "When I look up the price of material "${order.request.material}" in the price API" first`);
    const expected: DeliveredOrder = { orderNo: order.orderNo, correlationId: order.correlationId, customer: order.request.customer, material: order.request.material, quantity: order.request.quantity, price };
    order.expected = expected;
    await landscape.deliver({ ...expected, ...(options.quantity === undefined ? {} : { quantity: options.quantity }) }, undefined, options.skip ? { skip: options.skip } : {});
  }

  async readBack(landscape: OrderLandscape, name: string, timeoutMs?: number): Promise<void> {
    const order = this.get(name);
    order.trace = await collectTrace(landscape, order.orderNo, order.correlationId, timeoutMs);
  }

  /** Reading back may fail on purpose; the failure is kept for the step that says how it must read. */
  async tryReadBack(landscape: OrderLandscape, name: string, timeoutMs: number): Promise<void> {
    const order = this.get(name);
    try {
      order.trace = await collectTrace(landscape, order.orderNo, order.correlationId, timeoutMs);
      order.readError = undefined;
    } catch (error) {
      order.readError = error;
    }
  }

  traceOf(name: string): OrderTrace {
    const trace = this.get(name).trace;
    if (!trace) throw new Error(`Order "${name}" was not read back: add "When I read the order "${name}" back ..." first`);
    return trace;
  }

  /** What the systems disagree about (empty = they agree). */
  problemsWith(name: string): string[] {
    const order = this.get(name);
    if (!order.expected) throw new Error(`The interface has not delivered order "${name}" yet`);
    return reconcile(order.expected, this.traceOf(name));
  }
}
