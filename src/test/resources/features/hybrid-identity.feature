@hybrid
Feature: Composing the API and UI frameworks - identity correlation
  As a QA engineer working across a REST API and a web UI
  I want a single Cucumber scenario to fetch data via the API framework and
  feed it into a UI framework interaction
  So that this repo demonstrates its whole reason for existing: composing
  referenced-automation-ui and referenced-automation-api with zero
  duplicated framework code

  Note: JSONPlaceholder (the API demo target) and SauceDemo (the UI demo
  target) are two unrelated public demo services with no shared backend -
  see README "A note on the sample scenarios" for why this scenario is an
  honest illustration of framework composition, not a claim that these two
  services are integrated with each other.

  @smoke
  Scenario: A username sourced from the Users API is rejected by SauceDemo's login form
    Given I fetch user "1" from the JSONPlaceholder Users API
    When I attempt to log in to SauceDemo with that user's API username and password "wrong-password"
    Then SauceDemo should show its standard invalid-credentials error
