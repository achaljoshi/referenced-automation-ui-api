package com.company.automation.uiapi.stepdefinitions;

import com.company.automation.driver.PlaywrightManager;
import com.company.automation.uiapi.pages.SauceLoginPage;
import com.company.automation.uiapi.pages.SauceProductsPage;
import com.microsoft.playwright.Browser;
import com.microsoft.playwright.BrowserContext;
import com.microsoft.playwright.Page;
import io.cucumber.java.After;
import io.cucumber.java.en.Given;
import io.cucumber.java.en.Then;
import io.cucumber.java.en.When;
import org.junit.jupiter.api.Assertions;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;

/**
 * Step definitions for session-sharing.feature, demonstrating Playwright's
 * {@code BrowserContext.storageState()} / {@code Browser.NewContextOptions.setStorageStatePath()}
 * pair - the exact mechanism a real hybrid suite would use to seed a UI
 * {@link BrowserContext} from a session established via
 * {@code referenced-automation-api}'s {@code ApiClient} against a backend
 * genuinely shared with the UI under test. This scenario stays on the UI
 * side only (logs in twice via SauceDemo's own form the "normal" way once,
 * then via storage-state replay) because SauceDemo and JSONPlaceholder do
 * not share a backend - see README "A note on the sample scenarios".
 *
 * <p>The {@code @After} below has no explicit {@code order}, unlike
 * {@code referenced-automation-ui}'s own {@code Hooks.tearDown} (which uses
 * {@code order = 0}) - the two are independent (this one only ever touches
 * {@link #replayedContext}, a completely separate {@link BrowserContext}
 * from the one {@code Hooks} manages) so their relative firing order does
 * not matter.
 */
public class SessionSharingSteps {

    private static final Path STORAGE_STATE_PATH = Paths.get("target", "auth", "saucedemo-state.json");

    private BrowserContext replayedContext;
    private SauceProductsPage replayedProductsPage;

    @Given("I have logged in to SauceDemo as {string}")
    public void i_have_logged_in_as(String username) {
        new SauceLoginPage(PlaywrightManager.getPage()).open().login(username, "secret_sauce");
    }

    @When("I save that browser session and open a brand new browser context from it")
    public void i_save_that_browser_session_and_open_a_new_context() throws IOException {
        Files.createDirectories(STORAGE_STATE_PATH.getParent());
        PlaywrightManager.getContext().storageState(new BrowserContext.StorageStateOptions().setPath(STORAGE_STATE_PATH));

        Browser browser = PlaywrightManager.getBrowser();
        replayedContext = browser.newContext(new Browser.NewContextOptions().setStorageStatePath(STORAGE_STATE_PATH));
        Page replayedPage = replayedContext.newPage();
        replayedPage.navigate(SauceProductsPage.URL);
        replayedProductsPage = new SauceProductsPage(replayedPage);
    }

    @Then("the new context should already be logged in without seeing the login form")
    public void the_new_context_should_already_be_logged_in() {
        Assertions.assertTrue(replayedProductsPage.isLoaded(),
                "Expected the replayed BrowserContext to land straight on the Products page using the saved session state");
    }

    @After
    public void closeReplayedContext() {
        if (replayedContext != null) {
            replayedContext.close();
        }
    }
}
