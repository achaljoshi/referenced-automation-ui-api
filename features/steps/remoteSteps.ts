import { expect } from '@playwright/test';
import { createBdd } from 'playwright-bdd';
import { test } from './fixtures';

const { Given, When, Then } = createBdd(test);

// Steps for a scenario with two machines: the browser on the test machine, and a remote host (here the remote-desktop
// utility's stand-in agent - NOT VERIFIED on a real RDP host) that makes the API calls and runs the database statements.

const VERBS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const;
type Verb = (typeof VERBS)[number];
const verb = (word: string): Verb => {
  const upper = word.toUpperCase() as Verb;
  if (!VERBS.includes(upper)) throw new Error(`"${word}" is not an HTTP method. Use one of: ${VERBS.join(', ')}`);
  return upper;
};

When('the remote host sends a {word} request to {string}', async ({ remote, vars }, method: string, path: string) => {
  await remote.send(verb(method), vars.interpolate(path));
});

When('the remote host sends a {word} request to {string} with JSON:', async ({ remote, vars }, method: string, path: string, docString: string) => {
  await remote.send(verb(method), vars.interpolate(path), { json: vars.interpolateDeep(JSON.parse(docString)) });
});

Then("the remote host's response status is {int}", ({ remote }, status: number) => {
  remote.response().expectStatus(status);
});

Then("the remote host's response field {string} equals {string}", ({ remote, vars }, field: string, expected: string) => {
  remote.response().expectValue(field, vars.interpolate(expected));
});

Then('the request reached the server from the remote host', ({ remote }) => {
  expect(remote.serverSawNewRequest()).toBe(true);
});

When("the remote host's database stores the note {string} under id {int}", async ({ remote, vars }, note: string, id: number) => {
  await remote.storeNote(id, vars.interpolate(note));
});

Then("the remote host's database holds the note {string} under id {int}", async ({ remote, vars }, note: string, id: number) => {
  expect(await remote.readNote(id)).toBe(vars.interpolate(note));
});

Given('a remote host with an agent of its own', async ({ ownRemoteHost }) => {
  await ownRemoteHost.start();
});

When('the agent of that remote host crashes', async ({ ownRemoteHost }) => {
  await ownRemoteHost.crashAgent();
});

Then('reaching that remote host fails with the error code {string}', async ({ ownRemoteHost }, code: string) => {
  await expect(ownRemoteHost.ping()).rejects.toMatchObject({ code });
});
