@hybrid @smoke
Feature: One login, two frameworks
  Logging in through the API signs the browser in too, because both share one session

  Scenario: A login through the API is honoured by the web page
    Given I open the page "/dashboard.html"
    Then I should see "Please log in"
    When I send a POST request to "/login" with JSON:
      """
      { "username": "ada", "password": "{{env:HYBRID_PASSWORD|secret}}" }
      """
    Then the response status is 200
    And the response field "user" equals "ada"
    When I reload the page
    Then I should see "Welcome back!"
    And I should not see "Please log in"

  Scenario: A refused login signs nobody in
    Given I open the page "/dashboard.html"
    When I send a POST request to "/login" with JSON:
      """
      { "username": "ada", "password": "not-the-password" }
      """
    Then the response status is 401
    And the response field "error" equals "invalid_credentials"
    When I reload the page
    Then I should see "Please log in"

  Scenario: The page shows what the API serves, and a mocked answer replaces it
    Given I open the page "/profile.html"
    Then I should see "Ada Lovelace"
    Given the request to "**/api/profile" returns JSON:
      """
      { "name": "Mocked {{random:first-name}}" }
      """
    When I reload the page
    Then I should not see "Ada Lovelace"
    And the page has no accessibility violations
