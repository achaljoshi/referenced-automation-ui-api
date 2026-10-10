import { registerApiSteps } from '@automation/referenced-automation-api';
import { registerSapSteps } from '@automation/referenced-automation-sap';
import { registerDataSteps, registerUiSteps } from '@automation/referenced-automation-ui';
import { createBdd } from 'playwright-bdd';
import { test } from './fixtures';

const { Given, When, Then } = createBdd(test);

// The vocabulary each package ships - the same sentences in every project that uses it. Register the data steps once.
registerDataSteps({ Given, Then });
registerSapSteps({ Given, When, Then });
registerUiSteps({ Given, When, Then });
registerApiSteps({ Given, When, Then });

// This project's own steps: the systems around SAP that only this landscape has.
Given('the order landscape is running', async ({ landscape, vars }) => {
  vars.set('fulfilmentApi', landscape.api.baseUrl);
});

When('the order interface delivers order {string} for customer {string}', ({ landscape, vars, correlationId }, orderNo: string, customer: string) => {
  // Asynchronous, like the real interface: the feature waits for the result with "I wait until ...", not with a sleep.
  void landscape.deliver({ orderNo: vars.interpolate(orderNo), correlationId, customer: vars.interpolate(customer), material: 'TG11', quantity: 5, price: 12.5 });
});
