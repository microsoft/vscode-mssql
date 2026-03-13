/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { addConnectionButton } from "./utils/commonSelectors";
import { test, expect } from "./baseFixtures";
import { getWebviewByTitle } from "./utils/testHelpers";
import { usePerTestVsCodeLifecycle } from "./utils/testLifecycle";

/**
 * Running a few launch specific tests to ensure the VSIX package is working correctly.
 * Since code-coverage is not supported for VSIX based tests, we are converting all tests to use the VSIX package.
 */
test.describe("MSSQL Extension - VSIX Based tests", async () => {
    const getContext = usePerTestVsCodeLifecycle({
        launchOptions: {
            useVsix: true,
        },
    });

    // Test if extension activates correctly
    test("Extension activates correctly", async () => {
        const { electronApp: vsCodeApp } = getContext();
        expect(vsCodeApp).not.toBeNull();
    });

    // Test if the webview loads correctly
    test("MSSQL add connection webview is loaded correctly", async () => {
        const { page: vsCodePage } = getContext();
        const addButton = await vsCodePage.locator(addConnectionButton);
        await addButton.click();
        const connectionDialog = await getWebviewByTitle(vsCodePage, "Connection Dialog");
        await connectionDialog.locator("#connectButton").isVisible();
    });
});
