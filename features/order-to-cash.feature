@e2e
Feature: Order to cash across SAP and the systems around it
  An order saved in SAP GUI reaches the fulfilment service, followed by one order number through every step

  Scenario: An order created in SAP reaches the fulfilment API
    Given I am logged on to SAP
    And the order landscape is running
    When I open transaction "VA01"
    And I enter "OR" in the field labelled "Order Type"
    And I enter "1000" in the field labelled "Sales Organization"
    And I enter "10" in the field labelled "Distribution Channel"
    And I enter "00" in the field labelled "Division"
    And I press Enter
    And I enter "1000" in the field labelled "Sold-To Party"
    And I enter "E2E-{{random:alnum(8)}}" in the field labelled "Customer Reference"
    And I click the toolbar button "Save"
    And I remember the number from the status bar matching "Order (\d+)" as "order"
    Then the variable "order" matches "\d+"
    When the order interface delivers order "{{order}}" for customer "1000"
    And I wait until a GET request to "{{fulfilmentApi}}/fulfilments?orderNo={{order}}" returns "[0].status" equal to "RECEIVED" within 10 seconds
    Then the response field "[0].orderNo" equals "{{order}}"
    And the response field "[0].quantity" equals "5"
