/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * E2E tests for Object Explorer interactions:
 *  - Expand the server node to see child nodes
 *  - Expand a database to see its folders (Tables, Views, etc.)
 *  - Expand the Tables folder and verify a known table appears
 *  - Search Database Objects webview: open, enter a search term, verify results
 *
 * Complexity: Easy–Medium
 */

import { screenshot } from "./utils/screenshotUtils";
import {
    addDatabaseConnection,
    enterTextIntoQueryEditor,
    executeQuery,
    getWebviewByTitle,
    openNewQueryEditor,
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
    waitForObjectExplorerNode,
} from "./utils/objectExplorerHelpers";

const OE_TEST_DB = "E2EOETestDB";
const OE_TEST_TABLE = "OETestTable";

test.describe("MSSQL Extension - Object Explorer", async () => {
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

            // Create a test database with a known table so we can verify tree contents
            await openNewQueryEditor(vsCodePage);
            const setup = `
USE master;
IF DB_ID(N'${OE_TEST_DB}') IS NOT NULL
BEGIN
    ALTER DATABASE [${OE_TEST_DB}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE;
    DROP DATABASE [${OE_TEST_DB}];
END
CREATE DATABASE [${OE_TEST_DB}];
USE [${OE_TEST_DB}];
CREATE TABLE [dbo].[${OE_TEST_TABLE}] (
    Id   INT NOT NULL PRIMARY KEY,
    Name NVARCHAR(100) NOT NULL
);`;
            await enterTextIntoQueryEditor(vsCodePage, setup);
            await executeQuery(vsCodePage);
            // Allow the Object Explorer time to register the new objects
            await new Promise((resolve) => setTimeout(resolve, 3 * 1000));
        },
        beforeClose: async ({ page: vsCodePage }) => {
            await openNewQueryEditor(vsCodePage);
            const cleanup = `
USE master;
IF DB_ID(N'${OE_TEST_DB}') IS NOT NULL
BEGIN
    ALTER DATABASE [${OE_TEST_DB}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE;
    DROP DATABASE [${OE_TEST_DB}];
END`;
            await enterTextIntoQueryEditor(vsCodePage, cleanup);
            await executeQuery(vsCodePage);
            await new Promise((resolve) => setTimeout(resolve, 5 * 1000));
        },
    });

    test("Server node expands to show child folders", async ({}, testInfo) => {
        const { page: vsCodePage } = getContext();

        // Ensure the SQL Server tab is active
        const sqlServerTab = vsCodePage.locator('[role="tab"][aria-label^="SQL Server"]');
        if ((await sqlServerTab.getAttribute("aria-selected")) !== "true") {
            await sqlServerTab.locator("a").click();
        }

        await screenshot(vsCodePage, testInfo, "before-expand");

        // Expand the server node — it should reveal "Databases", "Security", etc.
        const serverNode = vsCodePage
            .locator('[role="treeitem"]')
            .filter({ hasText: getServerName() })
            .first();
        await serverNode.waitFor({ state: "visible", timeout: 30 * 1000 });

        const isExpanded = await serverNode.getAttribute("aria-expanded");
        if (isExpanded !== "true") {
            await serverNode.click();
        }

        await screenshot(vsCodePage, testInfo, "server-expanded");

        // After expanding, a "Databases" child should appear
        const databasesFolder = vsCodePage
            .locator('[role="treeitem"][aria-label*="Databases"]')
            .first();
        await expect(databasesFolder).toBeVisible({ timeout: 20 * 1000 });
    });

    test("Databases folder expands to show the test database", async ({}, testInfo) => {
        const { page: vsCodePage } = getContext();

        await expandObjectExplorerNode(vsCodePage, getServerName(), 30 * 1000);
        await screenshot(vsCodePage, testInfo, "server-expanded");

        await expandObjectExplorerNode(vsCodePage, "Databases", 20 * 1000);
        await screenshot(vsCodePage, testInfo, "databases-expanded");

        // The test database should be listed
        await waitForObjectExplorerNode(vsCodePage, OE_TEST_DB, 20 * 1000);
        await screenshot(vsCodePage, testInfo, "test-db-visible");

        const dbNode = vsCodePage.locator(`[role="treeitem"][aria-label*="${OE_TEST_DB}"]`).first();
        await expect(dbNode).toBeVisible({ timeout: 15 * 1000 });
    });

    test("Database node expands to show Tables folder", async ({}, testInfo) => {
        const { page: vsCodePage } = getContext();

        await expandObjectExplorerNode(vsCodePage, getServerName(), 30 * 1000);
        await expandObjectExplorerNode(vsCodePage, "Databases", 20 * 1000);
        await expandObjectExplorerNode(vsCodePage, OE_TEST_DB, 20 * 1000);
        await screenshot(vsCodePage, testInfo, "db-expanded");

        const tablesFolder = vsCodePage.locator(`[role="treeitem"][aria-label*="Tables"]`).first();
        await expect(tablesFolder).toBeVisible({ timeout: 15 * 1000 });
        await screenshot(vsCodePage, testInfo, "tables-folder-visible");
    });

    test("Tables folder expands to show the known test table", async ({}, testInfo) => {
        const { page: vsCodePage } = getContext();

        await expandObjectExplorerNode(vsCodePage, getServerName(), 30 * 1000);
        await expandObjectExplorerNode(vsCodePage, "Databases", 20 * 1000);
        await expandObjectExplorerNode(vsCodePage, OE_TEST_DB, 20 * 1000);
        await expandObjectExplorerNode(vsCodePage, "Tables", 20 * 1000);
        await screenshot(vsCodePage, testInfo, "tables-expanded");

        // OE typically shows tables as "schema.tablename"
        const tableNode = vsCodePage
            .locator(`[role="treeitem"][aria-label*="${OE_TEST_TABLE}"]`)
            .first();
        await expect(tableNode).toBeVisible({ timeout: 20 * 1000 });
        await screenshot(vsCodePage, testInfo, "test-table-visible");
    });

    test("Search Database Objects opens and returns results", async ({}, testInfo) => {
        const { page: vsCodePage } = getContext();

        // Expand OE down to the Databases folder so the test DB node is reachable
        await expandObjectExplorerNode(vsCodePage, getServerName(), 30 * 1000);
        await expandObjectExplorerNode(vsCodePage, "Databases", 20 * 1000);
        await screenshot(vsCodePage, testInfo, "before-search-open");

        // Right-click the test database to open its context menu
        await rightClickObjectExplorerNode(vsCodePage, OE_TEST_DB, 20 * 1000);
        await screenshot(vsCodePage, testInfo, "context-menu-open");

        // Click "Search Database Objects"
        await clickContextMenuItem(vsCodePage, "Search Database Objects");
        await screenshot(vsCodePage, testInfo, "search-db-opened");

        // The Search Database Objects webview should load
        const searchIframe = await getWebviewByTitle(
            vsCodePage,
            "Search Database Objects (Preview)",
        );
        await expect(searchIframe.getByText("Search Database Objects (Preview)")).toBeVisible({
            timeout: 30 * 1000,
        });
        await screenshot(vsCodePage, testInfo, "search-page-loaded");

        // Type the table name into the search box
        const searchBox = searchIframe.locator('[placeholder*="Search by object name"]');
        await searchBox.waitFor({ state: "visible", timeout: 15 * 1000 });
        await searchBox.fill(OE_TEST_TABLE);
        await screenshot(vsCodePage, testInfo, "search-term-typed");

        // Wait for search results — the table name should appear
        await expect(searchIframe.getByText(OE_TEST_TABLE).first()).toBeVisible({
            timeout: 30 * 1000,
        });
        await screenshot(vsCodePage, testInfo, "search-results-visible");
    });
});
