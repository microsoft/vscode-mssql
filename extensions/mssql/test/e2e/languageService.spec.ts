/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Page } from "@playwright/test";
import * as fs from "fs";
import * as path from "path";
import { test, expect } from "./baseFixtures";
import { QuickInput } from "./pageObjects/quickInput";
import {
    clearActiveEditor,
    expandObjectExplorerLevels,
    getSuggestion,
    isSuggestionFocused,
    openFocusedNodeContextMenu,
    revertAndCloseActiveEditor,
    showObjectExplorer,
} from "./utils/languageServiceHelpers";
import {
    clickContextMenuPath,
    connectActiveEditor,
    getActiveEditorText,
    getSeededLaunchConfig,
    SEEDED_PROFILE_NAME,
} from "./utils/seededConnection";
import {
    dropDatabaseIfExists,
    recreateDatabase,
    runSql,
    uniqueDatabaseName,
} from "./utils/sqlClient";
import { testCases } from "./utils/testCases";
import { openNewQueryEditor } from "./utils/testHelpers";
import { useSharedVsCodeLifecycle } from "./utils/testLifecycle";

/**
 * Language Service suite: IntelliSense (completions, snippets, diagnostics) in a connected query
 * editor, and "Script as ..." actions on Object Explorer objects.
 */
test.describe("MSSQL Extension - Language Service", () => {
    const getContext = useSharedVsCodeLifecycle({
        launchOptions: {
            initialConfig: getSeededLaunchConfig({
                // IntelliSense is what this suite tests, so turn suggestions back on.
                "editor.quickSuggestions": { other: true, comments: false, strings: false },
                "editor.suggestOnTriggerCharacters": true,
                "editor.acceptSuggestionOnEnter": "on",
                "editor.tabCompletion": "on",
                // Sticky headers overlay tree rows and would intercept Object Explorer clicks.
                "workbench.tree.enableStickyScroll": false,
            }),
        },
    });

    test.describe("IntelliSense", () => {
        test.beforeAll(async () => {
            const { page } = getContext();
            await openNewQueryEditor(page);
            await connectActiveEditor(page);
            await waitForIntelliSense(page);
        });

        test.beforeEach(async () => {
            await clearActiveEditor(getContext().page);
        });

        test(
            "Accepting a keyword suggestion with Tab completes the word",
            testCases(5878827),
            async () => {
                const { page } = getContext();
                await typeAndSelectSuggestion(page, "SEL", "SELECT");
                await page.keyboard.press("Tab");
                await expect.poll(() => getActiveEditorText(page)).toBe("SELECT");
            },
        );

        test(
            "Accepting a keyword suggestion with Enter completes the word",
            testCases(5878827),
            async () => {
                const { page } = getContext();
                await typeAndSelectSuggestion(page, "SEL", "SELECT");
                await page.keyboard.press("Enter");
                await expect.poll(() => getActiveEditorText(page)).toBe("SELECT");
            },
        );

        test(
            "Keyword suggestions appear while typing SELECT * FROM",
            testCases(5878829),
            async () => {
                const { page } = getContext();
                await page.keyboard.type("SEL");
                await expect(getSuggestion(page, "SELECT")).toBeVisible({ timeout: 30 * 1000 });
                await page.keyboard.type("ECT * FR");
                await expect(getSuggestion(page, "FROM")).toBeVisible({ timeout: 30 * 1000 });
            },
        );

        test(
            "Database, schema, and object suggestions are filtered as you type",
            testCases(5878829),
            async () => {
                const { page } = getContext();
                await page.keyboard.type("SELECT * FROM m");
                for (const database of ["master", "model", "msdb"]) {
                    await expect(getSuggestion(page, database)).toBeVisible({ timeout: 30 * 1000 });
                }
                await page.keyboard.type("as");
                await expect(getSuggestion(page, "master")).toBeVisible();
                await expect(getSuggestion(page, "model")).toHaveCount(0);
                await expect(getSuggestion(page, "msdb")).toHaveCount(0);

                await page.keyboard.type("ter.");
                await expect(getSuggestion(page, "dbo")).toBeVisible({ timeout: 30 * 1000 });
                await expect(getSuggestion(page, "guest")).toBeVisible();
                await page.keyboard.type("sy");
                await expect(getSuggestion(page, "sys")).toBeVisible();
                await expect(getSuggestion(page, "dbo")).toHaveCount(0);
                await expect(getSuggestion(page, "guest")).toHaveCount(0);

                await page.keyboard.type("s.");
                await expect(getSuggestion(page, "all_columns")).toBeVisible({
                    timeout: 30 * 1000,
                });
                await page.keyboard.type("tab");
                await expect(getSuggestion(page, "tables")).toBeVisible();
                await expect(getSuggestion(page, "all_columns")).toHaveCount(0);
                await page.keyboard.type("les");
                await expect(getSuggestion(page, "tables")).toBeVisible();
                // Fuzzy matching keeps near matches listed, so the best match must be focused.
                await expect.poll(() => isSuggestionFocused(page, "tables")).toBe(true);
                await page.keyboard.press("Escape");
                await expect
                    .poll(() => getActiveEditorText(page))
                    .toBe("SELECT * FROM master.sys.tables");
            },
        );

        test(
            "sqlCreateDatabase snippet inserts CREATE DATABASE syntax",
            testCases(5878830),
            async () => {
                const { page } = getContext();
                await page.keyboard.type("sqlCreateDatabase");
                const snippet = getSuggestion(page, "sqlCreateDatabase");
                await expect(snippet).toBeVisible({ timeout: 30 * 1000 });
                await expect(snippet).toHaveAccessibleName(/Snippet$/);
                await page.keyboard.press("Tab");
                await page.keyboard.press("Escape");
                await expect
                    .poll(() => getActiveEditorText(page))
                    .toContain("CREATE DATABASE DatabaseName");
                const text = await getActiveEditorText(page);
                expect(text).toContain("-- Create a new database called 'DatabaseName'");
                expect(text).toContain("WHERE name = N'DatabaseName'");
                expect(text).not.toContain("sqlCreateDatabase");
            },
        );

        test(
            "Invalid syntax is underlined and listed in the Problems view",
            testCases(5878831),
            async () => {
                const { page } = getContext();
                await page.keyboard.type("SELECT foo FROM sy.tables");
                await page.keyboard.press("Escape");
                // Monaco draws diagnostics as decorations with no accessible role.
                await expect(page.locator(".squiggly-error").first()).toBeVisible({
                    timeout: 60 * 1000,
                });
                await expect(page.getByRole("button", { name: /^Errors: [1-9]/ })).toBeVisible();

                await new QuickInput(page).runCommand(
                    "View: Focus Problems",
                    "View: Focus Problems (Errors, Warnings, Infos)",
                );
                await expect(
                    page.getByRole("treeitem", { name: /Invalid object name 'sy\.tables'/ }),
                ).toBeVisible({ timeout: 30 * 1000 });
                await new QuickInput(page).runCommand(
                    "View: Toggle Problems",
                    "View: Toggle Problems",
                );
            },
        );
    });

    test.describe("Scripting", () => {
        const databaseName = uniqueDatabaseName("LsScripting");

        test.beforeAll(async () => {
            await recreateDatabase(databaseName);
            await runSql(
                fs.readFileSync(
                    path.join(
                        __dirname,
                        "..",
                        "resources",
                        "e2e",
                        "languageService",
                        "scriptingObjects.sql",
                    ),
                    "utf8",
                ),
                databaseName,
            );
            const { page } = getContext();
            await showObjectExplorer(page);
            await expandObjectExplorerLevels(page, [
                SEEDED_PROFILE_NAME,
                "Databases",
                databaseName,
            ]);
        });

        test.afterAll(async () => {
            await dropDatabaseIfExists(databaseName);
        });

        /**
         * Runs a script action on an Object Explorer object, waits for the new editor it opens to
         * contain a script matching `expected`, then closes that editor unsaved.
         */
        async function expectGeneratedScript(
            page: Page,
            folderPath: string[],
            objectLabel: string,
            menuPath: string[],
            expected: RegExp,
        ): Promise<void> {
            await expandObjectExplorerLevels(page, [...folderPath, objectLabel], {
                startLevel: 4,
                expandLast: false,
            });
            await openFocusedNodeContextMenu(page);
            await clickContextMenuPath(page, menuPath);
            await expect
                .poll(() => getActiveEditorText(page), { timeout: 60 * 1000 })
                .toMatch(expected);
            await revertAndCloseActiveEditor(page);
        }

        test("Script view as Create", testCases(5878832), async () => {
            await expectGeneratedScript(
                getContext().page,
                ["Views"],
                "dbo.LsView",
                ["Script as Create"],
                /CREATE VIEW \[dbo\]\.\[LsView\] AS\s+SELECT Id, Name FROM dbo\.LsTable;/,
            );
        });

        test("Script view as Drop", testCases(5878832), async () => {
            await expectGeneratedScript(
                getContext().page,
                ["Views"],
                "dbo.LsView",
                ["Script as Drop"],
                /DROP VIEW \[dbo\]\.\[LsView\]/,
            );
        });

        // Flaky in the Linux CI build-and-test smoke run (passed on retry): the generated script editor did not become active in time.
        // TODO: Stabilize this test and re-enable it.
        test.fixme("Script view as Alter", testCases(5878832), async () => {
            await expectGeneratedScript(
                getContext().page,
                ["Views"],
                "dbo.LsView",
                ["Script as Alter"],
                /ALTER VIEW \[dbo\]\.\[LsView\] AS\s+SELECT Id, Name FROM dbo\.LsTable;/,
            );
        });

        const procedurePath = ["Programmability", "Stored Procedures"];

        test("Script stored procedure as Create", testCases(5878833), async () => {
            await expectGeneratedScript(
                getContext().page,
                procedurePath,
                "dbo.LsProcedure",
                ["Script as Create"],
                /CREATE PROCEDURE \[dbo\]\.\[LsProcedure\]\s+@Id INT/,
            );
        });

        // Flaky in the Linux CI build-and-test smoke run (passed on retry): the generated script editor did not become active in time.
        // TODO: Stabilize this test and re-enable it.
        test.fixme("Script stored procedure as Drop", testCases(5878833), async () => {
            await expectGeneratedScript(
                getContext().page,
                procedurePath,
                "dbo.LsProcedure",
                ["Script as Drop"],
                /DROP PROCEDURE \[dbo\]\.\[LsProcedure\]/,
            );
        });

        test("Script stored procedure as Alter", testCases(5878833), async () => {
            await expectGeneratedScript(
                getContext().page,
                procedurePath,
                "dbo.LsProcedure",
                ["Script as Alter"],
                /ALTER PROCEDURE \[dbo\]\.\[LsProcedure\]\s+@Id INT/,
            );
        });

        // Flaky in the Linux CI build-and-test smoke run (passed on retry).
        // TODO: Stabilize this test and re-enable it.
        test.fixme("Script stored procedure as Execute", testCases(5878833), async () => {
            await expectGeneratedScript(
                getContext().page,
                procedurePath,
                "dbo.LsProcedure",
                ["Script as Execute"],
                /EXECUTE @RC = \[dbo\]\.\[LsProcedure\]\s+@Id/,
            );
        });

        // Flaky in the Linux CI build-and-test smoke run (passed on retry): the generated script editor did not become active in time.
        // TODO: Stabilize this test and re-enable it.
        test.fixme("Script user as Create", testCases(5878834), async () => {
            await expectGeneratedScript(
                getContext().page,
                ["Security", "Users"],
                "LsUser",
                ["Script as Create"],
                /CREATE USER \[LsUser\] WITHOUT LOGIN/,
            );
        });

        test("Script user as Drop", testCases(5878834), async () => {
            await expectGeneratedScript(
                getContext().page,
                ["Security", "Users"],
                "LsUser",
                ["Script as Drop"],
                /DROP USER \[LsUser\]/,
            );
        });

        // Flaky in the Linux CI build-and-test smoke run (passed on retry).
        // TODO: Stabilize this test and re-enable it.
        test.fixme("Script schema as Create", testCases(5878835), async () => {
            await expectGeneratedScript(
                getContext().page,
                ["Security", "Schemas"],
                "LsSchema",
                ["Script as Create"],
                /CREATE SCHEMA \[LsSchema\]/,
            );
        });

        test("Script schema as Drop", testCases(5878835), async () => {
            await expectGeneratedScript(
                getContext().page,
                ["Security", "Schemas"],
                "LsSchema",
                ["Script as Drop"],
                /DROP SCHEMA \[LsSchema\]/,
            );
        });

        // Flaky in the Linux CI build-and-test smoke run (passed on retry): the generated script editor did not become active in time.
        // TODO: Stabilize this test and re-enable it.
        test.fixme("Script table as Create", testCases(5878836), async () => {
            await expectGeneratedScript(
                getContext().page,
                ["Tables"],
                "dbo.LsTable",
                ["Generate Script", "Script as Create"],
                /CREATE TABLE \[dbo\]\.\[LsTable\]\(\s+\[Id\] \[int\] NOT NULL,\s+\[Name\] \[nvarchar\]\(50\) NULL/,
            );
        });

        // Flaky in the Linux CI build-and-test smoke run (passed on retry).
        // TODO: Stabilize this test and re-enable it.
        test.fixme("Script table as Drop", testCases(5878836), async () => {
            await expectGeneratedScript(
                getContext().page,
                ["Tables"],
                "dbo.LsTable",
                ["Generate Script", "Script as Drop"],
                /DROP TABLE \[dbo\]\.\[LsTable\]/,
            );
        });
    });
});

/** Waits until the language service returns object completions for the connected editor. */
async function waitForIntelliSense(page: Page): Promise<void> {
    await page.keyboard.type("SELECT * FROM master.sys.ta");
    await expect
        .poll(
            async () => {
                if ((await getSuggestion(page, "tables").count()) > 0) {
                    return true;
                }
                // Retype the last character to request completions again.
                await page.keyboard.press("Escape");
                await page.keyboard.press("Backspace");
                await page.keyboard.type("a");
                return false;
            },
            { timeout: 2 * 60 * 1000, intervals: [1000] },
        )
        .toBe(true);
    await clearActiveEditor(page);
}

/** Types `text` and moves the suggest widget's focus to the row labelled `label`. */
async function typeAndSelectSuggestion(page: Page, text: string, label: string): Promise<void> {
    await page.keyboard.type(text);
    const suggestion = getSuggestion(page, label);
    await expect(suggestion).toBeVisible({ timeout: 30 * 1000 });
    await expect
        .poll(
            async () => {
                if (await isSuggestionFocused(page, label)) {
                    return true;
                }
                await page.keyboard.press("ArrowDown");
                return false;
            },
            { timeout: 10 * 1000 },
        )
        .toBe(true);
}
