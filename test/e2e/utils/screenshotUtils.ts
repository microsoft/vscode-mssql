/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { Page, TestInfo } from "@playwright/test";

export async function screenshotOnFailure(page: Page, testInfo: TestInfo): Promise<void> {
    if (testInfo.status !== testInfo.expectedStatus) {
        await screenshot(page, testInfo, "failure");
    }
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
