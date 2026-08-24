package com.company.automation.uiapi.pages;

import com.company.automation.base.BasePage;
import com.microsoft.playwright.Page;

/**
 * Page object for SauceDemo's login page, extending
 * {@code referenced-automation-ui}'s shipped {@link BasePage} exactly like a
 * page object inside the ui repo itself would - the whole point of this repo
 * is that no framework code (BasePage, Playwright lifecycle, waits,
 * reporting) needs to be reimplemented, only page objects/step definitions
 * specific to this repo's own sample scenarios.
 *
 * <p>Deliberately hardcodes SauceDemo's URL rather than calling
 * {@code com.company.automation.config.ConfigReader.baseUrl()} - see this
 * repo's {@code config/config.properties} for why the shared {@code base.url}
 * key is reserved for referenced-automation-api's meaning in this repo.
 */
public class SauceLoginPage extends BasePage {

    private static final String URL = "https://www.saucedemo.com/";
    private static final String USERNAME_FIELD = "#user-name";
    private static final String PASSWORD_FIELD = "#password";
    private static final String LOGIN_BUTTON = "#login-button";
    private static final String ERROR_MESSAGE = "[data-test='error']";

    public SauceLoginPage(Page page) {
        super(page);
    }

    public SauceLoginPage open() {
        navigateTo(URL);
        return this;
    }

    public void login(String username, String password) {
        type(USERNAME_FIELD, username);
        type(PASSWORD_FIELD, password);
        click(LOGIN_BUTTON);
    }

    public boolean isErrorDisplayed() {
        return isDisplayed(ERROR_MESSAGE);
    }

    public String errorText() {
        return textOf(ERROR_MESSAGE);
    }
}
