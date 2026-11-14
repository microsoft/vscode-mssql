/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Locator, Page } from "@playwright/test";
import { test, expect } from "./baseFixtures";
import { useSharedVsCodeLifecycle } from "./utils/testLifecycle";
import {
    clickContextMenuItem,
    connectActiveEditor,
    getActiveEditorText,
    getSeededConnectionProfile,
    getSeededLaunchConfig,
    SEEDED_PROFILE_NAME,
} from "./utils/seededConnection";
import { dropDatabaseIfExists, recreateDatabase, uniqueDatabaseName } from "./utils/sqlClient";
import {
    executeQueryAndWait,
    getWebviewByTitle,
    openNewQueryEditor,
    pickQuickInputItem,
    setQueryText,
    waitForConnected,
    waitForResultGrid,
} from "./utils/testHelpers";
import { QuickInput, VsCodeCommand } from "./pageObjects";
import { getServerName } from "./utils/envConfigReader";
import { getCell } from "./grid/gridActions";
import { testCases } from "./utils/testCases";

const HISTORY_PROFILE_NAME = "e2e-query-history";

/**
 * Query History view actions: opening, re-running, and deleting a captured query. The query is
 * captured against a dedicated database, so re-running it proves the history item reconnects to
 * the database it originally ran on rather than to whatever the active editor uses.
 */
test.describe("MSSQL Extension - Query History", () => {
    const databaseName = uniqueDatabaseName("E2E_QueryHistory");
    const marker = `qh_${Date.now().toString(36)}`;
    const historyQuery = `SELECT DB_NAME() AS database_name, '${marker}' AS marker`;

    const getContext = useSharedVsCodeLifecycle({
        launchOptions: {
            initialConfig: getSeededLaunchConfig({
                "mssql.enableQueryHistoryFeature": true,
                "mssql.enableQueryHistoryCapture": true,
                "mssql.connections": [
                    getSeededConnectionProfile(),
                    getSeededConnectionProfile(HISTORY_PROFILE_NAME, databaseName),
                ],
            }),
        },
        afterLaunch: async ({ electronApp, page }) => {
            await recreateDatabase(databaseName);
            await openNewQueryEditor(page);
            await connectActiveEditor(page, HISTORY_PROFILE_NAME);
            await setQueryText(electronApp, page, historyQuery);
            await executeQueryAndWait(page);
        },
    });

    test.afterAll(async () => {
        await dropDatabaseIfExists(databaseName);
    });

    function getHistoryPane(page: Page): Locator {
        return page.locator(".pane").filter({
            has: page.getByRole("heading", { name: "Query History", exact: true }),
        });
    }

    function getHistoryItems(page: Page): Locator {
        return getHistoryPane(page).getByRole("treeitem", { name: new RegExp(marker) });
    }

    async function runHistoryItemAction(page: Page, menuLabel: string): Promise<void> {
        const item = getHistoryItems(page).first();
        await expect(item).toBeVisible({ timeout: 30 * 1000 });
        await item.click({ button: "right" });
        await clickContextMenuItem(page, menuLabel);
    }

    test("Open shows the history item's query in an editor", testCases(5878845), async () => {
        const { page } = getContext();
        // Untitled editors are named after their first line, so this counts editors on the query.
        const queryEditorTabs = page.getByRole("tab", { name: /SELECT DB_NAME\(\)/ });
        const tabsBefore = await queryEditorTabs.count();

        await runHistoryItemAction(page, "Open Query");

        await expect(queryEditorTabs).toHaveCount(tabsBefore + 1);
        await expect.poll(() => getActiveEditorText(page)).toContain(marker);
        expect(await getActiveEditorText(page)).toContain("SELECT DB_NAME() AS database_name");
    });

    test(
        "Run reconnects to the original database and executes the query",
        testCases(5878846),
        async () => {
            const { page } = getContext();
            // Start from an editor on another database, so the result proves the reconnect.
            await openNewQueryEditor(page);
            await new QuickInput(page).run(VsCodeCommand.mssqlChangeConnection);
            await pickQuickInputItem(page, SEEDED_PROFILE_NAME);
            await waitForConnected(page, getServerName());

            await runHistoryItemAction(page, "Run Query");

            const resultsFrame = await getWebviewByTitle(page, "Query Results");
            await expect
                .poll(
                    async () => {
                        const grid = await waitForResultGrid(resultsFrame);
                        return getCell(grid, 0, 1).innerText();
                    },
                    { timeout: 60 * 1000 },
                )
                .toBe(marker);
            const grid = await waitForResultGrid(resultsFrame);
            await expect(getCell(grid, 0, 0)).toHaveText(databaseName);
        },
    );

    test("Delete removes the history item", testCases(5878844), async () => {
        const { page } = getContext();
        const countBefore = await getHistoryItems(page).count();
        expect(countBefore).toBeGreaterThan(0);

        await runHistoryItemAction(page, "Delete");

        await expect(getHistoryItems(page)).toHaveCount(countBefore - 1);
    });
});
