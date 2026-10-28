@sessions
Feature: A saved login
  The login the setup project saves once (tests/auth.setup.ts) starts a scenario already signed in, and it is only as good as
  the server that checks it

  @smoke
  Scenario: A scenario starts already logged in, with no login step of its own
    Given I start already logged in with the login saved by the setup project
    When I open the page "/dashboard.html"
    Then I should see "Welcome back!"
    And the server recognised the session on the dashboard as "valid"

  @regression
  Scenario: The saved login is only as good as the server that checks it
    Given I start already logged in with the login saved by the setup project
    And another sample server that never issued the saved login
    When I open the page "{{otherServer}}/dashboard.html"
    Then I should see "Please log in"
    And I should not see "Welcome back!"
    And the server recognised the session on the dashboard as "forged"
    When I send a GET request to "{{otherServer}}/api/profile"
    Then the response status is 401
