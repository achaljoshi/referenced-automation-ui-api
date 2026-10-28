@hybrid
Feature: One login, two frameworks
  Logging in through the API signs the browser in too, because both share one session

  @smoke
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
    And the server recognised the session on the dashboard as "valid"

  @regression
  Scenario: Without logging in through the API, the page shows the anonymous state
    Given I open the page "/dashboard.html"
    Then I should see "Please log in"
    And I should not see "Welcome back!"

  @smoke @regression
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
    And I should not see "Welcome back!"

  @smoke
  Scenario: The page shows what the API serves to a signed-in user, and a mocked answer replaces it
    Given I open the page "/profile.html"
    Then I should see "Please log in to see your profile"
    When I send a POST request to "/login" with JSON:
      """
      { "username": "ada", "password": "{{env:HYBRID_PASSWORD|secret}}" }
      """
    Then the response status is 200
    When I reload the page
    Then the profile name reads "Ada Lovelace"
    Given I generate a random first-name called "mockedName"
    And the request to "**/api/profile" returns JSON:
      """
      { "name": "Mocked {{mockedName}}" }
      """
    When I reload the page
    Then the profile name reads "Mocked {{mockedName}}"
    And I should not see "Ada Lovelace"
    And the page has no accessibility violations
