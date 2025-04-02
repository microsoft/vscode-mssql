/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { Page, TestInfo } from "@playwright/test";

export async function screenshotOnFailure(page: Page, testInfo: TestInfo): Promise<void> {
    if (testInfo.status !== testInfo.expectedStatus) {
        const formattedTestTitle = testInfo.title.replace(/ /g, "-");
        const screenshotPath = testInfo.outputPath(`${formattedTestTitle}-failure.png`);
        testInfo.attachments.push({
            name: `${formattedTestTitle}-failure.png`,
            path: screenshotPath,
            contentType: "image/png",
        });

        await page.screenshot({ path: screenshotPath, timeout: 5000 });
    }
}
