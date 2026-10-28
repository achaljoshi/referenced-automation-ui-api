Feature: One order traced across SAP, the database, the SFTP drop and the fulfilment API by one correlation id
  A sales order saved in SAP GUI is read back from every system the order interface feeds, and the systems must agree with SAP.
  The one correlation id is on the price request, in SAP's customer reference, in the database row, in the SFTP file name and on
  the fulfilment API call, so one failing order can be followed through every system by searching for one value.

  READ THIS BEFORE TRUSTING A GREEN RUN. These are HARNESS SELF-TESTS: SAP GUI is the SAP package's built-in simulator and the
  "interface" is a stand-in (tests/support/orderLandscape.ts) that the scenario itself calls ("the order interface delivers ...")
  with data built from what it typed. So the reconciliation proves the harness can create an order, read it back from every
  system, tie the systems together by one correlation id and report a disagreement or a missing delivery - not that a real SAP
  interface delivers anything (only the simulator's order number is independent of the scenario). For a real landscape: use a
  real SAP session, point the landscape at the real database, SFTP host and API, and drop the "delivers" steps - SAP's own
  interface does that part; the read-back and reconciliation steps stay as they are.

  Background:
    Given I am logged on to SAP

  @e2e
  Scenario: An order saved in SAP is read back from the database, SFTP and the fulfilment API and reconciles under one correlation id
    Given the order landscape is running
    When I look up the price of material "TG11" in the price API
    And I create the sales order "order" in SAP for customer "1000", material "TG11", quantity 5
    And the order interface delivers the order "order" as SAP saved it
    And I read the order "order" back from the database, the SFTP drop and the fulfilment API
    Then the systems agree with SAP about the order "order"
    And SAP holds the correlation id of the order "order" in its customer reference
    And the SFTP file name of the order "order" contains its correlation id
    And the database row of the order "order" carries its correlation id
    And the fulfilment API received the order "order" under its correlation id
    And the SAP journal shows the transaction "VA01"

  @e2e
  Scenario: A delivery that disagrees with SAP is caught, and says which system and which field
    Given the order landscape is running
    When I look up the price of material "TG12" in the price API
    And I create the sales order "order" in SAP for customer "1000", material "TG12", quantity 3
    And the order interface delivers the order "order" with the quantity 30 instead
    And I read the order "order" back from the database, the SFTP drop and the fulfilment API
    Then the reconciliation of the order "order" reports "database: quantity is 30, SAP has 3"
    And the reconciliation of the order "order" reports "SFTP file: quantity is 30, SAP has 3"
    And the reconciliation of the order "order" reports "fulfilment API: quantity is 30, SAP has 3"
    And the reconciliation of the order "order" does not report the order number or the correlation id as wrong

  Scenario: Every order gets its own correlation id, so two orders never get confused
    Given the order landscape is running
    And the order "first" is traced by a correlation id of its own
    And the order "second" is traced by a correlation id of its own
    When I look up the price of material "TG11" in the price API
    And I create the sales order "first" in SAP for customer "1000", material "TG11", quantity 1
    And I create the sales order "second" in SAP for customer "1000", material "TG11", quantity 2
    Then the orders "first" and "second" have different correlation ids
    And SAP gave the orders "first" and "second" different order numbers
    And SAP registered exactly the orders "first" and "second", in that order
    When the order interface delivers the order "first" as SAP saved it
    And the order interface delivers the order "second" as SAP saved it
    And I read the order "first" back from the database, the SFTP drop and the fulfilment API
    And I read the order "second" back from the database, the SFTP drop and the fulfilment API
    Then SAP holds the correlation id of the order "first" in its customer reference
    And SAP holds the correlation id of the order "second" in its customer reference
    And SAP holds different customer references for the orders "first" and "second"
    And the database row of the order "first" has its own order number and the quantity 1
    And the database row of the order "second" has its own order number and the quantity 2
    And the SFTP file name of the order "first" contains its correlation id
    And the SFTP file name of the order "first" does not contain the correlation id of the order "second"
    And the fulfilment API received the order "second" under its correlation id
    And the systems agree with SAP about the order "first"
    And the systems agree with SAP about the order "second"

  @e2e
  Scenario: The order created in SAP is registered as KEPT, not cleaned: nothing here undoes it, and the report must not say it did
    When I create the sales order "order" in SAP for customer "1000", material "TG11", quantity 1
    Then the SAP data report lists the order "order" as kept, not as cleaned

  @e2e
  Scenario: An order that never arrives is reported as missing in the first system that lacks it, quoting the correlation id
    Given the order landscape is running
    When I create the sales order "order" in SAP for customer "1000", material "TG11", quantity 1
    And I try to read the order "order" back from every system for 600 milliseconds
    Then reading the order "order" back failed with a message matching "no row for correlation id {{orderShortId}} in sales_orders"

  @e2e
  Scenario Outline: A delivery that skips the <system> is caught, naming it
    Given the order landscape is running
    When I look up the price of material "TG11" in the price API
    And I create the sales order "order" in SAP for customer "1000", material "TG11", quantity 1
    And the order interface delivers the order "order" as SAP saved it, leaving out the <system>
    And I try to read the order "order" back from every system for 600 milliseconds
    Then reading the order "order" back failed with a message matching "<message>"

    Examples:
      | system      | message                                       |
      | database    | no row for correlation id \w+ in sales_orders |
      | sftp        | no file with \w+ in /outbound                 |
      | fulfilment  | the fulfilment API never received order \d+   |
