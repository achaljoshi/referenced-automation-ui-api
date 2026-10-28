@remote
Feature: UI steps here, API and database steps on the remote host
  One scenario, two machines: the browser runs on the test machine (for example an AWS WorkSpace), and the API and database
  steps run on the remote RDP host through the remote-desktop utility (docs/REMOTE_DESKTOP.md in referenced-automation-utils).
  Here the remote host is the utility's stand-in agent, so this proves the wiring and NOT a real RDP session (NOT VERIFIED on a
  real host). With a real host, REMOTE_ENABLED=true and the REMOTE_* keys in .env.<env>.local and nothing else changes.

  @e2e
  Scenario: The browser sees the anonymous page, then the remote host logs in and reads the profile
    Given I open the page "/dashboard.html"
    Then I should see "Please log in"
    When the remote host sends a POST request to "/login" with JSON:
      """
      { "username": "ada", "password": "{{env:HYBRID_PASSWORD|secret}}" }
      """
    Then the remote host's response status is 200
    And the remote host's response field "user" equals "ada"
    # the remote call carries no browser session, so the server must refuse it
    When the remote host sends a GET request to "/api/profile"
    Then the remote host's response status is 401
    And the request reached the server from the remote host

  @regression
  Scenario: A database step on the remote host writes and reads back
    When the remote host's database stores the note "created in the UI test" under id 1
    Then the remote host's database holds the note "created in the UI test" under id 1

  @regression
  Scenario: When the remote agent stops, the failure says so instead of hanging
    Given a remote host with an agent of its own
    When the agent of that remote host crashes
    Then reaching that remote host fails with the error code "AGENT_STALE"
