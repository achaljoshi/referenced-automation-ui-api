import { SapPage } from '@automation/referenced-automation-sap';

/**
 * The SAP screens this flow touches, as page objects: the technical ids live here, once. These are SAP's
 * standard VA01 ids (as in the SAP package's sample); adapt them to your system with `npm run doctor -- --dump`.
 */
export class EasyAccessPage extends SapPage {
  readonly marker = 'wnd[0]/tbar[0]/okcd';

  async open(tcode: string): Promise<void> {
    await this.sap.startTransaction(tcode);
  }
}

export class CreateOrderInitialPage extends SapPage {
  readonly marker = 'wnd[0]/usr/ctxtVBAK-AUART';
  readonly orderType = this.sap.locator('wnd[0]/usr/ctxtVBAK-AUART');
  readonly salesOrg = this.sap.locator('wnd[0]/usr/ctxtVBAK-VKORG');
  readonly channel = this.sap.locator('wnd[0]/usr/ctxtVBAK-VTWEG');
  readonly division = this.sap.locator('wnd[0]/usr/ctxtVBAK-SPART');

  async enter(order: { type: string; salesOrg: string; channel: string; division: string }): Promise<OrderOverviewPage> {
    await this.orderType.fill(order.type);
    await this.salesOrg.fill(order.salesOrg);
    await this.channel.fill(order.channel);
    await this.division.fill(order.division);
    await this.sap.sendVKey(0);
    return new OrderOverviewPage(this.sap).waitUntilDisplayed();
  }
}

export class OrderOverviewPage extends SapPage {
  readonly marker = 'wnd[0]/usr/ctxtKUAGV-KUNNR';
  /** Found by the label the user sees, with the id as a reported fallback if a release changes it. */
  readonly customer = this.sap.locator('wnd[0]/usr/ctxtKUAGV-KUNNR').orElse(this.sap.getByLabel('Sold-To Party'));
  readonly customerReference = this.sap.locator('wnd[0]/usr/txtVBKD-BSTKD').orElse(this.sap.getByLabel('Customer Reference'));
  readonly items = this.sap.table('wnd[0]/usr/tblSAPMV45ATCTRL_U_ERF_AUFTRAG');
  readonly save = this.sap.getByTooltip('Save');

  async addItem(row: number, item: { material: string; quantity: string }): Promise<void> {
    await this.items.cell('ctxtRV45A-MABNR', 1, row).fill(item.material);
    await this.items.cell('txtRV45A-KWMENG', 3, row).fill(item.quantity);
  }
}
