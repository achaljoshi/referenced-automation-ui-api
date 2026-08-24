package com.company.automation.uiapi.pages;

import com.company.automation.base.BasePage;
import com.microsoft.playwright.Page;

/** Page object for SauceDemo's post-login inventory/products page. */
public class SauceProductsPage extends BasePage {

    /** Public so step definitions navigating a brand-new BrowserContext straight here can reuse the same constant. */
    public static final String URL = "https://www.saucedemo.com/inventory.html";

    private static final String PAGE_TITLE = ".title";

    public SauceProductsPage(Page page) {
        super(page);
    }

    public boolean isLoaded() {
        return isDisplayed(PAGE_TITLE) && "Products".equals(textOf(PAGE_TITLE));
    }
}
