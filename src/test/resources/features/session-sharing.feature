@hybrid
Feature: Playwright browser storage state sharing across contexts
  As a QA engineer whose real application under test shares a backend
  between its UI and its API
  I want to log in once and reuse that authenticated session in a fresh
  browser context
  So that I avoid repeating an expensive login flow for every scenario

  This scenario stays entirely on the UI side (SauceDemo's own login is
  enough to demonstrate the mechanism), but is the exact technique this
  repo's real-world equivalent would use to seed a UI BrowserContext from a
  session established via the API framework's ApiClient against a backend
  genuinely shared with the UI - see README "Sharing session state between
  the API and UI frameworks".

  @regression
  Scenario: A saved storage state lets a new context skip the login form
    Given I have logged in to SauceDemo as "standard_user"
    When I save that browser session and open a brand new browser context from it
    Then the new context should already be logged in without seeing the login form
