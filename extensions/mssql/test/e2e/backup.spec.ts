/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * E2E tests for Backup and Restore Database (local file only, no Azure/URL):
 *
 *  - Open the Backup Database dialog via Object Explorer context menu
 *  - Verify the dialog loads with the correct database pre-populated
 *  - Walk through the "Create New" file path workflow
 *  - Perform a backup via T-SQL BACKUP command (reliable in Docker)
 *  - Open the Restore Database dialog and verify it loads
 *  - Restore the backup via T-SQL and verify data integrity
 *
 * Complexity: Medium–Hard
 *
 * Backup/restore operations can take several minutes on Docker images.
 * Timeouts are set to 10 minutes for data operations.
 *
 * File paths use /var/opt/mssql/backup/ which is always writable inside
 * the SQL Server Docker container.
 */

import { FrameLocator, Page } from "@playwright/test";
import { screenshot, screenshotSetup } from "./utils/screenshotUtils";
import {
    addDatabaseConnection,
    enterTextIntoQueryEditor,
    executeQuery,
    openNewQueryEditor,
} from "./utils/testHelpers";
import {
    getAuthenticationType,
    getDatabaseName,
    getPassword,
    getProfileName,
    getSavePassword,
    getServerName,
    getUserName,
} from "./utils/envConfigReader";
import { test, expect } from "./baseFixtures";
import { useSharedVsCodeLifecycle } from "./utils/testLifecycle";
import {
    expandObjectExplorerNode,
    rightClickObjectExplorerNode,
    clickContextMenuItem,
    waitForConnectionReady,
} from "./utils/objectExplorerHelpers";

const BACKUP_SOURCE_DB = "E2EBackupSourceDB";
const RESTORE_TARGET_DB = "E2ERestoreTargetDB";

/**
 * Waits for an ObjectManagementDialog to finish loading by polling for its
 * primary action button (e.g. "Backup" or "Restore"). Returns the FrameLocator
 * for the dialog so callers can continue interacting with it.
 *
 * Performs its own frame-tree walk to find the specific outer webview host
 * frame that contains an <iframe title="dialogTitle"> element, then builds a
 * frameLocator keyed on that frame's unique name GUID. This avoids the
 * strict-mode "resolved to N elements" error that occurs when multiple webview
 * panels (e.g. query results + this dialog) are open simultaneously.
 */
/**
 * Waits for an ObjectManagementDialog to finish loading by polling for its
 * primary action button (e.g. "Backup" or "Restore"). Returns the FrameLocator
 * for the dialog so callers can continue interacting with it.
 *
 * Performs its own frame-tree walk to find the specific outer webview host
 * frame that contains an <iframe title="dialogTitle"> element, then builds a
 * frameLocator keyed on that frame's unique name GUID. This avoids the
 * strict-mode "resolved to N elements" error that occurs when multiple webview
 * panels (e.g. query results + this dialog) are open simultaneously.
 *
 * The loop is necessary because the webview may not yet be in page.frames()
 * when this is first called — we keep retrying until the frame appears and
 * the primary button is visible inside it.
 */
async function waitForObjectManagementDialog(
    vsCodePage: Page,
    dialogTitle: string,
    primaryButtonLabel: string,
    timeoutMs = 60 * 1000,
): Promise<FrameLocator> {
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
        for (const frame of vsCodePage.frames()) {
            try {
                const found = await frame.evaluate(
                    (t) => !!document.querySelector(`iframe[title="${t}"]`),
                    dialogTitle,
                );
                if (found && frame.name()) {
                    const iframe = vsCodePage
                        .frameLocator(`iframe[name="${frame.name()}"]`)
                        .frameLocator(`[title='${dialogTitle}']`);

                    if (
                        await iframe
                            .getByRole("button", { name: primaryButtonLabel, exact: true })
                            .isVisible()
                            .catch(() => false)
                    ) {
                        return iframe;
                    }
                }
            } catch {
                // Frame not yet accessible — keep polling.
            }
        }
        await new Promise((resolve) => setTimeout(resolve, 300));
    }

    throw new Error(
        `Timed out after ${timeoutMs}ms waiting for "${dialogTitle}" dialog with "${primaryButtonLabel}" button`,
    );
}

test.describe("MSSQL Extension - Backup and Restore", async () => {
    // useSharedVsCodeLifecycle MUST be called here at describe scope — it registers
    // test.beforeAll / afterEach / afterAll hooks during the describe phase.
    // Never call it inside a test body or a helper function invoked from a test.
    const getContext = useSharedVsCodeLifecycle({
        afterLaunch: async ({ page: vsCodePage }) => {
            await addDatabaseConnection(
                vsCodePage,
                getServerName(),
                getDatabaseName(),
                getAuthenticationType(),
                getUserName(),
                getPassword(),
                getSavePassword(),
                getProfileName(),
            );

            await screenshotSetup(vsCodePage, "backup-after-add-connection");

            await waitForConnectionReady(vsCodePage, getServerName());
            await screenshotSetup(vsCodePage, "backup-connection-ready");

            // Create the source database with a small amount of data
            await openNewQueryEditor(vsCodePage, getServerName());
            await screenshotSetup(vsCodePage, "backup-query-editor-opened");

            const setup = `
USE master;\n
IF DB_ID(N'${BACKUP_SOURCE_DB}') IS NOT NULL\n
BEGIN\n
    ALTER DATABASE [${BACKUP_SOURCE_DB}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE;\n
    DROP DATABASE [${BACKUP_SOURCE_DB}];\n
END\n
CREATE DATABASE [${BACKUP_SOURCE_DB}];\n
USE [${BACKUP_SOURCE_DB}];\n
CREATE TABLE [dbo].[SalesData] (\n
    SaleId  INT           NOT NULL PRIMARY KEY,\n
    Amount  DECIMAL(10,2) NOT NULL\n
);\n
INSERT INTO [dbo].[SalesData] (SaleId, Amount)\n
VALUES (1, 100.00), (2, 250.50), (3, 75.25);`;
            await enterTextIntoQueryEditor(vsCodePage, setup);
            await executeQuery(vsCodePage);
            await new Promise((resolve) => setTimeout(resolve, 3 * 1000));
        },
        beforeClose: async ({ page: vsCodePage }) => {
            await openNewQueryEditor(vsCodePage);
            const cleanup = `
USE master;
IF DB_ID(N'${BACKUP_SOURCE_DB}') IS NOT NULL
BEGIN
    ALTER DATABASE [${BACKUP_SOURCE_DB}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE;
    DROP DATABASE [${BACKUP_SOURCE_DB}];
END
IF DB_ID(N'${RESTORE_TARGET_DB}') IS NOT NULL
BEGIN
    ALTER DATABASE [${RESTORE_TARGET_DB}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE;
    DROP DATABASE [${RESTORE_TARGET_DB}];
END`;
            await enterTextIntoQueryEditor(vsCodePage, cleanup);
            await executeQuery(vsCodePage);
            await new Promise((resolve) => setTimeout(resolve, 5 * 1000));
        },
    });

    // Screenshots of the initial state can be taken here in beforeEach, which
    // does have access to testInfo, unlike afterLaunch (which runs in beforeAll).
    test.beforeEach(async ({}, testInfo) => {
        const { page: vsCodePage } = getContext();
        await screenshot(vsCodePage, testInfo, "setup-complete");
    });

    test("Backup database dialog opens with correct database pre-populated", async ({}, testInfo) => {
        const { page: vsCodePage } = getContext();

        await expandObjectExplorerNode(vsCodePage, getServerName(), 30 * 1000);
        await expandObjectExplorerNode(vsCodePage, "Databases", 20 * 1000);
        await screenshot(vsCodePage, testInfo, "oe-expanded");

        await rightClickObjectExplorerNode(vsCodePage, BACKUP_SOURCE_DB, 20 * 1000);
        await screenshot(vsCodePage, testInfo, "context-menu-visible");
        await clickContextMenuItem(vsCodePage, "Backup");
        await screenshot(vsCodePage, testInfo, "backup-dialog-opening");

        // Dialog webview title includes the database name
        const iframe = await waitForObjectManagementDialog(
            vsCodePage,
            `Backup Database (Preview) - ${BACKUP_SOURCE_DB}`,
            "Backup",
            60 * 1000,
        );
        await screenshot(vsCodePage, testInfo, "backup-dialog-loaded");

        // Database name should appear in the dialog subtitle area
        await expect(iframe.getByText(BACKUP_SOURCE_DB).first()).toBeVisible({
            timeout: 15 * 1000,
        });

        await iframe.getByRole("button", { name: "Cancel", exact: true }).click();
    });

    test("Backup dialog shows Save to Disk and Create New controls", async ({}, testInfo) => {
        const { page: vsCodePage } = getContext();

        await expandObjectExplorerNode(vsCodePage, getServerName(), 30 * 1000);
        await expandObjectExplorerNode(vsCodePage, "Databases", 20 * 1000);
        await rightClickObjectExplorerNode(vsCodePage, BACKUP_SOURCE_DB, 20 * 1000);
        await clickContextMenuItem(vsCodePage, "Backup");

        const iframe = await waitForObjectManagementDialog(
            vsCodePage,
            `Backup Database (Preview) - ${BACKUP_SOURCE_DB}`,
            "Backup",
            60 * 1000,
        );
        await screenshot(vsCodePage, testInfo, "backup-dialog-loaded");

        // "Save to Disk" radio must be present (and is the default)
        const saveToDiskRadio = iframe.getByRole("radio", { name: "Save to Disk" });
        await expect(saveToDiskRadio).toBeVisible({ timeout: 10 * 1000 });

        // "Save to URL" radio (Azure — we won't use it, but it should exist)
        const saveToUrlRadio = iframe.getByRole("radio", { name: "Save to URL" });
        await expect(saveToUrlRadio).toBeVisible({ timeout: 10 * 1000 });

        // "Create New" button for adding a backup file path
        const createNewButton = iframe.getByRole("button", { name: "Create New" });
        await expect(createNewButton).toBeVisible({ timeout: 10 * 1000 });

        await screenshot(vsCodePage, testInfo, "backup-controls-verified");

        await iframe.getByRole("button", { name: "Cancel", exact: true }).click();
    });

    test("Backup database succeeds via T-SQL BACKUP command", async ({}, testInfo) => {
        const { page: vsCodePage } = getContext();

        await openNewQueryEditor(vsCodePage);

        // Use SQL Server's default backup directory (always writable in Docker at
        // /var/opt/mssql/backup). xp_instance_regread falls back to that path if
        // the registry key is absent (Linux Docker containers have no registry).
        const backupScript = `
USE master;
DECLARE @BackupPath NVARCHAR(500);
DECLARE @FileName   NVARCHAR(500);

EXEC master.dbo.xp_instance_regread
    N'HKEY_LOCAL_MACHINE',
    N'Software\\Microsoft\\MSSQLServer\\MSSQLServer',
    N'BackupDirectory',
    @BackupPath OUTPUT;

IF @BackupPath IS NULL OR @BackupPath = ''
    SET @BackupPath = '/var/opt/mssql/backup';

SET @FileName = @BackupPath + '/E2EBackup_${BACKUP_SOURCE_DB}.bak';

BACKUP DATABASE [${BACKUP_SOURCE_DB}]
TO DISK = @FileName
WITH FORMAT, INIT, NAME = N'E2E Test Backup', COMPRESSION;

SELECT 'BACKUP_SUCCESS' AS result, @FileName AS backup_path;`;

        await enterTextIntoQueryEditor(vsCodePage, backupScript);
        await screenshot(vsCodePage, testInfo, "backup-script-typed");
        await executeQuery(vsCodePage);
        await screenshot(vsCodePage, testInfo, "backup-executed");

        await expect(vsCodePage.getByText("BACKUP_SUCCESS")).toBeVisible({
            timeout: 10 * 60 * 1000,
        });
        await screenshot(vsCodePage, testInfo, "backup-succeeded");
    });

    test("Restore database dialog opens correctly", async ({}, testInfo) => {
        const { page: vsCodePage } = getContext();

        // Restore is available at the server level in the OE context menu
        await expandObjectExplorerNode(vsCodePage, getServerName(), 30 * 1000);
        await screenshot(vsCodePage, testInfo, "server-expanded");

        await rightClickObjectExplorerNode(vsCodePage, getServerName(), 20 * 1000);
        await screenshot(vsCodePage, testInfo, "server-context-menu");
        await clickContextMenuItem(vsCodePage, "Restore");
        await screenshot(vsCodePage, testInfo, "restore-dialog-opening");

        const iframe = await waitForObjectManagementDialog(
            vsCodePage,
            "Restore Database (Preview)",
            "Restore",
            60 * 1000,
        );
        await screenshot(vsCodePage, testInfo, "restore-dialog-loaded");

        // Source type options should both be present
        await expect(iframe.getByRole("radio", { name: "Database" })).toBeVisible({
            timeout: 15 * 1000,
        });
        await expect(iframe.getByRole("radio", { name: "Backup File" })).toBeVisible({
            timeout: 15 * 1000,
        });

        await iframe.getByRole("button", { name: "Cancel", exact: true }).click();
        await screenshot(vsCodePage, testInfo, "restore-cancelled");
    });

    test("Restore database from T-SQL backup succeeds", async ({}, testInfo) => {
        const { page: vsCodePage } = getContext();

        // Step 1: create a fresh backup to restore from
        await openNewQueryEditor(vsCodePage);
        const backupScript = `
USE master;
DECLARE @BackupPath NVARCHAR(500);

EXEC master.dbo.xp_instance_regread
    N'HKEY_LOCAL_MACHINE',
    N'Software\\Microsoft\\MSSQLServer\\MSSQLServer',
    N'BackupDirectory',
    @BackupPath OUTPUT;

IF @BackupPath IS NULL OR @BackupPath = ''
    SET @BackupPath = '/var/opt/mssql/backup';

DECLARE @FileName NVARCHAR(500) = @BackupPath + '/E2EBackup_${BACKUP_SOURCE_DB}.bak';

BACKUP DATABASE [${BACKUP_SOURCE_DB}]
TO DISK = @FileName
WITH FORMAT, INIT, NAME = N'E2E Restore Test Backup', COMPRESSION;

SELECT 'BACKUP_DONE' AS step, @FileName AS backup_file;`;
        await enterTextIntoQueryEditor(vsCodePage, backupScript);
        await executeQuery(vsCodePage);
        await screenshot(vsCodePage, testInfo, "backup-for-restore-done");
        await expect(vsCodePage.getByText("BACKUP_DONE")).toBeVisible({ timeout: 10 * 60 * 1000 });

        // Step 2: restore to a new database name
        await openNewQueryEditor(vsCodePage);
        const restoreScript = `
USE master;
IF DB_ID(N'${RESTORE_TARGET_DB}') IS NOT NULL
BEGIN
    ALTER DATABASE [${RESTORE_TARGET_DB}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE;
    DROP DATABASE [${RESTORE_TARGET_DB}];
END

DECLARE @BackupPath NVARCHAR(500);
EXEC master.dbo.xp_instance_regread
    N'HKEY_LOCAL_MACHINE',
    N'Software\\Microsoft\\MSSQLServer\\MSSQLServer',
    N'BackupDirectory',
    @BackupPath OUTPUT;
IF @BackupPath IS NULL OR @BackupPath = ''
    SET @BackupPath = '/var/opt/mssql/backup';

DECLARE @FileName    NVARCHAR(500) = @BackupPath + '/E2EBackup_${BACKUP_SOURCE_DB}.bak';
DECLARE @DefaultData NVARCHAR(500);
DECLARE @DefaultLog  NVARCHAR(500);

EXEC master.dbo.xp_instance_regread
    N'HKEY_LOCAL_MACHINE',
    N'Software\\Microsoft\\MSSQLServer\\MSSQLServer',
    N'DefaultData',
    @DefaultData OUTPUT;
IF @DefaultData IS NULL OR @DefaultData = ''
    SET @DefaultData = '/var/opt/mssql/data';

EXEC master.dbo.xp_instance_regread
    N'HKEY_LOCAL_MACHINE',
    N'Software\\Microsoft\\MSSQLServer\\MSSQLServer',
    N'DefaultLog',
    @DefaultLog OUTPUT;
IF @DefaultLog IS NULL OR @DefaultLog = ''
    SET @DefaultLog = '/var/opt/mssql/data';

RESTORE DATABASE [${RESTORE_TARGET_DB}]
FROM DISK = @FileName
WITH MOVE N'${BACKUP_SOURCE_DB}'     TO @DefaultData + '/${RESTORE_TARGET_DB}.mdf',
     MOVE N'${BACKUP_SOURCE_DB}_log' TO @DefaultLog  + '/${RESTORE_TARGET_DB}_log.ldf',
     REPLACE;

SELECT 'RESTORE_SUCCESS' AS result;`;

        await enterTextIntoQueryEditor(vsCodePage, restoreScript);
        await screenshot(vsCodePage, testInfo, "restore-script-typed");
        await executeQuery(vsCodePage);
        await screenshot(vsCodePage, testInfo, "restore-executing");

        await expect(vsCodePage.getByText("RESTORE_SUCCESS")).toBeVisible({
            timeout: 10 * 60 * 1000,
        });
        await screenshot(vsCodePage, testInfo, "restore-succeeded");

        // Step 3: verify the restored database contains the original data
        await openNewQueryEditor(vsCodePage);
        const verifyScript = `
USE [${RESTORE_TARGET_DB}];
SELECT COUNT(*) AS row_count FROM [dbo].[SalesData];`;
        await enterTextIntoQueryEditor(vsCodePage, verifyScript);
        await executeQuery(vsCodePage);
        await screenshot(vsCodePage, testInfo, "restored-data-verified");

        // Should have 3 rows matching the original INSERT
        await expect(vsCodePage.getByText("3")).toBeVisible({ timeout: 15 * 1000 });
    });
});
