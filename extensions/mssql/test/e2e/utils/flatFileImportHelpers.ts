/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as path from "path";
import { expect, FrameLocator, Locator, Page } from "@playwright/test";
import { QuickInput } from "../pageObjects/quickInput";
import {
    expandObjectExplorerPath,
    runObjectExplorerContextAction,
    SEEDED_PROFILE_NAME,
} from "./seededConnection";
import { runSql } from "./sqlClient";
import { getWebviewByTitle } from "./testHelpers";

/** Folder holding the CSV fixtures imported by the flat-file import suite. */
export const FLAT_FILE_FIXTURES = path.join(
    __dirname,
    "..",
    "..",
    "resources",
    "e2e",
    "flatFileImport",
);

const WIZARD_TITLE = "Import Flat File";
const WIZARD_LOAD_TIMEOUT_MS = 60 * 1000;
const IMPORT_TIMEOUT_MS = 2 * 60 * 1000;

/** A column of an imported table, as reported by INFORMATION_SCHEMA.COLUMNS. */
export interface ImportedColumn {
    name: string;
    dataType: string;
    /** Character length for string types; undefined for other types. */
    maxLength: number | undefined;
    isNullable: boolean;
}

/** Opens the flat-file import wizard from a database's Object Explorer context menu. */
export async function openImportWizard(page: Page, databaseName: string): Promise<FrameLocator> {
    const databaseNode = await expandObjectExplorerPath(
        page,
        [SEEDED_PROFILE_NAME, "Databases", databaseName],
        { expandLast: false },
    );
    await runObjectExplorerContextAction(page, databaseNode, "Import Data...");
    await expect(getWizardTab(page)).toBeVisible({ timeout: WIZARD_LOAD_TIMEOUT_MS });
    const wizard = await getWebviewByTitle(page, WIZARD_TITLE);
    await expect(wizard.getByRole("button", { name: "Browse", exact: true })).toBeVisible({
        timeout: WIZARD_LOAD_TIMEOUT_MS,
    });
    return wizard;
}

/**
 * Clicks Browse and answers VS Code's simple (HTML) open dialog, enabled by the seeded launch
 * config, with the absolute path of a fixture file.
 */
export async function browseForFile(
    page: Page,
    wizard: FrameLocator,
    filePath: string,
): Promise<void> {
    await wizard.getByRole("button", { name: "Browse", exact: true }).click();
    const pathInput = new QuickInput(page).input.filter({ visible: true });
    await expect(pathInput).toBeVisible({ timeout: 30 * 1000 });
    await pathInput.fill(filePath);
    await expect(pathInput).toHaveValue(filePath);
    await pathInput.press("Enter");
    await expect(pathInput).toBeHidden({ timeout: 30 * 1000 });
    await expect(
        wizard.getByRole("textbox", { name: "Location of the file to be imported", exact: true }),
    ).toHaveValue(filePath);
}

/** The wizard's New Table Name text box. */
export function getTableNameInput(wizard: FrameLocator): Locator {
    return wizard.getByRole("textbox", { name: "New Table Name", exact: true });
}

/** Clicks the wizard's footer button with the given label. */
export async function clickWizardButton(wizard: FrameLocator, label: string): Promise<void> {
    const button = wizard.getByRole("button", { name: label, exact: true });
    await expect(button).toBeEnabled();
    await button.click();
}

/** Moves from the input page to Preview Data and waits for the preview table. */
export async function goToPreviewData(wizard: FrameLocator): Promise<Locator> {
    await clickWizardButton(wizard, "Next");
    const preview = wizard.getByRole("table", { name: "Data preview", exact: true });
    await expect(preview).toBeVisible({ timeout: WIZARD_LOAD_TIMEOUT_MS });
    return preview;
}

/** Moves from Preview Data to Modify Columns and waits for the column settings table. */
export async function goToModifyColumns(wizard: FrameLocator): Promise<Locator> {
    await clickWizardButton(wizard, "Next");
    const columnSettings = wizard.getByRole("table", { name: "Column settings", exact: true });
    await expect(columnSettings).toBeVisible({ timeout: WIZARD_LOAD_TIMEOUT_MS });
    return columnSettings;
}

/** The Data Type dropdown for a column, labelled by the column name inferred from the file. */
export function getDataTypeDropdown(wizard: FrameLocator, columnName: string): Locator {
    return wizard.getByRole("button", { name: `Data type for ${columnName}`, exact: true });
}

/** The Primary Key checkbox for a column. */
export function getPrimaryKeyCheckbox(wizard: FrameLocator, columnName: string): Locator {
    return wizard.getByRole("checkbox", { name: `Primary key for ${columnName}`, exact: true });
}

/** The Allow Nulls checkbox for a column. */
export function getAllowNullsCheckbox(wizard: FrameLocator, columnName: string): Locator {
    return wizard.getByRole("checkbox", { name: `Allow nulls for ${columnName}`, exact: true });
}

/** Picks a new data type for a column on the Modify Columns page. */
export async function selectDataType(
    wizard: FrameLocator,
    columnName: string,
    dataType: string,
): Promise<void> {
    const dropdown = getDataTypeDropdown(wizard, columnName);
    await dropdown.click();
    // The option list is virtualized, so filter it down before picking.
    await wizard.getByRole("searchbox").fill(dataType);
    const options = wizard.getByRole("listbox", { name: `Data type for ${columnName}` });
    await options.getByRole("option", { name: dataType, exact: true }).click();
    await expect(dropdown).toHaveText(dataType);
}

/**
 * Clicks Import Data, waits for the Summary page to report success, then clicks Finish, which
 * closes the wizard.
 */
export async function importDataAndFinish(page: Page, wizard: FrameLocator): Promise<void> {
    await clickWizardButton(wizard, "Import Data");
    await expect(wizard.getByText("File imported successfully", { exact: true })).toBeVisible({
        timeout: IMPORT_TIMEOUT_MS,
    });
    await clickWizardButton(wizard, "Finish");
    await expect(getWizardTab(page)).toHaveCount(0);
}

function getWizardTab(page: Page): Locator {
    return page.getByRole("tab", { name: new RegExp(`^${WIZARD_TITLE}`) });
}

/** Columns of a table in ordinal order. */
export async function getImportedColumns(
    databaseName: string,
    tableName: string,
    schemaName = "dbo",
): Promise<ImportedColumn[]> {
    const [rows] = await runSql(
        `SELECT COLUMN_NAME, DATA_TYPE, CHARACTER_MAXIMUM_LENGTH, IS_NULLABLE
         FROM INFORMATION_SCHEMA.COLUMNS
         WHERE TABLE_SCHEMA = N'${schemaName}' AND TABLE_NAME = N'${tableName}'
         ORDER BY ORDINAL_POSITION`,
        databaseName,
    );
    return (rows ?? []).map((row) => ({
        name: row.COLUMN_NAME as string,
        dataType: row.DATA_TYPE as string,
        maxLength: (row.CHARACTER_MAXIMUM_LENGTH as number | undefined) ?? undefined,
        isNullable: row.IS_NULLABLE === "YES",
    }));
}

/** Key columns of a table's primary key in key order, or an empty array if it has none. */
export async function getPrimaryKeyColumns(
    databaseName: string,
    tableName: string,
    schemaName = "dbo",
): Promise<string[]> {
    const [rows] = await runSql(
        `SELECT c.name AS columnName
         FROM sys.key_constraints AS kc
         JOIN sys.index_columns AS ic
             ON ic.object_id = kc.parent_object_id AND ic.index_id = kc.unique_index_id
         JOIN sys.columns AS c
             ON c.object_id = ic.object_id AND c.column_id = ic.column_id
         WHERE kc.type = 'PK' AND kc.parent_object_id = OBJECT_ID(N'${schemaName}.${tableName}')
         ORDER BY ic.key_ordinal`,
        databaseName,
    );
    return (rows ?? []).map((row) => row.columnName as string);
}
