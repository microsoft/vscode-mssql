/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { Page, TestInfo } from "@playwright/test";
import * as fs from "fs";
import * as path from "path";

export function hasTestFailure(testInfo: TestInfo): boolean {
    return testInfo.status !== testInfo.expectedStatus;
}

export async function screenshotOnFailure(page: Page, testInfo: TestInfo): Promise<void> {
    if (hasTestFailure(testInfo)) {
        await screenshot(page, testInfo, "failure");
    }
}

/**
 * Takes a screenshot during suite-level setup (e.g. inside afterLaunch / test.beforeAll),
 * where testInfo is not available. Images are written to:
 *   test-reports/setup-screenshots/<label>-<timestamp>.png
 *
 * They will not be attached to any individual test in the HTML report, but are
 * findable on disk for debugging setup failures.
 */
export async function screenshotSetup(page: Page, label: string): Promise<void> {
    const dir = path.join(process.cwd(), "test-reports", "setup-screenshots");
    fs.mkdirSync(dir, { recursive: true });
    const fileName = `${label.replace(/ /g, "-")}-${Date.now()}.png`;
    await page.screenshot({ path: path.join(dir, fileName), timeout: 5000 });
}

export async function screenshot(page: Page, testInfo: TestInfo, suffix?: string): Promise<void> {
    const formattedTestTitle = testInfo.title.replace(/ /g, "-");
    const fileName = `${formattedTestTitle}-${Date.now()}${suffix ? `-${suffix}` : ""}.png`;
    const screenshotPath = testInfo.outputPath(fileName);
    testInfo.attachments.push({
        name: fileName,
        path: screenshotPath,
        contentType: "image/png",
    });

    await page.screenshot({ path: screenshotPath, timeout: 5000 });
}
