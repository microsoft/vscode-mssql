/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { FrameLocator, Page } from "@playwright/test";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { expect, test } from "./baseFixtures";
import { QuickInput } from "./pageObjects/quickInput";
import {
    answerSimpleSaveDialog,
    applyCategoryFilter,
    applyContainsFilter,
    clearAllFilters,
    dropEventSessionIfExists,
    getColumnHeader,
    getEventsGrid,
    getProfilerTitle,
    isEventSessionRunning,
    LAUNCH_PROFILER_MENU_LABEL,
    launchProfilerFromNode,
    PROFILER_TIMEOUT_MS,
    ProfilerGridRow,
    readGridRows,
    runMarkerBatches,
    setQuickFilter,
    submitSessionName,
    waitForGridRows,
    waitForRunningProfiler,
} from "./utils/profilerHelpers";
import {
    expandObjectExplorerNode,
    expandObjectExplorerPath,
    getActiveEditorText,
    getSeededLaunchConfig,
    runObjectExplorerContextAction,
    SEEDED_PROFILE_NAME,
    waitForActiveEditorTab,
} from "./utils/seededConnection";
import { dropDatabaseIfExists, recreateDatabase, uniqueDatabaseName } from "./utils/sqlClient";
import { testCases } from "./utils/testCases";
import {
    clearClipboard,
    getStatusBar,
    readClipboard,
    withClipboardLock,
} from "./utils/testHelpers";
import { useSharedVsCodeLifecycle, VsCodeLaunchContext } from "./utils/testLifecycle";

/**
 * Query Profiler suite: launches XEvent profiling sessions from the Object Explorer context menu
 * and checks live event streaming, column filters and sorting, the event details panel, several
 * concurrent sessions, and CSV export.
 *
 * XEvent sessions are server-wide and the shared e2e server is busy with other suites, so every
 * query this suite runs carries a unique marker and the grid is filtered to that marker before
 * anything is asserted. Each test produces the events it checks, because the session's ring
 * buffer can evict older events on a busy server.
 */
test.describe("MSSQL Extension - Query Profiler", () => {
    test.describe.configure({ mode: "serial" });

    const runId = Date.now().toString(36);
    const marker = `e2eprof${runId}`;
    const serverSessionName = `e2e_prof_server_${runId}`;
    const databaseSessionName = `e2e_prof_db_${runId}`;
    const databaseName = uniqueDatabaseName("ProfilerE2E");
    let context: VsCodeLaunchContext;
    let page: Page;
    let serverProfiler: FrameLocator;
    let databaseProfiler: FrameLocator;
    let exportDir: string;

    test.beforeAll(async () => {
        await recreateDatabase(databaseName);
        exportDir = fs.mkdtempSync(path.join(os.tmpdir(), "mssql-e2e-profiler-"));
    });

    useSharedVsCodeLifecycle({
        launchOptions: { initialConfig: getSeededLaunchConfig() },
        afterLaunch: async (launched) => {
            context = launched;
            page = launched.page;
        },
    });

    test.afterAll(async () => {
        for (const sessionName of [serverSessionName, databaseSessionName]) {
            await dropEventSessionIfExists(sessionName);
        }
        await dropDatabaseIfExists(databaseName);
        if (exportDir) {
            fs.rmSync(exportDir, { recursive: true, force: true });
        }
    });

    /** Brings a profiler tab to the front. */
    async function focusProfilerTab(sessionName: string): Promise<void> {
        await page.getByRole("tab", { name: new RegExp(getProfilerTitle(sessionName)) }).click();
        await waitForActiveEditorTab(page, getProfilerTitle(sessionName));
    }

    /** Whether values are in ascending, descending, or neither order. */
    function sortDirection(values: string[]): "ascending" | "descending" | "none" {
        const pairs = values.slice(1).map((value, index) => value.localeCompare(values[index]));
        if (pairs.every((comparison) => comparison >= 0)) {
            return "ascending";
        }
        return pairs.every((comparison) => comparison <= 0) ? "descending" : "none";
    }

    /** Escapes text for use inside a regular expression. */
    function escapeRegExp(value: string): string {
        return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    }

    /** Rows whose TextData contains `text`. */
    function rowsWithText(rows: ProfilerGridRow[], text: string): ProfilerGridRow[] {
        return rows.filter((row) => row.TextData.includes(text));
    }

    test(
        "Launch Query Profiler from the server context menu with a template and session name",
        testCases(5878903),
        async () => {
            const serverNode = await expandObjectExplorerNode(page, SEEDED_PROFILE_NAME);
            await runObjectExplorerContextAction(page, serverNode, LAUNCH_PROFILER_MENU_LABEL);

            const quickInput = new QuickInput(page);
            await expect(quickInput.widget).toContainText("New Query Profiler - Select Template", {
                timeout: PROFILER_TIMEOUT_MS,
            });
            await expect
                .poll(() => quickInput.labels())
                .toEqual(["Standard_OnPrem", "TSQL_OnPrem", "TSQL_Locks", "TSQL_Duration"]);
            await quickInput.pick("TSQL_OnPrem");

            // The name defaults to the template name until the user replaces it.
            await expect(quickInput.input).toHaveValue("TSQL_OnPrem");
            await submitSessionName(page, serverSessionName);

            serverProfiler = await waitForRunningProfiler(page, serverSessionName);
            await expect(
                serverProfiler.getByRole("combobox", { name: "Select session" }),
            ).toHaveText(serverSessionName);
            await expect(serverProfiler.getByRole("combobox", { name: "View:" })).toHaveText(
                "TSQL View",
            );
            await expect(serverProfiler.getByRole("button", { name: "Stop" })).toBeEnabled();
            await expect(serverProfiler.getByRole("button", { name: "Start" })).toBeDisabled();
            await expect(getStatusBar(page)).toContainText(`${serverSessionName} Running`);
            await expect.poll(() => isEventSessionRunning(serverSessionName)).toBe(true);
        },
    );

    test(
        "Queries run against the server stream into the events grid",
        testCases(5878905),
        async () => {
            const grid = getEventsGrid(serverProfiler);
            await expect(getColumnHeader(serverProfiler, "EventClass")).toBeVisible();
            await expect(getColumnHeader(serverProfiler, "TextData")).toBeVisible();

            const streamMarker = `${marker}_stream`;
            await setQuickFilter(serverProfiler, streamMarker);
            // The status bar reports filtered/total counts; nothing matches before the batch runs.
            await expect(getStatusBar(page)).toContainText(
                new RegExp(`${serverSessionName}\\s+Running \\| 0/\\d+ events`),
            );

            await runMarkerBatches(databaseName, `SELECT '${streamMarker}' AS marker;`);

            const rows = await waitForGridRows(
                serverProfiler,
                (current) => {
                    const markerRows = rowsWithText(current, streamMarker);
                    return (
                        markerRows.some((row) => row.EventClass === "sql_batch_starting") &&
                        markerRows.some((row) => row.EventClass === "sql_batch_completed")
                    );
                },
                "The marker batch's starting and completed events never reached the grid.",
            );
            for (const row of rowsWithText(rows, streamMarker)) {
                expect(row.DatabaseName).toBe(databaseName);
            }
            await expect(grid.getByRole("gridcell", { name: databaseName }).first()).toBeVisible();
            await expect(getStatusBar(page)).toContainText(
                new RegExp(`${serverSessionName}\\s+Running \\| [1-9]\\d*/\\d+ events`),
            );

            await clearAllFilters(serverProfiler);
        },
    );

    test(
        "Events can be filtered and sorted, and both can be cleared",
        testCases(5878906),
        async () => {
            const sortMarker = `${marker}_sort`;
            // Run out of order so the natural (arrival) order differs from both sort orders.
            const arrivalOrder = ["2", "3", "1"].map((suffix) => `${sortMarker}_${suffix}`);
            await runMarkerBatches(
                databaseName,
                ...arrivalOrder.map((text) => `SELECT '${text}' AS marker;`),
            );

            // Every event is listed in arrival order; the marker identifies which batch it is from.
            const batchOf = (row: ProfilerGridRow) =>
                arrivalOrder.find((text) => row.TextData.includes(text)) ?? "";
            const eventKinds = (rows: ProfilerGridRow[]) =>
                [...new Set(rows.map((row) => `${row.EventClass} ${batchOf(row)}`))].sort();
            const batchOrder = async () => {
                const batches = (await readGridRows(serverProfiler)).map(batchOf);
                return { batches: [...new Set(batches)], direction: sortDirection(batches) };
            };

            // Column filters combine: TextData contains the marker AND EventClass is completed.
            await applyContainsFilter(serverProfiler, "TextData", sortMarker);
            const allKinds = arrivalOrder.flatMap((text) => [
                `sql_batch_completed ${text}`,
                `sql_batch_starting ${text}`,
            ]);
            await waitForGridRows(
                serverProfiler,
                (rows) => JSON.stringify(eventKinds(rows)) === JSON.stringify([...allKinds].sort()),
                "Expected a starting and a completed event for each marker batch.",
            );
            await applyCategoryFilter(serverProfiler, "EventClass", "sql_batch_completed");
            const completedRows = await waitForGridRows(
                serverProfiler,
                (current) => current.every((row) => row.EventClass === "sql_batch_completed"),
                "The EventClass filter left other event classes in the grid.",
            );
            expect(eventKinds(completedRows)).toEqual(
                [...arrivalOrder].sort().map((text) => `sql_batch_completed ${text}`),
            );
            await expect(
                serverProfiler.getByRole("button", { name: "Remove filter for TextData" }),
            ).toBeVisible();
            await expect(
                serverProfiler.getByRole("button", { name: "Remove filter for EventClass" }),
            ).toBeVisible();

            await expect.poll(batchOrder).toEqual({ batches: arrivalOrder, direction: "none" });

            // Sorting cycles ascending -> descending -> natural (arrival) order.
            const sortButton = getColumnHeader(serverProfiler, "TextData").getByRole("button", {
                name: "Sort column",
            });
            const ascending = [...arrivalOrder].sort();
            await sortButton.click();
            await expect.poll(batchOrder).toEqual({ batches: ascending, direction: "ascending" });
            await sortButton.click();
            await expect
                .poll(batchOrder)
                .toEqual({ batches: [...ascending].reverse(), direction: "descending" });
            await sortButton.click();
            await expect.poll(batchOrder).toEqual({ batches: arrivalOrder, direction: "none" });

            // Removing one column filter brings back the starting events for the marker batches.
            await serverProfiler
                .getByRole("button", { name: "Remove filter for EventClass" })
                .click();
            await waitForGridRows(
                serverProfiler,
                (current) =>
                    JSON.stringify(eventKinds(current)) === JSON.stringify([...allKinds].sort()),
                "Removing the EventClass filter did not restore the starting events.",
            );

            // The quick filter narrows the remaining column filter further.
            const firstBatch = `${sortMarker}_1`;
            await setQuickFilter(serverProfiler, firstBatch);
            const rows = await waitForGridRows(
                serverProfiler,
                (current) => current.every((row) => batchOf(row) === firstBatch),
                "The quick filter did not combine with the column filters.",
            );
            expect(eventKinds(rows)).toEqual([
                `sql_batch_completed ${firstBatch}`,
                `sql_batch_starting ${firstBatch}`,
            ]);

            // Clearing everything shows events that never matched the marker.
            await clearAllFilters(serverProfiler);
            await expect(
                serverProfiler.getByRole("button", { name: /^Remove filter for/ }),
            ).toHaveCount(0);
            await waitForGridRows(
                serverProfiler,
                (current) => current.some((row) => !row.TextData.includes(sortMarker)),
                "Clearing the filters did not bring back the unfiltered events.",
            );
        },
    );

    test(
        "Selecting an event shows its text and details, and Copy and Open in Editor work",
        testCases(5878909),
        async () => {
            const detailsMarker = `${marker}_details`;
            const batchText = `SELECT '${detailsMarker}' AS marker;`;
            await runMarkerBatches(databaseName, batchText);
            await setQuickFilter(serverProfiler, detailsMarker);
            await waitForGridRows(
                serverProfiler,
                (rows) =>
                    rowsWithText(rows, detailsMarker).some(
                        (row) => row.EventClass === "sql_batch_completed",
                    ),
                "The details marker batch never reached the grid.",
            );

            await getEventsGrid(serverProfiler)
                .getByRole("row", {
                    name: new RegExp(`^sql_batch_completed\\s+${escapeRegExp(batchText)}`),
                })
                .first()
                .getByRole("gridcell", { name: batchText, exact: true })
                .click();
            const details = serverProfiler.getByRole("region", {
                name: "Event details for sql_batch_completed",
            });
            await expect(details).toBeVisible();

            // Text tab: the batch text in a read-only editor.
            await expect(details.getByRole("tab", { name: /^Text tab/ })).toHaveAttribute(
                "aria-selected",
                "true",
            );
            await expect(
                details.getByRole("region", { name: "Read-only SQL text editor" }),
            ).toContainText(detailsMarker);

            // Details tab: every event property, including the batch text and database.
            await details.getByRole("tab", { name: /^Details tab/ }).click();
            const properties = details.getByRole("group", { name: "Event properties list" });
            for (const [property, value] of [
                ["Event Class", "sql_batch_completed"],
                ["Text Data", batchText],
                ["Database", databaseName],
            ]) {
                await expect(
                    properties.getByRole("row", {
                        name: new RegExp(`^${property}\\s+${escapeRegExp(value)}$`),
                    }),
                ).toBeVisible();
            }

            await details.getByRole("tab", { name: /^Text tab/ }).click();
            await withClipboardLock(async () => {
                await clearClipboard(context.electronApp);
                await details.getByRole("button", { name: "Copy", exact: true }).click();
                await expect.poll(() => readClipboard(context.electronApp)).toBe(batchText);
            });

            await details.getByRole("button", { name: "Open in Editor" }).click();
            await waitForActiveEditorTab(page, /Untitled-\d+/);
            await expect.poll(() => getActiveEditorText(page)).toContain(detailsMarker);

            await focusProfilerTab(serverSessionName);
            await details.getByRole("button", { name: "Close", exact: true }).click();
            await expect(details).toBeHidden();
            await clearAllFilters(serverProfiler);
        },
    );

    test(
        "Several sessions run side by side and each shows its own events",
        testCases(5878907),
        async () => {
            const databaseNode = await expandObjectExplorerPath(
                page,
                [SEEDED_PROFILE_NAME, "Databases", databaseName],
                { expandLast: false },
            );
            databaseProfiler = await launchProfilerFromNode(
                page,
                databaseNode,
                "Standard_OnPrem",
                databaseSessionName,
            );
            // Launching from a database scopes the new session's grid to that database.
            await expect(
                databaseProfiler.getByRole("button", { name: "Remove filter for DatabaseName" }),
            ).toBeVisible();
            await expect(databaseProfiler.getByRole("combobox", { name: "View:" })).toHaveText(
                "Standard View",
            );
            await expect.poll(() => isEventSessionRunning(databaseSessionName)).toBe(true);
            await expect.poll(() => isEventSessionRunning(serverSessionName)).toBe(true);

            // Both sessions capture the same batch.
            const sharedMarker = `${marker}_multi_both`;
            await runMarkerBatches(databaseName, `SELECT '${sharedMarker}' AS marker;`);
            await setQuickFilter(databaseProfiler, sharedMarker);
            await waitForGridRows(
                databaseProfiler,
                (rows) => rowsWithText(rows, sharedMarker).length > 0,
                "The database session did not capture the shared batch.",
            );

            await focusProfilerTab(serverSessionName);
            await setQuickFilter(serverProfiler, `${marker}_multi`);
            await waitForGridRows(
                serverProfiler,
                (rows) => rowsWithText(rows, sharedMarker).length > 0,
                "The server session did not capture the shared batch.",
            );

            // Stopping one session leaves the other running.
            await serverProfiler.getByRole("button", { name: "Stop" }).click();
            await expect(serverProfiler.getByRole("button", { name: "Start" })).toBeEnabled({
                timeout: PROFILER_TIMEOUT_MS,
            });
            await expect(getStatusBar(page)).toContainText(`${serverSessionName} Stopped`);
            await expect.poll(() => isEventSessionRunning(serverSessionName)).toBe(false);
            await expect.poll(() => isEventSessionRunning(databaseSessionName)).toBe(true);

            const afterStopMarker = `${marker}_multi_after_stop`;
            await runMarkerBatches(databaseName, `SELECT '${afterStopMarker}' AS marker;`);

            await focusProfilerTab(databaseSessionName);
            await setQuickFilter(databaseProfiler, afterStopMarker);
            await waitForGridRows(
                databaseProfiler,
                (rows) => rowsWithText(rows, afterStopMarker).length > 0,
                "The running session missed a batch after the other session stopped.",
            );

            await focusProfilerTab(serverSessionName);
            const serverRows = await readGridRows(serverProfiler);
            expect(rowsWithText(serverRows, sharedMarker).length).toBeGreaterThan(0);
            expect(rowsWithText(serverRows, afterStopMarker)).toHaveLength(0);
            await clearAllFilters(serverProfiler);
        },
    );

    test("Export to CSV writes the session's events", testCases(5878908), async () => {
        await focusProfilerTab(databaseSessionName);
        await clearAllFilters(databaseProfiler);
        const exportMarker = `${marker}_export`;
        await runMarkerBatches(databaseName, `SELECT '${exportMarker}' AS marker;`);
        await setQuickFilter(databaseProfiler, exportMarker);
        await waitForGridRows(
            databaseProfiler,
            (rows) => rowsWithText(rows, exportMarker).length > 0,
            "The export marker batch never reached the grid.",
        );

        const csvPath = path.join(exportDir, `${databaseSessionName}.csv`);
        await databaseProfiler.getByRole("button", { name: "Export to CSV" }).click();
        await answerSimpleSaveDialog(page, csvPath);

        await expect
            .poll(() => (fs.existsSync(csvPath) ? fs.readFileSync(csvPath, "utf8") : ""), {
                timeout: PROFILER_TIMEOUT_MS,
                message: `${csvPath} was not written.`,
            })
            .toContain(exportMarker);
        const [header, ...lines] = fs.readFileSync(csvPath, "utf8").split(/\r?\n/);
        expect(header).toContain("EventClass");
        expect(header).toContain("TextData");
        expect(header).toContain("DatabaseName");
        const exportLines = lines.filter((line) => line.includes(exportMarker));
        expect(exportLines.some((line) => line.includes("sql_batch_completed"))).toBe(true);
        expect(exportLines.every((line) => line.includes(databaseName))).toBe(true);
    });
});
