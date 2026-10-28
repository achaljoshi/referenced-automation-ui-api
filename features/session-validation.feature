@sessions
Feature: The server decides who is signed in
  The sample server checks the session cookie itself, so a forged, expired or missing cookie never gets the signed-in page.
  Each of these passed on the old server (which showed the welcome banner for ANY session cookie): they exist so the
  hybrid-login scenarios can fail for the right reason.

  @regression
  Scenario Outline: A forged cookie is anonymous on the page and refused by the API, however it is forged
    Given the browser carries a session cookie forged as "<forgery>"
    When I open the page "/dashboard.html"
    Then I should see "Please log in"
    And I should not see "Welcome back!"
    And the server recognised the session on the dashboard as "forged"
    When I send a GET request to "/api/profile"
    Then the response status is 401

    Examples:
      | forgery                                       |
      | the constant the old server handed out        |
      | a valid payload with someone else's signature |
      | a different user under the real signature     |
      | an unsigned payload                           |

  @regression
  Scenario: An expired session is anonymous on the page and refused by the API - the same cookie was fine before it expired
    Given another sample server whose sessions last 60 seconds
    And the API base URL is "{{otherServer}}"
    When I send a POST request to "/login" with JSON:
      """
      { "username": "ada", "password": "{{env:HYBRID_PASSWORD|secret}}" }
      """
    Then the response status is 200
    When I open the page "{{otherServer}}/dashboard.html"
    Then I should see "Welcome back!"
    When I send a GET request to "/api/profile"
    Then the response status is 200
    When the server's clock moves on by 61 seconds
    And I open the page "{{otherServer}}/dashboard.html"
    Then I should see "Please log in"
    And I should not see "Welcome back!"
    And the server recognised the session on the dashboard as "expired"
    When I send a GET request to "/api/profile"
    Then the response status is 401
    And the response field "session" equals "expired"

  @regression
  Scenario: A login the browser never received does not sign the page in, so the UI step must actually send the cookie
    Given I log in as "ada" with the password "{{env:HYBRID_PASSWORD|secret}}" over an API connection that does not share the browser's cookies
    Then that API connection is signed in
    And the browser holds no session cookie
    When I open the page "/dashboard.html"
    Then I should see "Please log in"
    And I should not see "Welcome back!"
    And the server recognised the session on the dashboard as "missing"

  @regression
  Scenario: Every login issues a different, signed session
    When I send a POST request to "/login" with JSON:
      """
      { "username": "ada", "password": "{{env:HYBRID_PASSWORD|secret}}" }
      """
    Then the response status is 200
    When I remember the browser's session cookie as "first"
    And I send a POST request to "/login" with JSON:
      """
      { "username": "ada", "password": "{{env:HYBRID_PASSWORD|secret}}" }
      """
    Then the response status is 200
    When I remember the browser's session cookie as "second"
    Then the variable "first" is not empty
    And the variable "second" is not empty
    And the variable "second" is different from the variable "first"
    And the variable "first" matches "[\w-]+\.[\w-]+"
    And the variable "first" does not contain "issued-by-api"

  @regression
  Scenario: The session cookie cannot be read by the page (HttpOnly), so the page cannot be signed in by a script
    When I send a POST request to "/login" with JSON:
      """
      { "username": "ada", "password": "{{env:HYBRID_PASSWORD|secret}}" }
      """
    Then the response status is 200
    When I open the page "/dashboard.html"
    Then the page cannot read the session cookie
    And the session cookie is HttpOnly
