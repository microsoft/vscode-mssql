/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * E2E tests for Schema Compare:
 *  - Open Schema Compare from the command palette
 *  - Open Schema Compare from Object Explorer context menu
 *  - Select source and target databases (both local SQL databases)
 *  - Run comparison — verify "no differences" for identical schemas
 *  - Run comparison — verify differences are found when schemas differ
 *
 * Complexity: Medium
 *
 * The Schema Compare webview title is "Schema Compare".
 * Toolbar buttons have aria-labels: "Compare", "Select Source Schema", "Select Target Schema".
 * The schema selector drawer uses Fluent UI Dropdown for Server and Database.
 */

import { FrameLocator } from "@playwright/test";
import { screenshot } from "./utils/screenshotUtils";
import {
    addDatabaseConnection,
    enterTextIntoQueryEditor,
    executeQuery,
    getWebviewByTitle,
    getModifierKey,
    openNewQueryEditor,
    waitForCommandPaletteToBeVisible,
} from "./utils/testHelpers";
import {
    getAuthenticationType,
    getDatabaseName,
    getPassword,
    getProfileName,
    getSavePassword,
    getServerName,
    getUserName,
} from "./utils/envConfigReader";
import { test, expect } from "./baseFixtures";
import { useSharedVsCodeLifecycle } from "./utils/testLifecycle";
import {
    expandObjectExplorerNode,
    rightClickObjectExplorerNode,
    clickContextMenuItem,
} from "./utils/objectExplorerHelpers";

const SC_SOURCE_DB = "E2ESCSourceDB";
const SC_TARGET_DB = "E2ESCTargetDB";

/**
 * Opens Schema Compare from the command palette and returns its FrameLocator.
 */
async function openSchemaCompare(
    vsCodePage: import("@playwright/test").Page,
): Promise<FrameLocator> {
    await vsCodePage.keyboard.press(`${getModifierKey()}+P`);
    await waitForCommandPaletteToBeVisible(vsCodePage);
    await vsCodePage.keyboard.type(">MS SQL: Schema Compare");
    await waitForCommandPaletteToBeVisible(vsCodePage);
    await vsCodePage.keyboard.press("Enter");

    await new Promise((resolve) => setTimeout(resolve, 2 * 1000));
    const iframe = await getWebviewByTitle(vsCodePage, "Schema Compare");

    // Wait for the Compare toolbar button — confirms the page has loaded
    await iframe
        .getByRole("button", { name: "Compare" })
        .first()
        .waitFor({ state: "visible", timeout: 30 * 1000 });

    return iframe;
}

/**
 * Selects a database endpoint in the Schema Compare drawer.
 *
 * @param endpointLabel   "Select Source Schema" or "Select Target Schema"
 * @param serverDisplayName  Fragment of the server name shown in the dropdown
 * @param databaseName    The database to select
 */
async function selectSchemaEndpoint(
    iframe: FrameLocator,
    endpointLabel: "Select Source Schema" | "Select Target Schema",
    serverDisplayName: string,
    databaseName: string,
): Promise<void> {
    // Click the "..." button that opens the schema selector drawer
    await iframe.getByRole("button", { name: endpointLabel }).click();

    // "Database" radio is selected by default; wait for Server dropdown
    const serverDropdown = iframe.locator("[role='combobox']").first();
    await serverDropdown.waitFor({ state: "visible", timeout: 15 * 1000 });
    await serverDropdown.click();

    const serverOption = iframe.getByRole("option").filter({ hasText: serverDisplayName }).first();
    await serverOption.waitFor({ state: "visible", timeout: 10 * 1000 });
    await serverOption.click();

    // Wait for databases to load, then pick the database
    await new Promise((resolve) => setTimeout(resolve, 2 * 1000));
    const dbDropdown = iframe.locator("[role='combobox']").nth(1);
    await dbDropdown.waitFor({ state: "visible", timeout: 15 * 1000 });
    await dbDropdown.click();

    const dbOption = iframe.getByRole("option").filter({ hasText: databaseName }).first();
    await dbOption.waitFor({ state: "visible", timeout: 10 * 1000 });
    await dbOption.click();

    // Confirm the selection
    await iframe.getByRole("button", { name: "OK" }).click();
}

test.describe("MSSQL Extension - Schema Compare", async () => {
    const getContext = useSharedVsCodeLifecycle({
        afterLaunch: async ({ page: vsCodePage }) => {
            await addDatabaseConnection(
                vsCodePage,
                getServerName(),
                getDatabaseName(),
                getAuthenticationType(),
                getUserName(),
                getPassword(),
                getSavePassword(),
                getProfileName(),
            );

            // Create two databases with identical schemas
            await openNewQueryEditor(vsCodePage);
            const setup = `
USE master;
IF DB_ID(N'${SC_SOURCE_DB}') IS NOT NULL
BEGIN
    ALTER DATABASE [${SC_SOURCE_DB}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE;
    DROP DATABASE [${SC_SOURCE_DB}];
END
CREATE DATABASE [${SC_SOURCE_DB}];
USE [${SC_SOURCE_DB}];
CREATE TABLE [dbo].[Products] (
    ProductId   INT           NOT NULL PRIMARY KEY,
    ProductName NVARCHAR(200) NOT NULL,
    Price       DECIMAL(10,2) NOT NULL DEFAULT 0.00
);

USE master;
IF DB_ID(N'${SC_TARGET_DB}') IS NOT NULL
BEGIN
    ALTER DATABASE [${SC_TARGET_DB}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE;
    DROP DATABASE [${SC_TARGET_DB}];
END
CREATE DATABASE [${SC_TARGET_DB}];
USE [${SC_TARGET_DB}];
CREATE TABLE [dbo].[Products] (
    ProductId   INT           NOT NULL PRIMARY KEY,
    ProductName NVARCHAR(200) NOT NULL,
    Price       DECIMAL(10,2) NOT NULL DEFAULT 0.00
);`;
            await enterTextIntoQueryEditor(vsCodePage, setup);
            await executeQuery(vsCodePage);
            await new Promise((resolve) => setTimeout(resolve, 3 * 1000));
        },
        beforeClose: async ({ page: vsCodePage }) => {
            await openNewQueryEditor(vsCodePage);
            const cleanup = `
USE master;
IF DB_ID(N'${SC_SOURCE_DB}') IS NOT NULL
BEGIN
    ALTER DATABASE [${SC_SOURCE_DB}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE;
    DROP DATABASE [${SC_SOURCE_DB}];
END
IF DB_ID(N'${SC_TARGET_DB}') IS NOT NULL
BEGIN
    ALTER DATABASE [${SC_TARGET_DB}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE;
    DROP DATABASE [${SC_TARGET_DB}];
END`;
            await enterTextIntoQueryEditor(vsCodePage, cleanup);
            await executeQuery(vsCodePage);
            await new Promise((resolve) => setTimeout(resolve, 5 * 1000));
        },
    });

    test("Schema Compare opens from the command palette", async ({}, testInfo) => {
        const { page: vsCodePage } = getContext();

        const iframe = await openSchemaCompare(vsCodePage);
        await screenshot(vsCodePage, testInfo, "schema-compare-opened");

        // Action bar must contain the Compare button
        await expect(iframe.getByRole("button", { name: "Compare" }).first()).toBeVisible();

        // Introductory text is visible before any endpoints are selected
        await expect(
            iframe.getByText("To compare two schemas, first select a source schema").first(),
        ).toBeVisible({ timeout: 10 * 1000 });

        await vsCodePage.keyboard.press(`${getModifierKey()}+W`);
    });

    test("Schema Compare can be opened via Object Explorer context menu", async ({}, testInfo) => {
        const { page: vsCodePage } = getContext();

        await expandObjectExplorerNode(vsCodePage, getServerName(), 30 * 1000);
        await expandObjectExplorerNode(vsCodePage, "Databases", 20 * 1000);
        await screenshot(vsCodePage, testInfo, "oe-expanded");

        await rightClickObjectExplorerNode(vsCodePage, SC_SOURCE_DB, 20 * 1000);
        await screenshot(vsCodePage, testInfo, "context-menu-visible");

        await clickContextMenuItem(vsCodePage, "Schema Compare");
        await screenshot(vsCodePage, testInfo, "schema-compare-launched-from-oe");

        const iframe = await getWebviewByTitle(vsCodePage, "Schema Compare");
        await iframe
            .getByRole("button", { name: "Compare" })
            .first()
            .waitFor({ state: "visible", timeout: 30 * 1000 });

        await screenshot(vsCodePage, testInfo, "schema-compare-loaded");

        // When launched from context menu the source endpoint field should already
        // contain the selected database name
        const sourceInput = iframe.locator("input").first();
        await expect(sourceInput).toBeVisible({ timeout: 10 * 1000 });

        await vsCodePage.keyboard.press(`${getModifierKey()}+W`);
    });

    test("Schema Compare detects no differences between identical schemas", async ({}, testInfo) => {
        const { page: vsCodePage } = getContext();

        const iframe = await openSchemaCompare(vsCodePage);
        await screenshot(vsCodePage, testInfo, "schema-compare-opened");

        await selectSchemaEndpoint(iframe, "Select Source Schema", getServerName(), SC_SOURCE_DB);
        await screenshot(vsCodePage, testInfo, "source-selected");

        await selectSchemaEndpoint(iframe, "Select Target Schema", getServerName(), SC_TARGET_DB);
        await screenshot(vsCodePage, testInfo, "target-selected");

        // Run the comparison
        const compareButton = iframe.getByRole("button", { name: "Compare" }).first();
        await expect(compareButton).toBeEnabled({ timeout: 10 * 1000 });
        await compareButton.click();
        await screenshot(vsCodePage, testInfo, "comparison-running");

        // "No schema differences were found." message should appear
        await expect(iframe.getByText("No schema differences were found.")).toBeVisible({
            timeout: 2 * 60 * 1000,
        });
        await screenshot(vsCodePage, testInfo, "no-differences-found");

        await vsCodePage.keyboard.press(`${getModifierKey()}+W`);
    });

    test("Schema Compare detects differences when schemas differ", async ({}, testInfo) => {
        const { page: vsCodePage } = getContext();

        // Add an extra table to the source database so the schemas differ
        await openNewQueryEditor(vsCodePage);
        const alterScript = `
USE [${SC_SOURCE_DB}];
CREATE TABLE [dbo].[Inventory] (
    InventoryId INT NOT NULL PRIMARY KEY,
    Quantity    INT NOT NULL DEFAULT 0
);`;
        await enterTextIntoQueryEditor(vsCodePage, alterScript);
        await executeQuery(vsCodePage);
        await screenshot(vsCodePage, testInfo, "source-altered");

        const iframe = await openSchemaCompare(vsCodePage);

        await selectSchemaEndpoint(iframe, "Select Source Schema", getServerName(), SC_SOURCE_DB);
        await screenshot(vsCodePage, testInfo, "source-selected");

        await selectSchemaEndpoint(iframe, "Select Target Schema", getServerName(), SC_TARGET_DB);
        await screenshot(vsCodePage, testInfo, "target-selected");

        const compareButton = iframe.getByRole("button", { name: "Compare" }).first();
        await expect(compareButton).toBeEnabled({ timeout: 10 * 1000 });
        await compareButton.click();
        await screenshot(vsCodePage, testInfo, "comparison-running");

        // The results should list the Inventory table as a difference
        await expect(iframe.getByText("Inventory").first()).toBeVisible({ timeout: 2 * 60 * 1000 });
        await screenshot(vsCodePage, testInfo, "differences-found");

        await vsCodePage.keyboard.press(`${getModifierKey()}+W`);
    });
});
