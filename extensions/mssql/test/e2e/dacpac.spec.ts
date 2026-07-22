/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * E2E tests for DACPAC / BACPAC operations via the Data-Tier Application dialog:
 *
 *  - Open the dialog from the command palette — verify all four operations present
 *  - Open the dialog from Object Explorer context menu
 *  - Switching operation types updates the form (Package file vs Output file labels)
 *  - Extract DACPAC from a local database (via the dialog)
 *  - Deploy (Publish) DACPAC to a new database (via the dialog)
 *
 * Complexity: Hard
 *
 * File paths use /var/opt/mssql/backup/ — always writable in the SQL Server
 * Docker container. Timeouts are set to 10 minutes for data-intensive operations.
 *
 * The dialog webview title is "Data-tier Application".
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

const DACPAC_SOURCE_DB = "E2EDacpacSourceDB";
const DACPAC_DEPLOY_DB = "E2EDacpacDeployDB";
const DACPAC_DIALOG_TITLE = "Data-tier Application";

/**
 * Opens the Data-Tier Application dialog from the command palette.
 */
async function openDacpacDialog(
    vsCodePage: import("@playwright/test").Page,
): Promise<FrameLocator> {
    await vsCodePage.keyboard.press(`${getModifierKey()}+P`);
    await waitForCommandPaletteToBeVisible(vsCodePage);
    await vsCodePage.keyboard.type(">MS SQL: Data-Tier Application");
    await waitForCommandPaletteToBeVisible(vsCodePage);
    await vsCodePage.keyboard.press("Enter");

    await new Promise((resolve) => setTimeout(resolve, 2 * 1000));
    const iframe = await getWebviewByTitle(vsCodePage, DACPAC_DIALOG_TITLE);

    await iframe
        .getByRole("button", { name: "Execute" })
        .first()
        .waitFor({ state: "visible", timeout: 30 * 1000 });

    return iframe;
}

/**
 * Selects a connection profile in the DACPAC dialog's server dropdown.
 * Picks the first option whose text contains serverNameFragment.
 */
async function selectDacpacServer(iframe: FrameLocator, serverNameFragment: string): Promise<void> {
    const serverDropdown = iframe.locator("[role='combobox']").first();
    await serverDropdown.waitFor({ state: "visible", timeout: 20 * 1000 });
    await serverDropdown.click();

    const serverOption = iframe.getByRole("option").filter({ hasText: serverNameFragment }).first();
    await serverOption.waitFor({ state: "visible", timeout: 15 * 1000 });
    await serverOption.click();
}

/**
 * Selects a database in the DACPAC dialog's database dropdown (second combobox).
 */
async function selectDacpacDatabase(iframe: FrameLocator, databaseName: string): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 2 * 1000));
    const dbDropdown = iframe.locator("[role='combobox']").nth(1);
    await dbDropdown.waitFor({ state: "visible", timeout: 20 * 1000 });
    await dbDropdown.click();

    const dbOption = iframe.getByRole("option").filter({ hasText: databaseName }).first();
    await dbOption.waitFor({ state: "visible", timeout: 15 * 1000 });
    await dbOption.click();
}

test.describe("MSSQL Extension - DACPAC Operations", async () => {
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

            // Create a source database with a well-defined schema for extraction
            await openNewQueryEditor(vsCodePage);
            const setup = `
USE master;
IF DB_ID(N'${DACPAC_SOURCE_DB}') IS NOT NULL
BEGIN
    ALTER DATABASE [${DACPAC_SOURCE_DB}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE;
    DROP DATABASE [${DACPAC_SOURCE_DB}];
END
IF DB_ID(N'${DACPAC_DEPLOY_DB}') IS NOT NULL
BEGIN
    ALTER DATABASE [${DACPAC_DEPLOY_DB}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE;
    DROP DATABASE [${DACPAC_DEPLOY_DB}];
END

CREATE DATABASE [${DACPAC_SOURCE_DB}];
USE [${DACPAC_SOURCE_DB}];
CREATE TABLE [dbo].[Customers] (
    CustomerId   INT           NOT NULL PRIMARY KEY,
    CustomerName NVARCHAR(200) NOT NULL,
    Email        NVARCHAR(200) NOT NULL UNIQUE,
    CreatedAt    DATETIME2     NOT NULL DEFAULT GETUTCDATE()
);
CREATE TABLE [dbo].[Orders] (
    OrderId     INT            NOT NULL PRIMARY KEY,
    CustomerId  INT            NOT NULL REFERENCES [dbo].[Customers](CustomerId),
    OrderDate   DATETIME2      NOT NULL DEFAULT GETUTCDATE(),
    TotalAmount DECIMAL(10,2)  NOT NULL
);
CREATE VIEW [dbo].[CustomerOrders] AS
    SELECT c.CustomerName, o.OrderId, o.TotalAmount
    FROM   [dbo].[Customers] c
    JOIN   [dbo].[Orders]    o ON o.CustomerId = c.CustomerId;
INSERT INTO [dbo].[Customers] (CustomerId, CustomerName, Email)
VALUES (1, 'Alice', 'alice@example.com'),
       (2, 'Bob',   'bob@example.com');
INSERT INTO [dbo].[Orders] (OrderId, CustomerId, TotalAmount)
VALUES (1, 1, 150.00), (2, 2, 80.00), (3, 1, 200.00);`;

            await enterTextIntoQueryEditor(vsCodePage, setup);
            await executeQuery(vsCodePage);
            await new Promise((resolve) => setTimeout(resolve, 3 * 1000));
        },
        beforeClose: async ({ page: vsCodePage }) => {
            await openNewQueryEditor(vsCodePage);
            const cleanup = `
USE master;
IF DB_ID(N'${DACPAC_SOURCE_DB}') IS NOT NULL
BEGIN
    ALTER DATABASE [${DACPAC_SOURCE_DB}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE;
    DROP DATABASE [${DACPAC_SOURCE_DB}];
END
IF DB_ID(N'${DACPAC_DEPLOY_DB}') IS NOT NULL
BEGIN
    ALTER DATABASE [${DACPAC_DEPLOY_DB}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE;
    DROP DATABASE [${DACPAC_DEPLOY_DB}];
END`;
            await enterTextIntoQueryEditor(vsCodePage, cleanup);
            await executeQuery(vsCodePage);
            await new Promise((resolve) => setTimeout(resolve, 5 * 1000));
        },
    });

    test("DACPAC dialog opens from command palette with all operation types", async ({}, testInfo) => {
        const { page: vsCodePage } = getContext();

        const iframe = await openDacpacDialog(vsCodePage);
        await screenshot(vsCodePage, testInfo, "dacpac-dialog-opened");

        // All four operation radio buttons must be present
        await expect(iframe.getByRole("radio", { name: "Publish DACPAC" })).toBeVisible({
            timeout: 10 * 1000,
        });
        await expect(iframe.getByRole("radio", { name: "Extract DACPAC" })).toBeVisible();
        await expect(iframe.getByRole("radio", { name: "Import BACPAC" })).toBeVisible();
        await expect(iframe.getByRole("radio", { name: "Export BACPAC" })).toBeVisible();

        await screenshot(vsCodePage, testInfo, "dacpac-operations-visible");

        await iframe.getByRole("button", { name: "Cancel" }).click();
        await vsCodePage.keyboard.press(`${getModifierKey()}+W`);
    });

    test("DACPAC dialog opens from Object Explorer context menu", async ({}, testInfo) => {
        const { page: vsCodePage } = getContext();

        await expandObjectExplorerNode(vsCodePage, getServerName(), 30 * 1000);
        await expandObjectExplorerNode(vsCodePage, "Databases", 20 * 1000);
        await screenshot(vsCodePage, testInfo, "oe-expanded");

        await rightClickObjectExplorerNode(vsCodePage, DACPAC_SOURCE_DB, 20 * 1000);
        await screenshot(vsCodePage, testInfo, "context-menu-visible");

        // Context menu entry label (from package.json)
        await clickContextMenuItem(vsCodePage, "Data-Tier Application File (.dacpac)");
        await screenshot(vsCodePage, testInfo, "dacpac-dialog-opening");

        const iframe = await getWebviewByTitle(vsCodePage, DACPAC_DIALOG_TITLE);
        await iframe
            .getByRole("button", { name: "Execute" })
            .first()
            .waitFor({ state: "visible", timeout: 30 * 1000 });
        await screenshot(vsCodePage, testInfo, "dacpac-dialog-loaded");

        await iframe.getByRole("button", { name: "Cancel" }).click();
        await vsCodePage.keyboard.press(`${getModifierKey()}+W`);
    });

    test("Switching operation types updates the form labels", async ({}, testInfo) => {
        const { page: vsCodePage } = getContext();

        const iframe = await openDacpacDialog(vsCodePage);

        // Default: Deploy — "Package file" label shown
        await expect(iframe.getByText("Package file")).toBeVisible({ timeout: 10 * 1000 });
        await screenshot(vsCodePage, testInfo, "deploy-form-visible");

        // Extract — "Output file" label and Application Name/Version fields
        await iframe.getByRole("radio", { name: "Extract DACPAC" }).click();
        await expect(iframe.getByText("Output file")).toBeVisible({ timeout: 10 * 1000 });
        await expect(iframe.getByText("Application Name")).toBeVisible({ timeout: 10 * 1000 });
        await expect(iframe.getByText("Application Version")).toBeVisible({ timeout: 10 * 1000 });
        await screenshot(vsCodePage, testInfo, "extract-form-visible");

        // Import — "Package file" again (for .bacpac input)
        await iframe.getByRole("radio", { name: "Import BACPAC" }).click();
        await expect(iframe.getByText("Package file")).toBeVisible({ timeout: 10 * 1000 });
        await screenshot(vsCodePage, testInfo, "import-form-visible");

        // Export — "Output file" again
        await iframe.getByRole("radio", { name: "Export BACPAC" }).click();
        await expect(iframe.getByText("Output file")).toBeVisible({ timeout: 10 * 1000 });
        await screenshot(vsCodePage, testInfo, "export-form-visible");

        await iframe.getByRole("button", { name: "Cancel" }).click();
        await vsCodePage.keyboard.press(`${getModifierKey()}+W`);
    });

    test("Extract DACPAC — dialog accepts inputs and Execute becomes enabled", async ({}, testInfo) => {
        const { page: vsCodePage } = getContext();

        const iframe = await openDacpacDialog(vsCodePage);
        await screenshot(vsCodePage, testInfo, "dacpac-dialog-opened");

        // Select Extract operation
        await iframe.getByRole("radio", { name: "Extract DACPAC" }).click();
        await screenshot(vsCodePage, testInfo, "extract-selected");

        // Select server
        await selectDacpacServer(iframe, getServerName());
        await screenshot(vsCodePage, testInfo, "server-selected");

        // Select source database
        await selectDacpacDatabase(iframe, DACPAC_SOURCE_DB);
        await screenshot(vsCodePage, testInfo, "database-selected");

        // The dialog auto-suggests an output path; if not, supply one manually
        const outputInput = iframe.locator("input[placeholder*='Enter the path']");
        await outputInput.waitFor({ state: "visible", timeout: 15 * 1000 });
        const suggestedPath = await outputInput.inputValue();
        if (!suggestedPath) {
            await outputInput.fill(`/var/opt/mssql/backup/${DACPAC_SOURCE_DB}.dacpac`);
        }
        await screenshot(vsCodePage, testInfo, "output-path-set");

        // Execute button should now be enabled
        const executeButton = iframe.getByRole("button", { name: "Execute" }).first();
        await expect(executeButton).toBeEnabled({ timeout: 15 * 1000 });
        await screenshot(vsCodePage, testInfo, "execute-enabled");

        // Perform the extraction and wait for it to complete
        await executeButton.click();
        await screenshot(vsCodePage, testInfo, "extract-started");

        // On completion the Execute button re-enables (spinner gone)
        await expect(executeButton).toBeEnabled({ timeout: 10 * 60 * 1000 });
        await screenshot(vsCodePage, testInfo, "extract-completed");

        await vsCodePage.keyboard.press(`${getModifierKey()}+W`);
    });

    test("Deploy DACPAC — extract then deploy to new database", async ({}, testInfo) => {
        const { page: vsCodePage } = getContext();
        const dacpacPath = `/var/opt/mssql/backup/${DACPAC_SOURCE_DB}_deploy_test.dacpac`;

        // --- Step 1: Extract ---
        const extractIframe = await openDacpacDialog(vsCodePage);
        await extractIframe.getByRole("radio", { name: "Extract DACPAC" }).click();
        await selectDacpacServer(extractIframe, getServerName());
        await selectDacpacDatabase(extractIframe, DACPAC_SOURCE_DB);

        const outputInput = extractIframe.locator("input[placeholder*='Enter the path']");
        await outputInput.waitFor({ state: "visible", timeout: 15 * 1000 });
        await outputInput.fill(dacpacPath);
        await screenshot(vsCodePage, testInfo, "extract-dialog-filled");

        const extractExecute = extractIframe.getByRole("button", { name: "Execute" }).first();
        await expect(extractExecute).toBeEnabled({ timeout: 15 * 1000 });
        await extractExecute.click();
        await expect(extractExecute).toBeEnabled({ timeout: 10 * 60 * 1000 });
        await screenshot(vsCodePage, testInfo, "dacpac-extracted");
        await vsCodePage.keyboard.press(`${getModifierKey()}+W`);

        // --- Step 2: Deploy ---
        const deployIframe = await openDacpacDialog(vsCodePage);
        // "Publish DACPAC" is the default
        await screenshot(vsCodePage, testInfo, "deploy-dialog-opened");

        await selectDacpacServer(deployIframe, getServerName());
        await screenshot(vsCodePage, testInfo, "deploy-server-selected");

        // Set the .dacpac file path
        const packageInput = deployIframe.locator("input[placeholder*='Select package file']");
        await packageInput.waitFor({ state: "visible", timeout: 15 * 1000 });
        await packageInput.fill(dacpacPath);
        await screenshot(vsCodePage, testInfo, "deploy-file-path-set");

        // Set the new target database name
        const dbNameInput = deployIframe.locator("input[placeholder*='Enter database name']");
        await dbNameInput.waitFor({ state: "visible", timeout: 15 * 1000 });
        await dbNameInput.fill(DACPAC_DEPLOY_DB);
        await screenshot(vsCodePage, testInfo, "deploy-db-name-set");

        const deployExecute = deployIframe.getByRole("button", { name: "Execute" }).first();
        await expect(deployExecute).toBeEnabled({ timeout: 15 * 1000 });
        await deployExecute.click();
        await screenshot(vsCodePage, testInfo, "deploy-started");

        await expect(deployExecute).toBeEnabled({ timeout: 10 * 60 * 1000 });
        await screenshot(vsCodePage, testInfo, "deploy-completed");

        // --- Step 3: Verify deployed DB has the correct schema ---
        await openNewQueryEditor(vsCodePage);
        const verifyScript = `
SELECT
    OBJECT_ID(N'[${DACPAC_DEPLOY_DB}].[dbo].[Customers]') AS customers_id,
    OBJECT_ID(N'[${DACPAC_DEPLOY_DB}].[dbo].[Orders]')    AS orders_id;`;
        await enterTextIntoQueryEditor(vsCodePage, verifyScript);
        await executeQuery(vsCodePage);
        await screenshot(vsCodePage, testInfo, "deploy-db-verified");

        // Both object IDs should be non-NULL (tables exist)
        const nullValues = vsCodePage.getByText("NULL");
        expect(await nullValues.count()).toBe(0);

        await vsCodePage.keyboard.press(`${getModifierKey()}+W`);
    });
});
