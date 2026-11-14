/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { FrameLocator, Locator, Page } from "@playwright/test";
import { test, expect } from "./baseFixtures";
import {
    clickContextMenuItem,
    expandObjectExplorerPath,
    getContextMenuLabels,
    getSeededLaunchConfig,
    SEEDED_PROFILE_NAME,
} from "./utils/seededConnection";
import { dropDatabaseIfExists, recreateDatabase, uniqueDatabaseName } from "./utils/sqlClient";
import { testCases } from "./utils/testCases";
import { getWebviewByTitle } from "./utils/testHelpers";
import { useSharedVsCodeLifecycle } from "./utils/testLifecycle";

/** Title of the designer tab, and of its webview, for a table that has not been published. */
const NEW_TABLE_TITLE = "New Table";

/** A column row in the Columns grid, found by the value of its Name text box. */
function getColumnRow(frame: FrameLocator, columnName: string): Locator {
    // A row's accessible name starts with the value of its Name text box.
    return frame.getByRole("row", { name: new RegExp(`^${columnName}\\b`) });
}

/** The read-only script editor in the Definition panel. */
function getDefinitionEditor(frame: FrameLocator): Locator {
    return frame.getByRole("code");
}

/**
 * Reads the Definition panel's script. The panel is maximized while reading so Monaco renders
 * every line, then restored so the column grid is usable again.
 */
async function readDefinitionScript(frame: FrameLocator): Promise<string> {
    await frame.getByRole("button", { name: "Maximize panel size" }).click();
    const restore = frame.getByRole("button", { name: "Restore panel size" });
    await expect(restore).toBeVisible();
    try {
        return (await getDefinitionEditor(frame).locator(".view-lines").innerText()).replace(
            /\u00a0/g,
            " ",
        );
    } finally {
        await restore.click();
        await expect(frame.getByRole("button", { name: "Maximize panel size" })).toBeVisible();
    }
}

/** Waits for the Definition panel's script to satisfy `check`, re-reading it until it does. */
async function expectDefinitionScript(
    frame: FrameLocator,
    check: (script: string) => boolean,
    message: string,
): Promise<string> {
    let script = "";
    await expect
        .poll(
            async () => {
                script = await readDefinitionScript(frame);
                return check(script);
            },
            { message, timeout: 30 * 1000 },
        )
        .toBe(true);
    return script;
}

/** Picks a data type from a column row's Data Type dropdown. */
async function selectDataType(frame: FrameLocator, row: Locator, dataType: string): Promise<void> {
    await row.getByRole("button", { name: "Data Type" }).click();
    await frame
        .getByRole("listbox", { name: "Data Type" })
        .getByRole("option", { name: dataType, exact: true })
        .click();
    await expect(row.getByRole("button", { name: "Data Type" })).toHaveText(dataType);
}

/**
 * Table Designer: a new table opened from the Tables folder in Object Explorer, with the
 * Definition panel's CREATE TABLE script following each column and primary key edit.
 */
test.describe("Table Designer", () => {
    test.describe.configure({ mode: "serial" });

    const databaseName = uniqueDatabaseName("TableDesigner");
    let page: Page;
    let frame: FrameLocator;

    test.beforeAll(async () => {
        await recreateDatabase(databaseName);
    });

    const getContext = useSharedVsCodeLifecycle({
        launchOptions: { initialConfig: getSeededLaunchConfig() },
    });

    test.afterAll(async () => {
        await dropDatabaseIfExists(databaseName);
    });

    test(
        "New Table on the Tables folder opens the Table Designer",
        testCases(5878894),
        async () => {
            page = getContext().page;
            const tables = await expandObjectExplorerPath(
                page,
                [SEEDED_PROFILE_NAME, "Databases", databaseName, "Tables"],
                { expandLast: false },
            );
            await tables.click({ button: "right" });
            expect(await getContextMenuLabels(page)).toContain(NEW_TABLE_TITLE);
            await clickContextMenuItem(page, NEW_TABLE_TITLE);

            await expect(
                page.getByRole("tab", { name: new RegExp(`^${NEW_TABLE_TITLE}`), selected: true }),
            ).toBeVisible({ timeout: 60 * 1000 });
            frame = await getWebviewByTitle(page, NEW_TABLE_TITLE, 60 * 1000);
            await expect(frame.getByRole("textbox", { name: "Table name" })).toHaveValue(
                "NewTable",
                {
                    timeout: 60 * 1000,
                },
            );
            await expect(frame.getByRole("tab", { name: "Columns", selected: true })).toBeVisible();
        },
    );

    test("Show Definition displays the CREATE TABLE script", testCases(5878894), async () => {
        // The panel opens with the designer; hide it first so Show Definition is exercised.
        const hide = frame.getByRole("button", { name: "Hide Definition" });
        await expect(hide).toBeVisible();
        await hide.click();
        // The collapsed panel keeps the editor mounted, so check it is no longer on screen.
        await expect(getDefinitionEditor(frame)).not.toBeInViewport();

        await frame.getByRole("button", { name: "Show Definition" }).click();
        await expect(frame.getByRole("tab", { name: "Definition", selected: true })).toBeVisible();
        await expect(getDefinitionEditor(frame)).toBeInViewport();
        await expect(hide).toBeVisible();

        const script = await expectDefinitionScript(
            frame,
            (text) => text.includes("CREATE TABLE [dbo].[NewTable]"),
            "Definition panel never showed the CREATE TABLE script",
        );
        expect(script).toMatch(/\[Id\]\s+INT IDENTITY \(1, 1\) NOT NULL/);
        expect(script).toMatch(/PRIMARY KEY CLUSTERED \(\[Id\] ASC\)/);
    });

    test("Adding a column adds it to the script", testCases(5878894), async () => {
        await frame.getByRole("button", { name: "New Column" }).click();
        const newRow = getColumnRow(frame, "column_1");
        await expect(newRow).toBeVisible();

        const nameBox = newRow.getByRole("textbox", { name: "Name" });
        await nameBox.fill("TestColumn");
        // Edits are committed when the text box loses focus. The row's name follows the text
        // box's value, so the old row locator no longer matches here.
        await page.keyboard.press("Tab");
        const row = getColumnRow(frame, "TestColumn");
        await expect(row).toBeVisible();
        await selectDataType(frame, row, "nvarchar(50)");

        await expectDefinitionScript(
            frame,
            (text) => /\[TestColumn\]\s+NVARCHAR \(50\) NULL/.test(text),
            "Script never included the new nvarchar(50) column",
        );
    });

    test("Changing type and nullability updates the script", testCases(5878894), async () => {
        const row = getColumnRow(frame, "TestColumn");
        await selectDataType(frame, row, "int");
        const allowNulls = row.getByRole("checkbox", { name: "Allow Nulls" });
        await expect(allowNulls).toBeChecked();
        // The checkbox reflects the designer model, which updates after the edit round-trips.
        await allowNulls.click();
        await expect(allowNulls).not.toBeChecked();

        const script = await expectDefinitionScript(
            frame,
            (text) => /\[TestColumn\]\s+INT NOT NULL/.test(text),
            "Script never showed TestColumn as INT NOT NULL",
        );
        expect(script).not.toContain("NVARCHAR");
    });

    test("Adding a primary key adds the constraint to the script", testCases(5878894), async () => {
        // Move the key off the default Id column so the new constraint is unambiguous.
        const idPrimaryKey = getColumnRow(frame, "Id").getByRole("checkbox", {
            name: "Primary Key",
        });
        await idPrimaryKey.click();
        await expect(idPrimaryKey).not.toBeChecked();
        await expectDefinitionScript(
            frame,
            (text) => !text.includes("PRIMARY KEY"),
            "Script still had a primary key after it was removed from Id",
        );

        const primaryKey = getColumnRow(frame, "TestColumn").getByRole("checkbox", {
            name: "Primary Key",
        });
        await primaryKey.click();
        await expect(primaryKey).toBeChecked();
        await expectDefinitionScript(
            frame,
            (text) =>
                /CONSTRAINT \[PK_NewTable\] PRIMARY KEY CLUSTERED \(\[TestColumn\] ASC\)/.test(
                    text,
                ),
            "Script never showed the primary key on TestColumn",
        );
    });

    test("Removing a column removes it from the script", testCases(5878894), async () => {
        await getColumnRow(frame, "Id").getByRole("button", { name: "Remove Column" }).click();
        await expect(getColumnRow(frame, "Id")).toHaveCount(0);

        const script = await expectDefinitionScript(
            frame,
            (text) => !text.includes("[Id]"),
            "Script still included the removed Id column",
        );
        expect(script).toContain("CREATE TABLE [dbo].[NewTable]");
        expect(script).toMatch(/\[TestColumn\]\s+INT NOT NULL/);
    });
});
