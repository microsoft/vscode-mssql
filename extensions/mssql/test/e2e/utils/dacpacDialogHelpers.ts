/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect, FrameLocator, Page } from "@playwright/test";
import * as fs from "fs";
import * as path from "path";
import {
    expandObjectExplorerPath,
    getObjectExplorerNode,
    runObjectExplorerContextAction,
    SEEDED_PROFILE_NAME,
} from "./seededConnection";
import { quoteName, runSql } from "./sqlClient";
import { getWebviewByTitle } from "./testHelpers";

/** Title of the DACPAC/BACPAC (Data-tier Application) webview panel. */
export const DACPAC_DIALOG_TITLE = "Data-tier Application";

/** Object Explorer context menu entry that opens the dialog. */
export const DACPAC_DIALOG_MENU_LABEL = "DACPAC/BACPAC Operations...";

/** Seed script for the source database: tables with keys, a view, a procedure and rows. */
export const DACPAC_SOURCE_SEED_SCRIPT = path.join(
    __dirname,
    "..",
    "..",
    "resources",
    "e2e",
    "dacpacDialog",
    "seedSource.sql",
);

/** Tables created by {@link DACPAC_SOURCE_SEED_SCRIPT}. */
export const DACPAC_SOURCE_TABLES = ["Customers", "Products", "Orders"];

/** A sample of the seeded objects, as reported by {@link getUserObjects}. */
export const DACPAC_SOURCE_OBJECTS = [
    "dbo.Orders (U)",
    "dbo.PK_Orders (PK)",
    "dbo.FK_Orders_Customers (F)",
    "dbo.vw_OrderTotals (V)",
    "dbo.usp_GetCustomerOrders (P)",
];

/** Accessible names of the dialog's operation radio buttons. */
export type DacpacOperation =
    | "Publish DACPAC"
    | "Extract DACPAC"
    | "Import BACPAC"
    | "Export BACPAC";

const OPERATION_TIMEOUT_MS = 3 * 60 * 1000;

/** Opens the dialog from a database's Object Explorer context menu. */
export async function openDacpacDialogFromObjectExplorer(
    page: Page,
    databaseName: string,
): Promise<FrameLocator> {
    await expandObjectExplorerPath(page, [SEEDED_PROFILE_NAME, "Databases"]);
    await runObjectExplorerContextAction(
        page,
        getObjectExplorerNode(page, databaseName),
        DACPAC_DIALOG_MENU_LABEL,
    );
    const dialog = await getWebviewByTitle(page, DACPAC_DIALOG_TITLE, 60 * 1000);
    await expect(dialog.getByRole("radiogroup", { name: "Operation" })).toBeVisible({
        timeout: 60 * 1000,
    });
    await expect(dialog.getByRole("combobox", { name: "Server" })).toHaveText(SEEDED_PROFILE_NAME, {
        timeout: 60 * 1000,
    });
    return dialog;
}

/** Selects an operation in the dialog's Operation radio group. */
export async function selectOperation(
    dialog: FrameLocator,
    operation: DacpacOperation,
): Promise<void> {
    const radio = dialog
        .getByRole("radiogroup", { name: "Operation" })
        .getByRole("radio", { name: operation, exact: true });
    await radio.check();
    await expect(radio).toBeChecked();
}

/**
 * Clicks Execute and waits for the operation to finish. On success the dialog clears its form, so
 * the emptied file path field (named "Package file" or "Output file") signals completion.
 */
export async function executeAndWaitForCompletion(
    dialog: FrameLocator,
    filePathField: "Package file" | "Output file",
): Promise<void> {
    const execute = dialog.getByRole("button", { name: "Execute", exact: true });
    await expect(execute).toBeEnabled({ timeout: 60 * 1000 });
    await execute.click();
    await expect(
        dialog.getByRole("textbox", { name: filePathField, exact: true }),
        "The dialog should clear its form once the operation succeeds.",
    ).toHaveValue("", { timeout: OPERATION_TIMEOUT_MS });
}

/**
 * Waits for the extension's success notification for an operation, then dismisses it so it does
 * not cover controls (such as the Schema Compare drawer's OK button) later on.
 */
export async function expectSuccessNotification(page: Page, message: string): Promise<void> {
    const toast = page.getByRole("dialog", { name: /notification/i }).filter({ hasText: message });
    await expect(toast).toBeVisible({ timeout: 60 * 1000 });
    // The toast only shows its toolbar while hovered or focused.
    await toast.hover();
    await toast.getByRole("button", { name: /^Clear Notification/ }).click();
    await expect(toast).toBeHidden();
}

/** Waits for the package file the dialog wrote to exist and be non-empty. */
export async function waitForPackageFile(filePath: string): Promise<void> {
    await expect
        .poll(() => (fs.existsSync(filePath) ? fs.statSync(filePath).size : 0), {
            timeout: OPERATION_TIMEOUT_MS,
            message: `Expected ${filePath} to be written.`,
        })
        .toBeGreaterThan(0);
}

/** User objects of a database as sorted "schema.name (type)" strings, for schema comparison. */
export async function getUserObjects(databaseName: string): Promise<string[]> {
    const [rows] = await runSql(
        `SELECT s.name AS schemaName, o.name AS objectName, RTRIM(o.type) AS objectType
FROM sys.objects AS o
    INNER JOIN sys.schemas AS s ON s.schema_id = o.schema_id
WHERE o.is_ms_shipped = 0;`,
        databaseName,
    );
    return rows.map((row) => `${row.schemaName}.${row.objectName} (${row.objectType})`).sort();
}

/** Row counts of the seeded tables in a database, keyed by table name. */
export async function getTableRowCounts(databaseName: string): Promise<Record<string, number>> {
    const counts: Record<string, number> = {};
    for (const table of DACPAC_SOURCE_TABLES) {
        const [rows] = await runSql(
            `SELECT COUNT(*) AS tableRows FROM dbo.${quoteName(table)};`,
            databaseName,
        );
        counts[table] = Number(rows[0].tableRows);
    }
    return counts;
}

/**
 * Counts rows of a seeded table that exist in only one of two databases (a symmetric EXCEPT), so
 * zero means both copies hold identical data.
 */
export async function countMismatchedRows(
    table: string,
    firstDatabase: string,
    secondDatabase: string,
): Promise<number> {
    const first = `${quoteName(firstDatabase)}.dbo.${quoteName(table)}`;
    const second = `${quoteName(secondDatabase)}.dbo.${quoteName(table)}`;
    const [rows] = await runSql(`SELECT COUNT(*) AS mismatched FROM (
    (SELECT * FROM ${first} EXCEPT SELECT * FROM ${second})
    UNION ALL
    (SELECT * FROM ${second} EXCEPT SELECT * FROM ${first})
) AS differences;`);
    return Number(rows[0].mismatched);
}
