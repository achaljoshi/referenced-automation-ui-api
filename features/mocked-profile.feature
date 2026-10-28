@mocking
Feature: Mocking a page's runtime API data
  profile.html fetches /api/profile when it loads; a scenario can replace that answer without changing the real endpoint

  @smoke
  Scenario: Without a mock, the page renders whatever the real API returns
    Given I start already logged in with the login saved by the setup project
    When I open the page "/profile.html"
    Then the profile name reads "Ada Lovelace"

  @smoke
  Scenario: A mock overrides the same fetch call with mock data instead
    Given I start already logged in with the login saved by the setup project
    And the profile API is mocked, with mockApiRoute, to answer the name "Mocked Ada"
    When I open the page "/profile.html"
    Then the profile name reads "Mocked Ada"
