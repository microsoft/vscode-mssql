/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect, FrameLocator, Locator, Page } from "@playwright/test";
import { QuickInput } from "../pageObjects/quickInput";
import {
    clickContextMenuItem,
    expandObjectExplorerNode,
    getObjectExplorerNode,
    getObjectExplorerPane,
    SEEDED_PROFILE_NAME,
} from "./seededConnection";
import { runSql, SqlRow } from "./sqlClient";
import { VsCodeAppHandle } from "./launchVscodeWithMsSqlExt";
import {
    clearClipboard,
    getModifierKey,
    getWebviewByTitle,
    readClipboard,
    WEBVIEW_LOAD_TIMEOUT_MS,
    withClipboardLock,
} from "./testHelpers";

/** Title of the designer tab, and of its webview, for a table that has not been published. */
export const NEW_TABLE_TITLE = "New Table";

/** Object Explorer context menu item that opens an existing table in the Table Designer. */
export const MODIFY_TABLE_MENU_ITEM = "Modify Table Structure...";

/** Title of the dialog that previews and publishes the designer's changes. */
const APPLY_CHANGES = "Apply Changes";

/** Label of the publish dialog's risk acknowledgement checkbox. */
const PUBLISH_CONFIRMATION = "I have read the summary and understand the potential risks.";

/** A column row in the Columns grid, found by the value of its Name text box. */
export function getColumnRow(frame: FrameLocator, columnName: string): Locator {
    // A row's accessible name starts with the value of its Name text box.
    return frame.getByRole("row", { name: new RegExp(`^${escapeRegExp(columnName)}\\b`) });
}

/** The designer's Publish ribbon button, which opens the Apply Changes dialog. */
export function getPublishButton(frame: FrameLocator): Locator {
    return frame.getByRole("button", { name: "Publish", exact: true });
}

/** The Apply Changes dialog that previews and publishes the designer's changes. */
export function getApplyChangesDialog(frame: FrameLocator): Locator {
    return frame.getByRole("dialog", { name: APPLY_CHANGES });
}

/** Opens a new table in the Table Designer from a database's Tables folder. */
export async function openNewTableDesigner(
    page: Page,
    databaseName: string,
): Promise<FrameLocator> {
    const tables = await revealObjectExplorerPath(page, [
        SEEDED_PROFILE_NAME,
        "Databases",
        databaseName,
        "Tables",
    ]);
    await tables.click({ button: "right" });
    await clickContextMenuItem(page, NEW_TABLE_TITLE);
    return waitForDesigner(page, NEW_TABLE_TITLE);
}

/** Opens an existing table, labelled like "dbo.T1", in the Table Designer. */
export async function openExistingTableDesigner(
    page: Page,
    databaseName: string,
    tableLabel: string,
): Promise<FrameLocator> {
    const table = await revealObjectExplorerPath(page, [
        SEEDED_PROFILE_NAME,
        "Databases",
        databaseName,
        "Tables",
        tableLabel,
    ]);
    await table.click({ button: "right" });
    await clickContextMenuItem(page, MODIFY_TABLE_MENU_ITEM);
    return waitForDesigner(page, tableLabel);
}

/**
 * Scrolls the Object Explorer tree until the node labelled `label` is wholly inside it. The tree
 * only renders rows near its viewport, and databases from other tests on the shared server can
 * push a newly expanded folder's children below it.
 */
export async function scrollObjectExplorerNodeIntoView(
    page: Page,
    label: string,
): Promise<Locator> {
    const node = getObjectExplorerNode(page, label);
    const tree = getObjectExplorerPane(page).getByRole("tree");
    await expect
        .poll(
            async () => {
                const treeBox = await tree.boundingBox();
                const nodeBox = (await node.count()) > 0 ? await node.boundingBox() : undefined;
                if (!treeBox) {
                    return false;
                }
                if (
                    nodeBox &&
                    nodeBox.y >= treeBox.y &&
                    nodeBox.y + nodeBox.height <= treeBox.y + treeBox.height
                ) {
                    return true;
                }
                // Rows below the viewport are not rendered at all, so a missing row is below.
                const direction = nodeBox && nodeBox.y < treeBox.y ? -1 : 1;
                await tree.hover();
                await page.mouse.wheel(0, direction * (nodeBox?.height ?? 22) * 3);
                return false;
            },
            {
                message: `Object Explorer node "${label}" never scrolled into view`,
                timeout: 60 * 1000,
            },
        )
        .toBe(true);
    return node;
}

/**
 * Expands each node along a path, like `expandObjectExplorerPath`, but scrolls every node into
 * view first and leaves the last node unexpanded. Returns the last node.
 */
async function revealObjectExplorerPath(page: Page, labels: string[]): Promise<Locator> {
    for (const label of labels.slice(0, -1)) {
        await scrollObjectExplorerNodeIntoView(page, label);
        await expandObjectExplorerNode(page, label);
    }
    return scrollObjectExplorerNodeIntoView(page, labels[labels.length - 1]);
}

/** Waits for a designer titled `title` to finish loading its table. */
export async function waitForDesigner(page: Page, title: string): Promise<FrameLocator> {
    await expect(
        page.getByRole("tab", { name: new RegExp(`^${escapeRegExp(title)}`), selected: true }),
    ).toBeVisible({ timeout: WEBVIEW_LOAD_TIMEOUT_MS });
    const frame = await getWebviewByTitle(page, title);
    await expect(frame.getByRole("textbox", { name: "Table name" })).toBeVisible({
        timeout: WEBVIEW_LOAD_TIMEOUT_MS,
    });
    await expect(frame.getByRole("tab", { name: "Columns", selected: true })).toBeVisible();
    return frame;
}

/** Replaces the table name. Edits are committed when the text box loses focus. */
export async function setTableName(page: Page, frame: FrameLocator, name: string): Promise<void> {
    const tableName = frame.getByRole("textbox", { name: "Table name" });
    await tableName.fill(name);
    await page.keyboard.press("Tab");
    await expect(tableName).toHaveValue(name);
}

/** Adds a column with the given name and data type, returning its row. */
export async function addColumn(
    page: Page,
    frame: FrameLocator,
    columnName: string,
    dataType: string,
): Promise<Locator> {
    await frame.getByRole("button", { name: "New Column" }).click();
    const newRow = getColumnRow(frame, "column_1");
    await expect(newRow).toBeVisible();
    await newRow.getByRole("textbox", { name: "Name" }).fill(columnName);
    await page.keyboard.press("Tab");
    const row = getColumnRow(frame, columnName);
    await expect(row).toBeVisible();
    await selectDataType(frame, row, dataType);
    return row;
}

/** Picks a data type from a column row's Data Type dropdown. */
export async function selectDataType(
    frame: FrameLocator,
    row: Locator,
    dataType: string,
): Promise<void> {
    await row.getByRole("button", { name: "Data Type" }).click();
    await frame
        .getByRole("listbox", { name: "Data Type" })
        .getByRole("option", { name: dataType, exact: true })
        .click();
    await expect(row.getByRole("button", { name: "Data Type" })).toHaveText(dataType);
}

/** Toggles a column row's checkbox (e.g. "Allow Nulls") to `checked`. */
export async function setColumnCheckbox(
    row: Locator,
    name: "Allow Nulls" | "Primary Key",
    checked: boolean,
): Promise<void> {
    const checkbox = row.getByRole("checkbox", { name });
    await expect(checkbox).toBeChecked({ checked: !checked });
    // The checkbox reflects the designer model, which updates after the edit round-trips.
    await checkbox.click();
    await expect(checkbox).toBeChecked({ checked });
}

/** Opens the Apply Changes dialog and waits for its preview report to load. */
export async function openPreviewReport(frame: FrameLocator): Promise<Locator> {
    const publish = getPublishButton(frame);
    await expect(publish).toBeEnabled({ timeout: 30 * 1000 });
    await publish.click();
    const dialog = getApplyChangesDialog(frame);
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("checkbox", { name: PUBLISH_CONFIRMATION })).toBeVisible({
        timeout: 60 * 1000,
    });
    return dialog;
}

/**
 * Clicks Open Publish Script in the preview dialog and returns the full text of the script
 * editor it opens. The deployment script is longer than the viewport, so it is read through
 * the clipboard rather than from the rendered lines.
 */
export async function openPublishScript(
    app: VsCodeAppHandle,
    page: Page,
    dialog: Locator,
): Promise<string> {
    await dialog.getByRole("button", { name: "Open Publish Script" }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByRole("tab", { name: /^Untitled-\d+/, selected: true })).toBeVisible({
        timeout: 30 * 1000,
    });
    const editor = page.locator(".editor-group-container.active .monaco-editor").first();
    await expect(editor).toBeVisible();
    await editor.click();
    return withClipboardLock(async () => {
        await clearClipboard(app);
        await page.keyboard.press(`${getModifierKey()}+A`);
        await page.keyboard.press(`${getModifierKey()}+C`);
        let script = "";
        await expect
            .poll(
                async () => {
                    script = await readClipboard(app);
                    return script.length;
                },
                { message: "The publish script was never copied to the clipboard" },
            )
            .toBeGreaterThan(0);
        return script;
    });
}

/**
 * Acknowledges the preview and publishes it. Once published, the designer is retitled after the
 * table (e.g. "dbo.T1"), so its webview is resolved again by `publishedTitle`. Returns the
 * designer, with its dialog still showing the success page.
 */
export async function publishFromPreview(
    page: Page,
    dialog: Locator,
    publishedTitle: string,
): Promise<FrameLocator> {
    const publish = dialog.getByRole("button", { name: "Publish", exact: true });
    await expect(publish).toBeDisabled();
    await dialog.getByRole("checkbox", { name: PUBLISH_CONFIRMATION }).check();
    await expect(publish).toBeEnabled();
    await publish.click();
    await expect(
        page.getByRole("tab", {
            name: new RegExp(`^${escapeRegExp(publishedTitle)}`),
            selected: true,
        }),
    ).toBeVisible({ timeout: 2 * 60 * 1000 });
    const frame = await getWebviewByTitle(page, publishedTitle);
    await expect(
        getApplyChangesDialog(frame).getByText("Changes published successfully"),
    ).toBeVisible({ timeout: 2 * 60 * 1000 });
    return frame;
}

/** Dismisses the publish success page with Continue Editing, returning to the designer. */
export async function continueEditing(frame: FrameLocator): Promise<void> {
    const dialog = getApplyChangesDialog(frame);
    await dialog.getByRole("button", { name: "Continue Editing" }).click();
    await expect(dialog).toBeHidden();
}

/** Closes the active editor, discarding unsaved changes. */
export async function revertAndCloseActiveEditor(page: Page): Promise<void> {
    await new QuickInput(page).runCommand(
        "View: Revert and Close Editor",
        "View: Revert and Close Editor",
    );
}

/**
 * Clears every workbench notification, so no toast is left to cover later clicks. Opening the
 * publish script currently raises an error toast because the designer cannot hand its
 * connection to the new editor.
 */
export async function clearNotifications(page: Page): Promise<void> {
    await new QuickInput(page).runCommand(
        "Notifications: Clear All Notifications",
        "Notifications: Clear All Notifications",
    );
}

/**
 * Closes the designer tab titled `title` with its close button. A designer closed with
 * unpublished changes offers to restore itself; pass `declineRestorePrompt` to cancel that
 * modal prompt.
 */
export async function closeDesigner(
    page: Page,
    title: string,
    { declineRestorePrompt = false } = {},
): Promise<void> {
    const tab = page.getByRole("tab", { name: new RegExp(`^${escapeRegExp(title)}`) });
    await tab.click();
    await expect(tab).toHaveAttribute("aria-selected", "true");
    await tab.getByRole("button", { name: /^Close/ }).click();
    await expect(tab).toHaveCount(0);
    if (declineRestorePrompt) {
        const restorePrompt = page
            .getByRole("dialog")
            .filter({ hasText: "has been closed. Would you like to restore it?" });
        await restorePrompt.getByRole("button", { name: "Cancel" }).click();
        await expect(restorePrompt).toBeHidden();
    }
}

/**
 * A table's columns from INFORMATION_SCHEMA, mapped from name to a definition such as
 * "nvarchar(50) NULL".
 */
export async function getColumns(
    databaseName: string,
    tableName: string,
): Promise<Record<string, string>> {
    const [rows] = await runSql(
        `SELECT COLUMN_NAME, DATA_TYPE, CHARACTER_MAXIMUM_LENGTH, IS_NULLABLE
         FROM INFORMATION_SCHEMA.COLUMNS
         WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = '${tableName}'
         ORDER BY ORDINAL_POSITION`,
        databaseName,
    );
    return Object.fromEntries(
        (rows ?? []).map((row: SqlRow) => {
            const length = row.CHARACTER_MAXIMUM_LENGTH;
            const type = typeof length === "number" ? `${row.DATA_TYPE}(${length})` : row.DATA_TYPE;
            const nullability = row.IS_NULLABLE === "YES" ? "NULL" : "NOT NULL";
            return [row.COLUMN_NAME as string, `${type} ${nullability}`];
        }),
    );
}

/** Columns of a table's primary key, in key order. */
export async function getPrimaryKeyColumns(
    databaseName: string,
    tableName: string,
): Promise<string[]> {
    const [rows] = await runSql(
        `SELECT kcu.COLUMN_NAME
         FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS tc
         JOIN INFORMATION_SCHEMA.KEY_COLUMN_USAGE kcu
             ON kcu.CONSTRAINT_NAME = tc.CONSTRAINT_NAME AND kcu.TABLE_SCHEMA = tc.TABLE_SCHEMA
         WHERE tc.CONSTRAINT_TYPE = 'PRIMARY KEY'
             AND tc.TABLE_SCHEMA = 'dbo' AND tc.TABLE_NAME = '${tableName}'
         ORDER BY kcu.ORDINAL_POSITION`,
        databaseName,
    );
    return (rows ?? []).map((row: SqlRow) => row.COLUMN_NAME as string);
}

function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
