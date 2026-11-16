/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { Page, TestInfo } from "@playwright/test";

export function hasTestFailure(testInfo: TestInfo): boolean {
    return testInfo.status !== testInfo.expectedStatus;
}

/** Longest file name stem kept, so nested artifact paths stay within Windows path limits. */
const MAX_FILE_NAME_LENGTH = 80;

/**
 * Turns a test title into a file name that every platform and actions/upload-artifact accept.
 * Titles can contain characters such as `:` (for example "Publish DACPAC: ..."), and a single
 * rejected file name fails the whole artifact upload.
 */
export function toSafeFileName(value: string): string {
    const collapsed = value
        .trim()
        .replace(/[^\w.-]+/g, "-")
        .replace(/-+/g, "-")
        .slice(0, MAX_FILE_NAME_LENGTH)
        .replace(/^[-.]+|[-.]+$/g, "");
    return collapsed || "test";
}

export async function screenshotOnFailure(page: Page, testInfo: TestInfo): Promise<void> {
    if (hasTestFailure(testInfo)) {
        await screenshot(page, testInfo, "failure");
    }
}

export async function screenshot(page: Page, testInfo: TestInfo, suffix?: string): Promise<void> {
    const fileName = `${toSafeFileName(testInfo.title)}-${Date.now()}${suffix ? `-${suffix}` : ""}.png`;
    const screenshotPath = testInfo.outputPath(fileName);
    testInfo.attachments.push({
        name: fileName,
        path: screenshotPath,
        contentType: "image/png",
    });

    await page.screenshot({ path: screenshotPath, timeout: 5000 });
}
