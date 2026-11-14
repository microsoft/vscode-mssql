/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { FrameLocator } from "@playwright/test";
import * as fs from "fs";
import * as path from "path";
import { test, expect } from "./baseFixtures";
import { getResultsFrame } from "./grid/gridActions";
import { QuickInput } from "./pageObjects/quickInput";
import { getServerName } from "./utils/envConfigReader";
import {
    closeEditors,
    getAllResultActionButtons,
    getResultActionsButton,
    getSearchWebviewTitle,
    openDatabaseSearch,
    openResultActionsMenu,
    runResultAction,
} from "./utils/databaseSearchHelpers";
import {
    getActiveEditorText,
    getSeededLaunchConfig,
    waitForActiveEditorTab,
} from "./utils/seededConnection";
import {
    dropDatabaseIfExists,
    recreateDatabase,
    runSql,
    uniqueDatabaseName,
} from "./utils/sqlClient";
import { testCases } from "./utils/testCases";
import {
    clearClipboard,
    executeQueryAndWait,
    getWebviewByTitle,
    readClipboard,
    waitForConnected,
    waitForResultGrid,
    withClipboardLock,
} from "./utils/testHelpers";
import { useSharedVsCodeLifecycle } from "./utils/testLifecycle";

const FIXTURE_PATH = path.join(
    __dirname,
    "..",
    "resources",
    "e2e",
    "databaseSearch",
    "EventTicketSales.sql",
);

/** Rows the fixture inserts into dbo.EventTickets. */
const EVENT_TICKET_ROW_COUNT = 4;

interface SearchObject {
    caseId: number;
    typeName: string;
    name: string;
    fullName: string;
    menu: string[];
    /** Expected text of each "Script as ..." action's script. */
    scripts: Record<string, RegExp>;
}

const FUNCTION: SearchObject = {
    caseId: 5878936,
    typeName: "Function",
    name: "GetTicketRevenue",
    fullName: "dbo.GetTicketRevenue",
    menu: ["Script as Create", "Script as Drop", "Script as Alter", "Copy Object Name"],
    scripts: {
        "Script as Create": /CREATE FUNCTION \[dbo\]\.\[GetTicketRevenue\]/,
        "Script as Drop": /DROP FUNCTION \[dbo\]\.\[GetTicketRevenue\]/,
        "Script as Alter": /ALTER FUNCTION \[dbo\]\.\[GetTicketRevenue\]/,
    },
};

const STORED_PROCEDURE: SearchObject = {
    caseId: 5878937,
    typeName: "Stored Procedure",
    name: "ProcessTicketSale",
    fullName: "dbo.ProcessTicketSale",
    menu: [
        "Script as Create",
        "Script as Drop",
        "Script as Alter",
        "Script as Execute",
        "Copy Object Name",
    ],
    scripts: {
        "Script as Create": /CREATE PROCEDURE \[dbo\]\.\[ProcessTicketSale\]/,
        "Script as Drop": /DROP PROCEDURE \[dbo\]\.\[ProcessTicketSale\]/,
        "Script as Alter": /ALTER PROCEDURE \[dbo\]\.\[ProcessTicketSale\]/,
        "Script as Execute": /EXEC(UTE)?[^\n]*\[dbo\]\.\[ProcessTicketSale\]/,
    },
};

const TABLE: SearchObject = {
    caseId: 5878938,
    typeName: "Table",
    name: "EventTickets",
    fullName: "dbo.EventTickets",
    menu: [
        "Select Top 1000",
        "Script as Create",
        "Script as Drop",
        "Edit Data",
        "Modify Table",
        "Copy Object Name",
    ],
    scripts: {
        "Script as Create": /CREATE TABLE \[dbo\]\.\[EventTickets\]/,
        "Script as Drop": /DROP TABLE \[dbo\]\.\[EventTickets\]/,
    },
};

const VIEW: SearchObject = {
    caseId: 5878939,
    typeName: "View",
    name: "vw_EventTickets",
    fullName: "dbo.vw_EventTickets",
    menu: [
        "Select Top 1000",
        "Script as Create",
        "Script as Drop",
        "Script as Alter",
        "Copy Object Name",
    ],
    scripts: {
        "Script as Create": /CREATE VIEW \[dbo\]\.\[vw_EventTickets\]/,
        "Script as Drop": /DROP VIEW \[dbo\]\.\[vw_EventTickets\]/,
        "Script as Alter": /ALTER VIEW \[dbo\]\.\[vw_EventTickets\]/,
    },
};

const SEARCH_OBJECTS = [FUNCTION, STORED_PROCEDURE, TABLE, VIEW];

/**
 * Database Search suite: opening Global Database Search ("Search Database Objects...") from
 * Object Explorer, each object type's result actions, and the object type and schema filters.
 * Runs against a database seeded with one table, view, stored procedure and function in dbo.
 */
test.describe("MSSQL Extension - Database Search", () => {
    const databaseName = uniqueDatabaseName("Events");

    const getContext = useSharedVsCodeLifecycle({
        launchOptions: {
            initialConfig: getSeededLaunchConfig({
                // Sticky headers overlay tree rows and would intercept Object Explorer clicks.
                "workbench.tree.enableStickyScroll": false,
                // Save prompts for the untitled scripts are answered in the workbench's own dialog.
                "window.dialogStyle": "custom",
            }),
        },
    });

    test.beforeAll(async () => {
        await recreateDatabase(databaseName);
        await runSql(fs.readFileSync(FIXTURE_PATH, "utf8"), databaseName);
    });

    test.afterAll(async () => {
        await dropDatabaseIfExists(databaseName);
    });

    test(
        "Search Database Objects from the server node opens with master selected",
        testCases(5878934),
        async () => {
            const { page } = getContext();
            const search = await openDatabaseSearch(page);

            await waitForActiveEditorTab(page, getSearchWebviewTitle());
            await expect(
                search.getByText("Search Database Objects", { exact: true }),
            ).toBeVisible();
            await expect(search.getByText(`${getServerName()} / master`)).toBeVisible();
            await expect(search.getByRole("combobox", { name: "Database" })).toHaveText("master");
        },
    );

    test(
        "Search Database Objects from a database node opens with that database selected",
        testCases(5878935),
        async () => {
            const { page } = getContext();
            const search = await openDatabaseSearch(page, databaseName);

            await waitForActiveEditorTab(page, getSearchWebviewTitle());
            await expect(
                search.getByText("Search Database Objects", { exact: true }),
            ).toBeVisible();
            await expect(search.getByText(`${getServerName()} / ${databaseName}`)).toBeVisible();
            await expect(search.getByRole("combobox", { name: "Database" })).toHaveText(
                databaseName,
            );
            await expect(search.getByText("4 objects found")).toBeVisible();
        },
    );

    test.describe("Result actions", () => {
        let search: FrameLocator;

        test.beforeAll(async () => {
            search = await openDatabaseSearch(getContext().page, databaseName);
            await expect(getAllResultActionButtons(search)).toHaveCount(SEARCH_OBJECTS.length, {
                timeout: 60 * 1000,
            });
        });

        test.afterEach(async () => {
            const { page } = getContext();
            // Drop every editor an action opened so the search panel is active for the next test.
            await new QuickInput(page).close();
            await closeEditors(page, "Search Database Objects");
            await waitForActiveEditorTab(page, getSearchWebviewTitle());
        });

        for (const object of SEARCH_OBJECTS) {
            test(
                `${object.typeName} results offer the expected actions`,
                testCases(object.caseId),
                async () => {
                    expect(await openResultActionsMenu(search, object.fullName)).toEqual(
                        object.menu,
                    );
                },
            );

            for (const [action, expectedScript] of Object.entries(object.scripts)) {
                test(
                    `${object.typeName} ${action} opens the script in a new editor`,
                    testCases(object.caseId),
                    async () => {
                        const { page } = getContext();
                        await runResultAction(search, object.fullName, action);
                        await expect
                            .poll(() => getActiveEditorText(page), { timeout: 30 * 1000 })
                            .toMatch(expectedScript);
                    },
                );
            }

            test(
                `${object.typeName} Copy Object Name copies the schema-qualified name`,
                testCases(object.caseId),
                async () => {
                    const { electronApp } = getContext();
                    await withClipboardLock(async () => {
                        await clearClipboard(electronApp);
                        await runResultAction(search, object.fullName, "Copy Object Name");
                        await expect.poll(() => readClipboard(electronApp)).toBe(object.fullName);
                    });
                },
            );
        }

        for (const object of [TABLE, VIEW]) {
            // Failed in the Linux CI build-and-test smoke run: hovering the editor tab to close it
            // timed out, likely because the tab was obscured.
            // TODO: Stabilize this test and re-enable it.
            test.fixme(
                `${object.typeName} Select Top 1000 opens a runnable SELECT script`,
                testCases(object.caseId),
                async () => {
                    const { page } = getContext();
                    await runResultAction(search, object.fullName, "Select Top 1000");
                    await waitForActiveEditorTab(page, /^SELECT TOP \(1000\)/);
                    await expect
                        .poll(() => getActiveEditorText(page), { timeout: 30 * 1000 })
                        .toMatch(
                            new RegExp(
                                `SELECT TOP \\(1000\\)[\\s\\S]*FROM \\[${databaseName}\\]\\.\\[dbo\\]\\.\\[${object.name}\\]`,
                            ),
                        );

                    // The script editor connects in the background; executing earlier prompts for a
                    // connection instead.
                    await waitForConnected(page, getServerName());
                    await executeQueryAndWait(page);
                    const grid = await waitForResultGrid(await getResultsFrame(page));
                    await expect(grid).toHaveAttribute(
                        "data-row-count",
                        String(EVENT_TICKET_ROW_COUNT),
                    );
                },
            );
        }

        test("Table Edit Data opens the table's data", testCases(TABLE.caseId), async () => {
            const { page } = getContext();
            await runResultAction(search, TABLE.fullName, "Edit Data");
            await waitForActiveEditorTab(page, TABLE.fullName);
            const editData = await getWebviewByTitle(page, TABLE.fullName, 60 * 1000);
            await expect(editData.getByText("Spring Concert")).toBeVisible({ timeout: 60 * 1000 });
        });

        test("Table Modify Table opens the Table Designer", testCases(TABLE.caseId), async () => {
            const { page } = getContext();
            await runResultAction(search, TABLE.fullName, "Modify Table");
            await waitForActiveEditorTab(page, TABLE.name);
            const designer = await getWebviewByTitle(page, TABLE.name, 60 * 1000);
            await expect(designer.getByRole("textbox", { name: "Table name" })).toHaveValue(
                TABLE.name,
                { timeout: 120 * 1000 },
            );
            await expect(designer.getByRole("button", { name: "Schema" })).toHaveText("dbo");
            await expect(
                designer.getByRole("cell", { name: "TicketId", exact: true }),
            ).toBeVisible();
        });
    });

    test.describe("Filters", () => {
        let search: FrameLocator;

        test.beforeEach(async () => {
            search = await openDatabaseSearch(getContext().page, databaseName);
            await expect(getAllResultActionButtons(search)).toHaveCount(SEARCH_OBJECTS.length, {
                timeout: 60 * 1000,
            });
        });

        test(
            "Unchecking each object type removes it from the results",
            testCases(5878940),
            async () => {
                const typeFilters: Array<[string, SearchObject]> = [
                    ["Tables", TABLE],
                    ["Views", VIEW],
                    ["Stored Procedures", STORED_PROCEDURE],
                    ["Functions", FUNCTION],
                ];
                let remaining = SEARCH_OBJECTS.length;
                for (const [filterLabel, object] of typeFilters) {
                    const checkbox = search.getByRole("checkbox", { name: filterLabel });
                    await expect(checkbox).toBeChecked();
                    await checkbox.click();
                    await expect(checkbox).not.toBeChecked();
                    remaining--;
                    await expect(getResultActionsButton(search, object.fullName)).toHaveCount(0);
                    await expect(getAllResultActionButtons(search)).toHaveCount(remaining);
                }
                await expect(search.getByText("0 objects found")).toBeVisible();
                await expect(search.getByText("No objects found")).toBeVisible();

                for (const [filterLabel, object] of typeFilters) {
                    await search.getByRole("checkbox", { name: filterLabel }).click();
                    await expect(getResultActionsButton(search, object.fullName)).toBeVisible();
                }
                await expect(getAllResultActionButtons(search)).toHaveCount(SEARCH_OBJECTS.length);
                await expect(search.getByText("4 objects found")).toBeVisible();
                for (const object of SEARCH_OBJECTS) {
                    await expect(
                        search
                            .getByRole("row")
                            .filter({ has: getResultActionsButton(search, object.fullName) }),
                    ).toContainText(object.typeName);
                }
            },
        );

        test(
            "Unchecking the dbo schema clears the results and Select All",
            testCases(5878940),
            async () => {
                const selectAll = search.getByRole("checkbox", { name: "Select All" });
                const dbo = search.getByRole("checkbox", { name: "dbo", exact: true });
                await expect(selectAll).toBeChecked();
                await expect(dbo).toBeChecked();

                await dbo.click();

                await expect(dbo).not.toBeChecked();
                await expect(selectAll).not.toBeChecked();
                await expect(getAllResultActionButtons(search)).toHaveCount(0);
                await expect(search.getByText("No objects found")).toBeVisible();
            },
        );
    });
});
