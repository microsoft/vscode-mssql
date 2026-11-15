/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect, FrameLocator, Locator, Page } from "@playwright/test";
import * as fs from "fs";
import * as path from "path";
import { expectSuccessNotification } from "./dacpacDialogHelpers";
import { VsCodeAppHandle } from "./launchVscodeWithMsSqlExt";
import {
    expandObjectExplorerPath,
    getObjectExplorerNode,
    runObjectExplorerContextAction,
    SEEDED_PROFILE_NAME,
} from "./seededConnection";
import {
    getModifierKey,
    getWebviewByTitle,
    readClipboard,
    withClipboardLock,
    writeClipboard,
} from "./testHelpers";

const DESIGNER_MENU_LABEL = "Visualize and Design Schema...";
const SCHEMA_LOAD_TIMEOUT_MS = 2 * 60 * 1000;

/** Reads the seed script that creates the dbo and Sales tables the canvas tests use. */
export function readSeedScript(): string {
    return fs.readFileSync(
        path.join(__dirname, "..", "..", "resources", "e2e", "schemaDesignerCanvas", "seed.sql"),
        "utf8",
    );
}

/** Title of the Schema Designer editor tab for a database. */
export function getDesignerTitle(databaseName: string): string {
    return `Visualize and Design Schema - ${databaseName}`;
}

/** The diagram canvas (React Flow names its root "application"). */
export function getCanvas(frame: FrameLocator): Locator {
    return frame.getByRole("application");
}

/** A table node on the diagram canvas. */
export function getTableNode(frame: FrameLocator, qualifiedName: string): Locator {
    return getCanvas(frame).getByRole("group", { name: `Table ${qualifiedName}`, exact: true });
}

/** Every table node currently rendered on the canvas. Hidden (filtered) tables are not rendered. */
export function getTableNodes(frame: FrameLocator): Locator {
    return getCanvas(frame).getByRole("group", { name: /^Table / });
}

/** A column row inside a table node, named for the column and its data type. */
export function getColumnNode(table: Locator, columnName: string, dataType: string): Locator {
    return table.getByRole("group", {
        name: `Column ${columnName}, type ${dataType}`,
        exact: true,
    });
}

/** Foreign key edges; React Flow names each one for the nodes it connects. */
export function getRelationshipEdges(frame: FrameLocator): Locator {
    return getCanvas(frame).getByRole("group", { name: /^Edge from / });
}

/**
 * The table node React Flow currently has selected. React Flow only exposes selection through its
 * documented `selected` class on the node wrapper, so this is the one CSS-based locator.
 */
export function getSelectedTableNode(frame: FrameLocator): Locator {
    return getCanvas(frame)
        .locator(".react-flow__node.selected")
        .getByRole("group", {
            name: /^Table /,
        });
}

/** Expects the visible tables to be exactly the given schema-qualified names. */
export async function expectVisibleTables(frame: FrameLocator, names: string[]): Promise<void> {
    await expect(getTableNodes(frame)).toHaveCount(names.length);
    for (const name of names) {
        await expect(getTableNode(frame, name)).toBeVisible();
    }
}

/**
 * Opens the Schema Designer for a database from Object Explorer and waits for the diagram to show
 * the given table.
 */
export async function openSchemaDesigner(
    page: Page,
    databaseName: string,
    firstTable: string,
): Promise<FrameLocator> {
    await expandObjectExplorerPath(page, [SEEDED_PROFILE_NAME, "Databases"]);
    await runObjectExplorerContextAction(
        page,
        getObjectExplorerNode(page, databaseName),
        DESIGNER_MENU_LABEL,
    );
    const frame = await getWebviewByTitle(page, getDesignerTitle(databaseName));
    await expect(getTableNode(frame, firstTable)).toBeVisible({ timeout: SCHEMA_LOAD_TIMEOUT_MS });
    return frame;
}

/**
 * Closes the Schema Designer tab. A designer with unpublished edits asks whether to restore it;
 * pass `discardChanges` to answer Cancel so the edits are dropped.
 */
export async function closeSchemaDesigner(
    page: Page,
    databaseName: string,
    discardChanges: boolean,
): Promise<void> {
    const tab = page.getByRole("tab", { name: getDesignerTitle(databaseName) });
    if ((await tab.count()) > 0) {
        await tab.hover();
        await tab.getByRole("button", { name: /^Close/ }).click();
        await expect(tab).toHaveCount(0);
    }
    if (discardChanges) {
        const restorePrompt = page.getByRole("dialog").filter({
            has: page.getByRole("button", { name: "Restore" }),
        });
        await expect(restorePrompt).toBeVisible();
        await restorePrompt.getByRole("button", { name: "Cancel" }).click();
        await expect(restorePrompt).toBeHidden();
    }
}

/**
 * The toolbar's Filter button. Its menu trigger wraps the button and repeats its name, so match
 * the element that carries the label itself.
 */
export function getFilterButton(frame: FrameLocator): Locator {
    return frame.getByRole("button").and(frame.getByLabel(/^Filter( \(\d+\))?$/));
}

/** Opens the table filter menu and returns its schema/table checklist. */
export async function openTableFilter(frame: FrameLocator): Promise<Locator> {
    await getFilterButton(frame).click();
    const checklist = frame.getByRole("tree", { name: "Tables to show" });
    await expect(checklist).toBeVisible();
    return checklist;
}

/**
 * Toggles a schema or table in the filter checklist. Fluent's tree hides the visual checkbox from
 * assistive technology, so toggle the item the way a keyboard user would.
 */
export async function toggleFilterItem(checklist: Locator, name: string): Promise<void> {
    const item = checklist.getByRole("treeitem", { name, exact: true });
    const wasChecked = (await item.getAttribute("aria-checked")) === "true";
    await item.press("Space");
    await expect(item).toBeChecked({ checked: !wasChecked });
}

/** Opens the Find Tables widget with the platform find shortcut and returns its search box. */
export async function openFindTables(frame: FrameLocator, page: Page): Promise<Locator> {
    // The shortcut only applies while focus is inside the designer.
    await getCanvas(frame).getByRole("button", { name: "Fit View" }).focus();
    await page.keyboard.press(`${getModifierKey()}+f`);
    const searchBox = frame
        .getByRole("search", { name: "Find tables" })
        .getByRole("searchbox", { name: "Find tables" });
    await expect(searchBox).toBeFocused();
    return searchBox;
}

/** Opens the Definition panel from the toolbar and returns its Definition type picker. */
export async function openDefinitionPanel(frame: FrameLocator): Promise<Locator> {
    await frame.getByRole("button", { name: "Show Definition" }).click();
    await expect(frame.getByRole("button", { name: "Hide Definition" })).toBeVisible();
    await expect(frame.getByRole("tab", { name: "Definition", selected: true })).toBeVisible();
    const definitionType = frame.getByRole("radiogroup", { name: "Definition type" });
    await expect(definitionType).toBeVisible();
    return definitionType;
}

/** The read-only editor that renders the definition. */
export function getDefinitionEditor(frame: FrameLocator): Locator {
    return frame.getByRole("code");
}

/**
 * Copies the Definition panel's script with its Copy button and returns it. The editor only
 * renders the lines in view, so the clipboard is the reliable way to read the whole script.
 */
export async function copyDefinition(
    app: VsCodeAppHandle,
    page: Page,
    frame: FrameLocator,
): Promise<string> {
    const text = await withClipboardLock(async () => {
        await writeClipboard(app, "");
        await frame.getByRole("button", { name: "Copy", exact: true }).click();
        let copied = "";
        await expect
            .poll(async () => (copied = await readClipboard(app)), { timeout: 30 * 1000 })
            .not.toBe("");
        return copied;
    });
    await expectSuccessNotification(page, "Copied");
    return text;
}

/** A column row in the Add/Edit Table dialog, found by the value of its name text box. */
export function getEditorColumnRow(dialog: Locator, columnName: string): Locator {
    // A row's accessible name starts with the value of its Column Name text box.
    return dialog.getByRole("row", { name: new RegExp(`^${columnName}\\b`) });
}

/**
 * Opens the Edit Table dialog from a table node's toolbar. The button is activated from the
 * keyboard because the minimap or controls can overlap a node on a small canvas.
 */
export async function openEditTable(frame: FrameLocator, qualifiedName: string): Promise<Locator> {
    await getTableNode(frame, qualifiedName)
        .getByRole("button", { name: "Edit Table" })
        .press("Enter");
    const dialog = frame.getByRole("dialog", { name: "Edit Table" });
    await expect(dialog).toBeVisible();
    return dialog;
}

/** Picks an option in one of the dialog's searchable dropdowns. */
export async function selectDropdownOption(
    frame: FrameLocator,
    dropdown: Locator,
    listboxName: string,
    option: string,
): Promise<void> {
    await dropdown.click();
    const listbox = frame.getByRole("listbox", { name: listboxName });
    await expect(listbox).toBeVisible();
    // The list is virtualized, so narrow it before picking.
    await frame.getByRole("searchbox").fill(option);
    await listbox.getByRole("option", { name: option, exact: true }).click();
    await expect(dropdown).toHaveText(option);
}

/** Changes a column's data type through its "Type for <column>" dropdown. */
export async function setColumnType(
    frame: FrameLocator,
    dialog: Locator,
    columnName: string,
    dataType: string,
): Promise<void> {
    const name = `Type for ${columnName}`;
    await selectDropdownOption(
        frame,
        getEditorColumnRow(dialog, columnName).getByRole("button", { name }),
        name,
        dataType,
    );
}

/** Adds a column with the given name and type in the Add/Edit Table dialog. */
export async function addColumn(
    frame: FrameLocator,
    dialog: Locator,
    columnName: string,
    dataType: string,
): Promise<void> {
    await dialog.getByRole("button", { name: "Add new column" }).click();
    const newRow = dialog.getByRole("row", { name: /^column_\d+\b/ });
    await expect(newRow).toBeVisible();
    await newRow.getByRole("textbox", { name: "Column Name" }).fill(columnName);
    await setColumnType(frame, dialog, columnName, dataType);
}

/** Saves the Edit Table dialog and waits for it to close. */
export async function saveTable(dialog: Locator): Promise<void> {
    await dialog.getByRole("button", { name: "Save" }).click();
    await expect(dialog).toBeHidden();
}
