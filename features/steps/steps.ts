import { registerSapSteps } from '@automation/referenced-automation-sap';
import { createBdd } from 'playwright-bdd';
import { test } from './fixtures';

const { Given, When, Then } = createBdd(test);

// The business-readable SAP vocabulary ("I open transaction ...", "the status bar shows ...") lives in the SAP
// package and is shared by every project. Add this project's own steps below, using the same Given/When/Then.
registerSapSteps({ Given, When, Then });
