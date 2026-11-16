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
    getObjectExplorerNode,
    getActiveEditorText,
    getSeededConnectionProfile,
    getSeededLaunchConfig,
    runObjectExplorerContextAction,
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

    // Failed in the Linux CI build-and-test smoke run: clicking the history tree item timed out, likely because it was obscured.
    // TODO: Stabilize this test, then remove its @quarantine tag.
    test(
        "Open shows the history item's query in an editor",
        { ...testCases(5878845), tag: "@quarantine" },
        async () => {
            const { page } = getContext();
            // Untitled editors are named after their first line, so this counts editors on the query.
            const queryEditorTabs = page.getByRole("tab", { name: /SELECT DB_NAME\(\)/ });
            const tabsBefore = await queryEditorTabs.count();

            await runHistoryItemAction(page, "Open Query");

            await expect(queryEditorTabs).toHaveCount(tabsBefore + 1);
            await expect.poll(() => getActiveEditorText(page)).toContain(marker);
            expect(await getActiveEditorText(page)).toContain("SELECT DB_NAME() AS database_name");
        },
    );

    // Failed in the Linux CI build-and-test smoke run: the connection quick pick row resolved but stayed hidden.
    // TODO: Stabilize this test, then remove its @quarantine tag.
    test(
        "Run reconnects to the original database and executes the query",
        { ...testCases(5878846), tag: "@quarantine" },
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

    // Failed in the Linux CI build-and-test smoke run: clicking the history tree item timed out, likely because it was obscured.
    // TODO: Stabilize this test, then remove its @quarantine tag.
    test(
        "Delete removes the history item",
        { ...testCases(5878844), tag: "@quarantine" },
        async () => {
            const { page } = getContext();
            const countBefore = await getHistoryItems(page).count();
            expect(countBefore).toBeGreaterThan(0);

            await runHistoryItemAction(page, "Delete");

            await expect(getHistoryItems(page)).toHaveCount(countBefore - 1);
        },
    );
});

/**
 * Pausing and resuming query history capture, and clearing the history, from the Query History
 * view's title bar and from the command palette.
 */
test.describe("MSSQL Extension - Query History capture and clearing", () => {
    const PAUSE = "Pause Query History Capture";
    const START = "Start Query History Capture";
    const CLEAR_ALL = "Clear All Query History";

    const getContext = useSharedVsCodeLifecycle({
        launchOptions: {
            initialConfig: getSeededLaunchConfig({
                "mssql.enableQueryHistoryFeature": true,
                "mssql.enableQueryHistoryCapture": true,
            }),
        },
    });

    function getPane(page: Page): Locator {
        return page.locator(".pane").filter({
            has: page.getByRole("heading", { name: "Query History", exact: true }),
        });
    }

    function getHistoryItems(page: Page, marker: string): Locator {
        return getPane(page).getByRole("treeitem", { name: new RegExp(marker) });
    }

    /** A view title action; title actions are only rendered while the header is hovered. */
    async function clickTitleAction(page: Page, name: string): Promise<void> {
        const pane = getPane(page);
        await pane.getByRole("heading", { name: "Query History", exact: true }).hover();
        await pane.getByRole("button", { name, exact: true }).click();
    }

    async function runCommand(page: Page, title: string): Promise<void> {
        await new QuickInput(page).runCommand(`MS SQL: ${title}`, `MS SQL: ${title}`);
    }

    async function expectCaptureState(page: Page, capturing: boolean): Promise<void> {
        const pane = getPane(page);
        await pane.getByRole("heading", { name: "Query History", exact: true }).hover();
        await expect(
            pane.getByRole("button", { name: capturing ? PAUSE : START, exact: true }),
        ).toBeVisible();
        await expect(
            pane.getByRole("button", { name: capturing ? START : PAUSE, exact: true }),
        ).toHaveCount(0);
    }

    /** Opens an editor already connected to the server through its New Query action. */
    async function runMarkerQuery(page: Page, marker: string): Promise<void> {
        await runObjectExplorerContextAction(
            page,
            getObjectExplorerNode(page, SEEDED_PROFILE_NAME),
            "New Query",
        );
        await waitForConnected(page, getServerName());
        await setQueryText(undefined as never, page, `SELECT '${marker}' AS marker;`);
        await executeQueryAndWait(page);
    }

    function uniqueMarker(prefix: string): string {
        return `${prefix}_${Date.now().toString(36)}${Math.floor(performance.now())}`;
    }

    /**
     * Runs a query while capture is paused and another after resuming. The second query is
     * captured, so by the time it shows up the first would have too, had it been captured.
     */
    async function expectPauseAndResume(
        page: Page,
        pause: () => Promise<void>,
        resume: () => Promise<void>,
    ): Promise<void> {
        await expectCaptureState(page, true);
        await pause();
        await expectCaptureState(page, false);
        const whilePaused = uniqueMarker("paused");
        await runMarkerQuery(page, whilePaused);

        await resume();
        await expectCaptureState(page, true);
        const afterResume = uniqueMarker("resumed");
        await runMarkerQuery(page, afterResume);

        await expect(getHistoryItems(page, afterResume)).toHaveCount(1, { timeout: 30 * 1000 });
        await expect(getHistoryItems(page, whilePaused)).toHaveCount(0);
    }

    async function expectClearAll(page: Page, clearAll: () => Promise<void>): Promise<void> {
        const marker = uniqueMarker("clear");
        await runMarkerQuery(page, marker);
        await expect(getHistoryItems(page, marker)).toHaveCount(1, { timeout: 30 * 1000 });

        await clearAll();
        await expect(getHistoryItems(page, marker)).toHaveCount(0);
        await expect(
            getPane(page).getByRole("treeitem", { name: "No Queries Available" }),
        ).toBeVisible();
    }

    // Flaky in the Linux CI build-and-test smoke run (passed on retry): the status bar did not show the expected connection text in time.
    // TODO: Stabilize this test, then remove its @quarantine tag.
    test(
        "pausing and resuming from the view title stops and restarts capture",
        { ...testCases(5878842), tag: "@quarantine" },
        async () => {
            const { page } = getContext();
            await expectPauseAndResume(
                page,
                () => clickTitleAction(page, PAUSE),
                () => clickTitleAction(page, START),
            );
        },
    );

    // Flaky in the Linux CI build-and-test smoke run (passed on retry): hovering the Query History heading timed out.
    // TODO: Stabilize this test, then remove its @quarantine tag.
    test(
        "pausing and resuming from the command palette stops and restarts capture",
        { ...testCases(5878842), tag: "@quarantine" },
        async () => {
            const { page } = getContext();
            await expectPauseAndResume(
                page,
                () => runCommand(page, PAUSE),
                () => runCommand(page, START),
            );
        },
    );

    // Failed in the Linux CI build-and-test smoke run: clicking the e2e-server Connections node timed out because it was obscured.
    // TODO: Stabilize this test, then remove its @quarantine tag.
    test(
        "Clear All from the view title's More Actions menu removes every item",
        { ...testCases(5878843), tag: "@quarantine" },
        async () => {
            const { page } = getContext();
            await expectClearAll(page, async () => {
                const pane = getPane(page);
                await pane.getByRole("heading", { name: "Query History", exact: true }).hover();
                await pane.getByRole("button", { name: /^More Actions/ }).click();
                await clickContextMenuItem(page, CLEAR_ALL);
            });
        },
    );

    // Failed in the Linux CI build-and-test smoke run: an expected element was not found.
    // TODO: Stabilize this test, then remove its @quarantine tag.
    test(
        "Clear All from the command palette removes every item",
        { ...testCases(5878843), tag: "@quarantine" },
        async () => {
            const { page } = getContext();
            await expectClearAll(page, () => runCommand(page, CLEAR_ALL));
        },
    );
});
