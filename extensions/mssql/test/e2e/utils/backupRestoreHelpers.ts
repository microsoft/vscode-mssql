/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect, FrameLocator, Locator, Page } from "@playwright/test";
import {
    expandObjectExplorerPath,
    runObjectExplorerContextAction,
    SEEDED_PROFILE_NAME,
} from "./seededConnection";
import { querySingleValue, quoteName, runSql } from "./sqlClient";
import { getWebviewByTitle } from "./testHelpers";

/** Backup types as stored in `msdb.dbo.backupset.type`. */
export type BackupSetType = "D" | "I" | "L";

/** One backup set of a database, with whether its file still exists on the server. */
export interface BackupHistoryRow {
    backupSetId: number;
    type: BackupSetType;
    physicalDeviceName: string;
    fileExists: boolean;
}

/** Number of rows {@link seedBackupSourceDatabase} inserts into `dbo.SeedRows`. */
export const SEEDED_ROW_COUNT = 3;

const BACKUP_DIALOG_TIMEOUT_MS = 60 * 1000;
const BACKGROUND_TASK_TIMEOUT_MS = 2 * 60 * 1000;

/**
 * The server's default backup folder, which is on the SQL Server host's filesystem rather than
 * the machine running the tests.
 */
export async function getDefaultBackupFolder(): Promise<string> {
    const folder = await querySingleValue<string>(
        "SELECT CAST(SERVERPROPERTY('InstanceDefaultBackupPath') AS nvarchar(4000))",
    );
    if (!folder) {
        throw new Error("The server did not report an InstanceDefaultBackupPath.");
    }
    return folder;
}

/**
 * Joins a server-side folder and file name using the server's own separator, since the server
 * may run a different OS from the test machine.
 */
export function joinServerPath(folder: string, fileName: string): string {
    const separator = folder.includes("\\") && !folder.includes("/") ? "\\" : "/";
    return folder.endsWith(separator) ? `${folder}${fileName}` : `${folder}${separator}${fileName}`;
}

/**
 * Creates a database in the FULL recovery model with a few rows of data and takes a full
 * backup of it, so differential and log backups have a base to build on.
 *
 * @returns The server-side path of the full backup file.
 */
export async function seedBackupSourceDatabase(databaseName: string): Promise<string> {
    const backupPath = joinServerPath(await getDefaultBackupFolder(), `${databaseName}-seed.bak`);
    await runSql(`
CREATE DATABASE ${quoteName(databaseName)};
GO
ALTER DATABASE ${quoteName(databaseName)} SET RECOVERY FULL;`);
    await runSql(
        `
CREATE TABLE dbo.SeedRows (Id int NOT NULL PRIMARY KEY, Label nvarchar(50) NOT NULL);
INSERT INTO dbo.SeedRows (Id, Label) VALUES (1, N'alpha'), (2, N'beta'), (3, N'gamma');`,
        databaseName,
    );
    await runSql(
        `BACKUP DATABASE ${quoteName(databaseName)} TO DISK = N'${escapeLiteral(backupPath)}' WITH INIT, FORMAT;`,
    );
    return backupPath;
}

/** Every backup set msdb records for a database, oldest first. */
export async function getBackupHistory(databaseName: string): Promise<BackupHistoryRow[]> {
    const [rows = []] = await runSql(`
SELECT bs.backup_set_id AS backupSetId,
       bs.type AS type,
       bmf.physical_device_name AS physicalDeviceName,
       CAST(fe.file_exists AS bit) AS fileExists
FROM msdb.dbo.backupset bs
JOIN msdb.dbo.backupmediafamily bmf ON bmf.media_set_id = bs.media_set_id
CROSS APPLY sys.dm_os_file_exists(bmf.physical_device_name) fe
WHERE bs.database_name = N'${escapeLiteral(databaseName)}'
ORDER BY bs.backup_set_id;`);
    return rows as unknown as BackupHistoryRow[];
}

/** Whether a database exists on the server. */
export async function databaseExists(databaseName: string): Promise<boolean> {
    const id = await querySingleValue<number>(`SELECT DB_ID(N'${escapeLiteral(databaseName)}')`);
    return typeof id === "number";
}

/** Number of rows in a restored copy of the seeded `dbo.SeedRows` table. */
export async function countSeededRows(databaseName: string): Promise<number | undefined> {
    return querySingleValue<number>("SELECT COUNT(*) FROM dbo.SeedRows", databaseName);
}

/** Reveals a database node under the seeded server in Object Explorer. */
export function revealDatabaseNode(page: Page, databaseName: string): Promise<Locator> {
    return expandObjectExplorerPath(page, [SEEDED_PROFILE_NAME, "Databases", databaseName], {
        expandLast: false,
    });
}

/** Opens the Backup Database dialog from a database's context menu and waits for it to load. */
export async function openBackupDialog(page: Page, databaseName: string): Promise<FrameLocator> {
    const databaseNode = await revealDatabaseNode(page, databaseName);
    await runObjectExplorerContextAction(page, databaseNode, "Backup Database...");
    const dialog = await getWebviewByTitle(page, `Backup Database - ${databaseName}`);
    await expect(dialog.getByRole("button", { name: "Backup", exact: true })).toBeVisible({
        timeout: BACKUP_DIALOG_TIMEOUT_MS,
    });
    return dialog;
}

/** Picks a backup type in the Backup Database dialog and waits for the form to reflect it. */
export async function selectBackupType(
    dialog: FrameLocator,
    backupType: "Full" | "Differential" | "Transaction Log",
): Promise<void> {
    const backupTypeDropdown = dialog.getByRole("combobox", { name: "Backup Type" });
    await backupTypeDropdown.click();
    await dialog.getByRole("option", { name: backupType, exact: true }).click();
    await expect(backupTypeDropdown).toHaveText(backupType);
}

/** Opens the Restore Database dialog from a database's context menu and waits for it to load. */
export async function openRestoreDialog(page: Page, databaseName: string): Promise<FrameLocator> {
    const databaseNode = await revealDatabaseNode(page, databaseName);
    await runObjectExplorerContextAction(page, databaseNode, "Restore Database...");
    const dialog = await getWebviewByTitle(page, "Restore Database");
    await expect(dialog.getByRole("button", { name: "Restore", exact: true })).toBeVisible({
        timeout: BACKUP_DIALOG_TIMEOUT_MS,
    });
    return dialog;
}

/** The extension's Background Tasks view, expanded. */
export async function getBackgroundTasksView(page: Page): Promise<Locator> {
    const tasksView = page.locator(".pane").filter({
        has: page.getByRole("heading", { name: "Background Tasks", exact: true }),
    });
    // The view's collapsible header is exposed as a button carrying the expanded state.
    const header = tasksView.getByRole("button", { name: /^Background Tasks/ });
    await expect(header).toBeVisible();
    if ((await header.getAttribute("aria-expanded")) !== "true") {
        await header.click();
    }
    await expect(header).toHaveAttribute("aria-expanded", "true");
    return tasksView;
}

/**
 * Waits for a task in the Background Tasks view to complete successfully.
 *
 * Tasks are identified by their name plus text unique to the run, such as the database name, so
 * tasks left behind by earlier tests in the same VS Code instance cannot satisfy the wait.
 */
export async function waitForBackgroundTaskSucceeded(
    page: Page,
    taskName: string,
    identifyingText: string,
    timeout = BACKGROUND_TASK_TIMEOUT_MS,
): Promise<Locator> {
    const tasksView = await getBackgroundTasksView(page);
    const task = tasksView
        .getByRole("treeitem")
        .filter({ hasText: taskName })
        .filter({ hasText: identifyingText });
    await expect(task).toHaveCount(1, { timeout });
    // The tooltip, which carries the status and final message, doubles as the accessible name.
    await expect(task).toHaveAttribute("aria-label", /Succeeded/, { timeout });
    return task;
}

function escapeLiteral(value: string): string {
    return value.replace(/'/g, "''");
}
