/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Page } from "@playwright/test";
import { screenshot } from "./utils/screenshotUtils";
import {
    getServerName,
    getDatabaseName,
    getAuthenticationType,
    getUserName,
    getPassword,
    getProfileName,
    getSavePassword,
} from "./utils/envConfigReader";
import { addDatabaseConnection, getWebviewByTitle } from "./utils/testHelpers";
import { test, expect } from "./baseFixtures";
import { useSharedVsCodeLifecycle } from "./utils/testLifecycle";
import { QuickInput, VsCodeCommand } from "./pageObjects";

/**
 * Object Explorer commands run from the Command Palette receive no tree node. They should use the
 * Object Explorer selection or ask for a target instead of failing with
 * "Cannot read properties of undefined".
 */
test.describe("MSSQL Extension - Object Explorer commands from the Command Palette", async () => {
    const getContext = useSharedVsCodeLifecycle({
        afterLaunch: async ({ page }) => {
            await addDatabaseConnection(
                page,
                getServerName(),
                getDatabaseName(),
                getAuthenticationType(),
                getUserName(),
                getPassword(),
                getSavePassword(),
                getProfileName(),
            );
            // The connected server node expands to show its Databases folder.
            await expect(getTreeItem(page, /^Databases/)).toBeVisible({ timeout: 60 * 1000 });
        },
    });

    function getTreeItem(page: Page, name: string | RegExp) {
        return page.getByRole("treeitem", { name }).first();
    }

    async function selectServerNode(page: Page): Promise<void> {
        const serverNode = getTreeItem(page, getProfileName() || getServerName());
        await serverNode.click();
        await expect(serverNode).toHaveAttribute("aria-selected", "true");
    }

    async function expectNoUndefinedNodeError(page: Page): Promise<void> {
        await expect(page.getByText(/Cannot read properties of undefined/)).toHaveCount(0);
    }

    test("Import Data opens the import wizard for the selected server", async ({}, testInfo) => {
        const { page } = getContext();
        await selectServerNode(page);

        await new QuickInput(page).run(VsCodeCommand.mssqlImportData);

        await getWebviewByTitle(page, "Import Flat File", 60 * 1000);
        await screenshot(page, testInfo, "import wizard opened");
        await expectNoUndefinedNodeError(page);
    });

    test("Backup Database lists the selected server's databases", async ({}, testInfo) => {
        const { page } = getContext();
        await selectServerNode(page);
        const quickInput = new QuickInput(page);

        await quickInput.run(VsCodeCommand.mssqlBackupDatabase);
        // master lives in the System Databases subfolder, so this also covers that lookup.
        await quickInput.pick("master", 60 * 1000);

        await getWebviewByTitle(page, "Backup Database - master", 60 * 1000);
        await screenshot(page, testInfo, "backup dialog opened");
        await expectNoUndefinedNodeError(page);
    });
});
