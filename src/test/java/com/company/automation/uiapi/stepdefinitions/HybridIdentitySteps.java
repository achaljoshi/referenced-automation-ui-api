package com.company.automation.uiapi.stepdefinitions;

import com.company.automation.api.client.ApiClient;
import com.company.automation.api.client.ApiResponseWrapper;
import com.company.automation.driver.PlaywrightManager;
import com.company.automation.uiapi.pages.SauceLoginPage;
import io.cucumber.java.en.Given;
import io.cucumber.java.en.Then;
import io.cucumber.java.en.When;
import org.junit.jupiter.api.Assertions;

/**
 * Step definitions for hybrid-identity.feature - the scenario this whole
 * repo exists to demonstrate: a single Cucumber scenario using
 * {@code referenced-automation-api}'s {@link ApiClient} (a {@code Given})
 * and {@code referenced-automation-ui}'s {@link PlaywrightManager}-backed
 * {@link SauceLoginPage} (a {@code When}/{@code Then}) together, with zero
 * framework code of its own - both are the exact same classes either
 * framework's own sample suite uses.
 */
public class HybridIdentitySteps {

    private String apiUsername;
    private SauceLoginPage loginPage;

    @Given("I fetch user {string} from the JSONPlaceholder Users API")
    public void i_fetch_user_from_the_users_api(String userId) {
        ApiResponseWrapper response = ApiClient.given().get("/users/" + userId).shouldBeOk();
        apiUsername = response.asJsonNode().get("username").asText();
    }

    @When("I attempt to log in to SauceDemo with that user's API username and password {string}")
    public void i_attempt_to_log_in_with_that_username(String password) {
        loginPage = new SauceLoginPage(PlaywrightManager.getPage()).open();
        loginPage.login(apiUsername, password);
    }

    @Then("SauceDemo should show its standard invalid-credentials error")
    public void sauce_demo_should_show_its_standard_error() {
        Assertions.assertTrue(loginPage.isErrorDisplayed(), "Expected SauceDemo's login error message to be displayed");
        Assertions.assertEquals(
                "Epic sadface: Username and password do not match any user in this service",
                loginPage.errorText());
    }
}
