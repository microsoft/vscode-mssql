/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { FrameLocator, Locator, Page } from "@playwright/test";
import { test, expect } from "./baseFixtures";
import { useSharedVsCodeLifecycle } from "./utils/testLifecycle";
import {
    expandObjectExplorerPath,
    getObjectExplorerNode,
    getSeededLaunchConfig,
    runObjectExplorerContextAction,
    SEEDED_PROFILE_NAME,
} from "./utils/seededConnection";
import {
    dropDatabaseIfExists,
    recreateDatabase,
    runSql,
    uniqueDatabaseName,
} from "./utils/sqlClient";
import { getWebviewByTitle } from "./utils/testHelpers";
import { testCases } from "./utils/testCases";

const TABLE = "dbo.Items";

/** Restores the table to the same three rows before every test. */
const RESET_ITEMS = `
DELETE FROM dbo.Items;
INSERT INTO dbo.Items (Id, Name, Qty) VALUES (1, N'Apple', 3), (2, N'Banana', 5), (3, N'Cherry', 7);`;

/**
 * Edit Table Data: committing edits with Enter and Tab, adding and deleting rows with undo, and
 * the generated SQL script pane. Saved results are checked directly against the table.
 */
test.describe("MSSQL Extension - Table Explorer / Edit Data", () => {
    const databaseName = uniqueDatabaseName("E2E_EditData");

    const getContext = useSharedVsCodeLifecycle({
        launchOptions: { initialConfig: getSeededLaunchConfig() },
        afterLaunch: async ({ page }) => {
            await recreateDatabase(databaseName);
            await runSql(
                "CREATE TABLE dbo.Items (Id int PRIMARY KEY, Name nvarchar(50) NOT NULL, Qty int NULL);",
                databaseName,
            );
            await expandObjectExplorerPath(page, [
                SEEDED_PROFILE_NAME,
                "Databases",
                databaseName,
                "Tables",
            ]);
        },
    });

    test.beforeEach(async () => {
        await runSql(RESET_ITEMS, databaseName);
    });

    test.afterEach(async () => {
        const { page } = getContext();
        const editorTab = page.getByRole("tab", { name: TABLE });
        await expect(async () => {
            if ((await editorTab.count()) > 0) {
                await editorTab.hover({ timeout: 2000 });
                await editorTab.getByRole("button", { name: /^Close/ }).click({ timeout: 2000 });
            }
            // Closing with pending edits asks whether to save them.
            const discard = page
                .getByRole("dialog")
                .filter({ hasText: "has unsaved changes" })
                .getByRole("button", { name: "Discard" });
            if (await discard.isVisible()) {
                await discard.click();
            }
            await expect(editorTab).toHaveCount(0, { timeout: 2000 });
            await expect(discard).toBeHidden({ timeout: 2000 });
        }).toPass({ timeout: 30 * 1000 });
    });

    test.afterAll(async () => {
        await dropDatabaseIfExists(databaseName);
    });

    async function openEditData(page: Page): Promise<FrameLocator> {
        await runObjectExplorerContextAction(
            page,
            getObjectExplorerNode(page, TABLE),
            "Edit Table Data...",
        );
        const editor = await getWebviewByTitle(page, TABLE);
        await expect(getRow(editor, "Cherry")).toBeVisible({ timeout: 60 * 1000 });
        return editor;
    }

    function getRow(editor: FrameLocator, name: string): Locator {
        return editor.getByRole("row").filter({
            has: editor.getByRole("gridcell", { name, exact: true }),
        });
    }

    function getCell(editor: FrameLocator, rowName: string, value: string): Locator {
        return getRow(editor, rowName).getByRole("gridcell", { name: value, exact: true });
    }

    async function editCell(editor: FrameLocator, cell: Locator, value: string): Promise<void> {
        await cell.dblclick();
        const input = editor.getByRole("textbox").and(editor.locator(":focus"));
        await expect(input).toBeVisible();
        await input.fill(value);
    }

    async function save(page: Page, editor: FrameLocator): Promise<void> {
        const saveButton = editor.getByRole("button", { name: "Save Changes" });
        await expect(saveButton).toBeEnabled();
        await saveButton.click();
        // The confirmation is a workbench notification toast.
        await expect(
            page.getByRole("dialog").filter({ hasText: "Changes saved successfully" }),
        ).toBeVisible({ timeout: 30 * 1000 });
    }

    /**
     * Pending edits are only shown visually, by the cell formatter's highlight class, so that is
     * the one thing to assert on.
     */
    async function expectPendingHighlight(cell: Locator, highlighted: boolean): Promise<void> {
        await expect(cell.locator(".table-cell-modified")).toHaveCount(highlighted ? 1 : 0);
    }

    /**
     * The SQL pane's script is shown in a read-only Monaco editor, whose text is only exposed
     * through its rendered lines.
     */
    function getScriptText(editor: FrameLocator): Locator {
        return editor
            .locator(".monaco-editor")
            .filter({ has: editor.getByRole("textbox", { name: "Editor content" }) })
            .locator(".view-lines");
    }

    async function readNames(): Promise<string[]> {
        const [rows] = await runSql("SELECT Name FROM dbo.Items ORDER BY Id;", databaseName);
        return rows.map((row) => String(row.Name));
    }

    test(
        "Enter commits a valid edit, which stays highlighted until saved",
        testCases(5878910),
        async () => {
            const { page } = getContext();
            const editor = await openEditData(page);

            await editCell(editor, getCell(editor, "Apple", "Apple"), "Apricot");
            await editor.locator(":focus").press("Enter");

            const edited = getCell(editor, "Apricot", "Apricot");
            await expect(edited).toBeVisible();
            // Pending changes are only shown visually, as a highlighted cell.
            await expectPendingHighlight(edited, true);

            await save(page, editor);
            await expectPendingHighlight(edited, false);
            expect(await readNames()).toEqual(["Apricot", "Banana", "Cherry"]);
        },
    );

    // Flaky in the Linux CI build-and-test smoke run (passed on retry).
    // TODO: Stabilize this test and re-enable it.
    test.fixme(
        "Tab commits a valid edit, which stays highlighted until saved",
        testCases(5878911),
        async () => {
            const { page } = getContext();
            const editor = await openEditData(page);

            await editCell(editor, getCell(editor, "Banana", "Banana"), "Blueberry");
            await editor.locator(":focus").press("Tab");

            const edited = getCell(editor, "Blueberry", "Blueberry");
            await expectPendingHighlight(edited, true);

            await save(page, editor);
            await expectPendingHighlight(edited, false);
            expect(await readNames()).toEqual(["Apple", "Blueberry", "Cherry"]);
        },
    );
    // Flaky in the Linux CI build-and-test smoke run (passed on retry).
    // TODO: Stabilize this test and re-enable it.
    test.fixme(
        "Add Row appends a row that saves with the entered values",
        testCases(5878912),
        async () => {
            const { page } = getContext();
            const editor = await openEditData(page);

            // A new row is inserted below the active row, so start from the last one.
            await getCell(editor, "Cherry", "Cherry").click();
            await editor.getByRole("button", { name: "Add Row" }).click();
            // The new row is the only one with a pending change, so its Revert Row is enabled.
            const newRow = editor.getByRole("row").filter({
                has: editor.getByRole("button", { name: "Revert Row", disabled: false }),
            });
            await expect(newRow).toHaveCount(1);
            const lastExistingRow = await getRow(editor, "Cherry").boundingBox();
            expect((await newRow.boundingBox())!.y).toBeGreaterThan(lastExistingRow!.y);

            // Cells after the row-selection checkbox and Revert Row column, in column order.
            const values = ["4", "Date", "9"];
            for (const [index, value] of values.entries()) {
                await editCell(editor, newRow.getByRole("gridcell").nth(index + 2), value);
                await editor.locator(":focus").press("Enter");
            }
            await expect(getRow(editor, "Date")).toBeVisible();

            await save(page, editor);
            const [rows] = await runSql(
                "SELECT Id, Name, Qty FROM dbo.Items WHERE Id = 4;",
                databaseName,
            );
            expect(rows).toEqual([{ Id: 4, Name: "Date", Qty: 9 }]);
        },
    );

    // Flaky in the Linux CI build-and-test smoke run (passed on retry).
    // TODO: Stabilize this test and re-enable it.
    test.fixme("deleting a row can be undone", testCases(5878913), async () => {
        const { page } = getContext();
        const editor = await openEditData(page);
        const row = getRow(editor, "Banana");
        const revertRow = row.getByRole("button", { name: "Revert Row" });
        await expect(revertRow).toBeDisabled();

        await getCell(editor, "Banana", "Banana").click({ button: "right" });
        await editor.getByRole("menuitem", { name: "Delete Row" }).click();

        // A deleted row is struck through and stays in the grid until saved.
        await expect(row).toHaveClass(/deleted-row/);
        await expect(getCell(editor, "Banana", "Banana")).toHaveCSS(
            "text-decoration-line",
            "line-through",
        );
        await expect(revertRow).toBeEnabled();
        // Deleting is no longer offered for the already-deleted row.
        await getCell(editor, "Banana", "Banana").click({ button: "right" });
        await expect(editor.getByRole("menuitem", { name: "Revert Row" })).toBeVisible();
        await expect(editor.getByRole("menuitem", { name: "Delete Row" })).toHaveCount(0);
        await page.keyboard.press("Escape");
        await expect(editor.getByRole("menuitem", { name: "Revert Row" })).toHaveCount(0);

        await revertRow.click();
        await expect(row).not.toHaveClass(/deleted-row/);
        await expect(revertRow).toBeDisabled();
        await expect(
            editor.getByRole("button", { name: "Save Changes", exact: true }),
        ).toBeDisabled();
        expect(await readNames()).toEqual(["Apple", "Banana", "Cherry"]);
    });

    // Flaky in the Linux CI build-and-test smoke run (passed on retry).
    // TODO: Stabilize this test and re-enable it.
    test.fixme("the SQL pane scripts pending updates and deletes", testCases(5878914), async () => {
        const { page } = getContext();
        const editor = await openEditData(page);

        await editCell(editor, getCell(editor, "Apple", "Apple"), "Apricot");
        await editor.locator(":focus").press("Enter");
        await expectPendingHighlight(getCell(editor, "Apricot", "Apricot"), true);

        await editor.getByRole("button", { name: "Show SQL Pane", exact: true }).click();
        // The split button also opens its menu; dismiss it so it doesn't cover the grid.
        await page.keyboard.press("Escape");
        await expect(editor.getByRole("tab", { name: "Changes" })).toHaveAttribute(
            "aria-selected",
            "true",
        );
        const script = getScriptText(editor);
        await expect(script).toContainText("UPDATE [dbo].[Items] SET [Name] = N'Apricot'");

        await getCell(editor, "Cherry", "Cherry").click({ button: "right" });
        await editor.getByRole("menuitem", { name: "Delete Row" }).click();
        await expect(script).toContainText("DELETE FROM [dbo].[Items]");

        await getRow(editor, "Cherry").getByRole("button", { name: "Revert Row" }).click();
        await expect(script).not.toContainText("DELETE");
        await expect(script).toContainText("UPDATE");

        await getCell(editor, "Apricot", "Apricot").click({ button: "right" });
        await editor.getByRole("menuitem", { name: "Revert Cell" }).click();
        await expect(getCell(editor, "Apple", "Apple")).toBeVisible();
        await expect(script).not.toContainText("UPDATE");
        await expect(script).toContainText("No pending changes");
    });
});
