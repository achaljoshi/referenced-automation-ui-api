package com.company.automation.uiapi.runners;

import org.junit.platform.suite.api.IncludeEngines;
import org.junit.platform.suite.api.SelectClasspathResource;
import org.junit.platform.suite.api.Suite;

/**
 * Full regression entry point: {@code mvn test} (via the Surefire include
 * pattern {@code **}{@code /Run*.java}) discovers this class and runs every
 * {@code .feature} file under {@code src/test/resources/features}.
 *
 * <p>Glue path, plugin list and reporting are configured once in
 * {@code junit-platform.properties} - notice the glue path includes BOTH
 * {@code com.company.automation.hooks} (referenced-automation-ui's untagged
 * {@code Hooks}) AND {@code com.company.automation.api.hooks} (referenced-automation-api's
 * untagged {@code ApiHooks}), reused completely as-is: every scenario in
 * this repo is inherently hybrid, so unlike {@code referenced-automation-sap}
 * there is no need for tag-scoped hook classes here - both lifecycles simply
 * run for every scenario.
 */
@Suite
@IncludeEngines("cucumber")
@SelectClasspathResource("features")
public class RunCucumberTest {
}
