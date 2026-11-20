/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

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
import {
    addDatabaseConnection,
    disconnect,
    getStatusBar,
    getWebviewByTitle,
    getModifierKey,
    openNewQueryEditor,
} from "./utils/testHelpers";
import { test, expect } from "./baseFixtures";
import { useSharedVsCodeLifecycle } from "./utils/testLifecycle";
import { QuickInput } from "./pageObjects";

test.describe("MSSQL Extension - Database Connection", async () => {
    const getContext = useSharedVsCodeLifecycle();

    test("Collapses and expands the connections sidebar without clearing the form", async () => {
        const { page } = getContext();
        await new QuickInput(page).runCommand(
            "MS SQL: Add Connection",
            "MS SQL: Add Connection...",
        );
        const dialog = await getWebviewByTitle(page, "Connection Dialog");
        const collapseButton = dialog.getByRole("button", {
            name: "Collapse recent and saved connections",
        });
        const importButton = dialog.getByRole("button", {
            name: "Import from Azure Data Studio",
        });
        const sidebar = dialog.locator(".react-resizable").filter({ has: collapseButton });
        const serverInput = dialog.getByRole("textbox", { name: "Server name" });
        await serverInput.fill("sidebar-test-server");
        await expect(importButton).toBeVisible();
        await expect(collapseButton).toHaveAttribute("aria-expanded", "true");
        const expandedWidth = await sidebar.evaluate(
            (element) => element.getBoundingClientRect().width,
        );
        await collapseButton.hover();
        await expect(dialog.getByRole("tooltip")).toHaveText(
            "Collapse recent and saved connections",
        );
        await collapseButton.click();

        const expandButton = dialog.getByRole("button", {
            name: "Expand recent and saved connections",
        });
        const collapsedSidebar = dialog.locator(".react-resizable").filter({ has: expandButton });
        await expect(expandButton).toBeVisible();
        await expect(expandButton).toHaveAttribute("aria-expanded", "false");
        await expect(importButton).toBeHidden();
        await expect(dialog.getByText("Saved Connections", { exact: true })).toBeHidden();
        await expect(collapsedSidebar.getByRole("button")).toHaveCount(1);
        expect(
            await collapsedSidebar.evaluate((element) => element.getBoundingClientRect().width),
        ).toBeLessThanOrEqual(40);
        await expect(serverInput).toHaveValue("sidebar-test-server");
        await expandButton.hover();
        await expect(dialog.getByRole("tooltip")).toHaveText("Expand recent and saved connections");
        await expandButton.focus();
        await expandButton.press("Enter");

        await expect(collapseButton).toBeVisible();
        await expect(importButton).toBeVisible();
        await expect(dialog.getByText("Saved Connections", { exact: true })).toBeVisible();
        expect(await sidebar.evaluate((element) => element.getBoundingClientRect().width)).toBe(
            expandedWidth,
        );
        await expect(serverInput).toHaveValue("sidebar-test-server");
        await page.keyboard.press(`${getModifierKey()}+W`);
        await expect(collapseButton).toBeHidden();
    });

    test("Connect to local SQL Database, and disconnect", async ({}, testInfo) => {
        const { page: vsCodePage } = getContext();
        const serverName = getServerName();
        const databaseName = getDatabaseName();
        const authType = getAuthenticationType();
        const userName = getUserName();
        const password = getPassword();
        const savePassword = getSavePassword();
        const profileName = getProfileName();
        await addDatabaseConnection(
            vsCodePage,
            serverName,
            databaseName,
            authType,
            userName,
            password,
            savePassword,
            profileName,
        );

        await screenshot(vsCodePage, testInfo, "connected");

        await openNewQueryEditor(vsCodePage);
        await screenshot(vsCodePage, testInfo, "new query editor opened");

        // New editor should be connected to the last added connection
        await disconnect(vsCodePage);
        await screenshot(vsCodePage, testInfo, "disconnected");

        // Verify that the Connect to MSSQL button is visible again after disconnecting
        // The status item includes a tooltip in its accessible name on current VS Code.
        const connectAgainButton = getStatusBar(vsCodePage).getByRole("button", {
            name: /Connect to MSSQL/,
        });
        await expect(connectAgainButton).toBeVisible({ timeout: 10 * 1000 });
    });
});
