/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { FrameLocator, Locator, Page } from "@playwright/test";
import { expect, test } from "./baseFixtures";
import { QuickInput } from "./pageObjects/quickInput";
import {
    BackupHistoryRow,
    BackupSetType,
    countSeededRows,
    databaseExists,
    getBackupHistory,
    getDefaultBackupFolder,
    openBackupDialog,
    openRestoreDialog,
    seedBackupSourceDatabase,
    SEEDED_ROW_COUNT,
    selectBackupType,
    waitForBackgroundTaskSucceeded,
} from "./utils/backupRestoreHelpers";
import { getServerName } from "./utils/envConfigReader";
import {
    connectActiveEditor,
    getActiveEditorText,
    getSeededLaunchConfig,
} from "./utils/seededConnection";
import { dropDatabaseIfExists, uniqueDatabaseName } from "./utils/sqlClient";
import { testCases } from "./utils/testCases";
import { executeQueryAndWait, getStatusBar } from "./utils/testHelpers";
import { useSharedVsCodeLifecycle } from "./utils/testLifecycle";

type BackupTypeLabel = "Full" | "Differential" | "Transaction Log";

/**
 * Backup + Restore suite: drives the Backup Database and Restore Database dialogs from the Object
 * Explorer database context menu. Each scenario gets its own database, seeded in the FULL recovery
 * model with a full backup so differential and log backups have a base. Outcomes are verified on
 * the server through msdb backup history and `sys.dm_os_file_exists`, since backup files live on
 * the SQL Server host rather than the test machine.
 */
test.describe("MSSQL Extension - Backup and Restore", () => {
    const sourceDatabases = {
        fullBackup: uniqueDatabaseName("BkFull"),
        differentialBackup: uniqueDatabaseName("BkDiff"),
        logBackup: uniqueDatabaseName("BkLog"),
        scriptFullBackup: uniqueDatabaseName("BkScriptFull"),
        scriptDifferentialBackup: uniqueDatabaseName("BkScriptDiff"),
        restoreFromDatabase: uniqueDatabaseName("RsFromDbSrc"),
        restoreFromFile: uniqueDatabaseName("RsFromFileSrc"),
    };
    const restoredFromDatabase = uniqueDatabaseName("RsFromDb");
    const restoredFromFile = uniqueDatabaseName("RsFromFile");
    const seedBackupPaths = new Map<string, string>();
    let backupFolder: string;
    let vsCodePage: Page;

    // Registered before the lifecycle hooks so the databases exist before Object Explorer first
    // lists them.
    test.beforeAll(async () => {
        test.setTimeout(5 * 60 * 1000);
        backupFolder = await getDefaultBackupFolder();
        for (const databaseName of Object.values(sourceDatabases)) {
            seedBackupPaths.set(databaseName, await seedBackupSourceDatabase(databaseName));
        }
    });

    useSharedVsCodeLifecycle({
        launchOptions: { initialConfig: getSeededLaunchConfig() },
        afterLaunch: async ({ page }) => {
            vsCodePage = page;
        },
    });

    test.afterAll(async () => {
        for (const databaseName of [
            ...Object.values(sourceDatabases),
            restoredFromDatabase,
            restoredFromFile,
        ]) {
            await dropDatabaseIfExists(databaseName);
        }
    });

    /** Backs a database up through the dialog's Backup button and waits for the task to finish. */
    async function backupThroughDialog(
        databaseName: string,
        backupType: BackupTypeLabel,
        expectedTaskMessage: string,
    ): Promise<void> {
        const dialog = await openBackupDialog(vsCodePage, databaseName);
        await chooseBackupType(dialog, backupType);
        await dialog.getByRole("button", { name: "Backup", exact: true }).click();

        const task = await waitForBackgroundTaskSucceeded(
            vsCodePage,
            "Backup Database",
            databaseName,
        );
        await expect(task).toHaveAttribute("aria-label", new RegExp(expectedTaskMessage));
    }

    /** Selects a backup type, or for Full checks it is already the default. */
    async function chooseBackupType(
        dialog: FrameLocator,
        backupType: BackupTypeLabel,
    ): Promise<void> {
        if (backupType === "Full") {
            await expect(dialog.getByRole("combobox", { name: "Backup Type" })).toHaveText("Full");
        } else {
            await selectBackupType(dialog, backupType);
        }
    }

    /** Waits for msdb to record a new backup of the given type whose file exists on the server. */
    async function expectNewBackupOnServer(
        databaseName: string,
        type: BackupSetType,
        expectedPath?: string,
    ): Promise<BackupHistoryRow> {
        const seedPath = seedBackupPaths.get(databaseName);
        let backup: BackupHistoryRow | undefined;
        await expect
            .poll(
                async () => {
                    const history = await getBackupHistory(databaseName);
                    backup = history.find(
                        (row) =>
                            row.type === type &&
                            row.physicalDeviceName !== seedPath &&
                            (expectedPath === undefined || row.physicalDeviceName === expectedPath),
                    );
                    return backup;
                },
                {
                    timeout: 60 * 1000,
                    message: `Expected msdb to record a type ${type} backup of ${databaseName}.`,
                },
            )
            .toBeDefined();
        expect(backup!.fileExists, `${backup!.physicalDeviceName} should exist`).toBe(true);
        expect(backup!.physicalDeviceName.startsWith(backupFolder)).toBe(true);
        return backup!;
    }

    /** Scripts a backup from the dialog, runs the script, and returns the script's target file. */
    async function scriptAndRunBackup(
        databaseName: string,
        backupType: BackupTypeLabel,
    ): Promise<{ script: string; backupPath: string }> {
        const dialog = await openBackupDialog(vsCodePage, databaseName);
        await chooseBackupType(dialog, backupType);
        await dialog.getByRole("button", { name: "Script", exact: true }).click();

        let script = "";
        await expect
            .poll(
                async () => {
                    script = await getActiveEditorText(vsCodePage);
                    return script;
                },
                { timeout: 60 * 1000, message: "Expected the backup script to open." },
            )
            .toContain(`BACKUP DATABASE [${databaseName}]`);
        const backupPath = /DISK\s*=\s*N'([^']+)'/.exec(script)?.[1];
        expect(backupPath, "The script should name a backup file").toBeTruthy();

        // The script opens connected to the last active connection; if it does not, connect it
        // to the server named in the script, as the manual case does.
        const isConnected = await expect(getStatusBar(vsCodePage))
            .toContainText(getServerName(), { timeout: 15 * 1000 })
            .then(() => true)
            .catch(() => false);
        if (!isConnected) {
            await connectActiveEditor(vsCodePage);
        }
        await executeQueryAndWait(vsCodePage);
        return { script, backupPath: backupPath! };
    }

    /** Closes the active editor without saving, so the script editor does not linger. */
    async function revertAndCloseActiveEditor(): Promise<void> {
        await new QuickInput(vsCodePage).runCommand(
            "Revert and Close Editor",
            "View: Revert and Close Editor",
        );
    }

    /**
     * Turns off the tail-log backup in the advanced options if the restore plan enabled it.
     *
     * The plan is computed while the target is still the source database, so it defaults to a
     * tail-log backup WITH NORECOVERY of the source. Restoring to a new database must not leave
     * the source in the RESTORING state, and the backup fails anyway while the source is in use.
     */
    async function disableTailLogBackup(dialog: FrameLocator): Promise<void> {
        await dialog.getByRole("button", { name: "Advanced", exact: true }).click();
        const advancedOptions = dialog.getByRole("dialog", { name: "Advanced restore options" });
        await expect(advancedOptions).toBeVisible();
        await advancedOptions.getByRole("searchbox").fill("tail-log");
        const tailLogBackup = advancedOptions.getByRole("checkbox", {
            name: "Take tail-log backup before restore",
        });
        await expect(tailLogBackup).toBeVisible();
        // The checkbox is controlled by form state that round-trips through the extension, so
        // click and wait for the state to update rather than using uncheck().
        if (await tailLogBackup.isChecked()) {
            await tailLogBackup.click();
        }
        await expect(tailLogBackup).not.toBeChecked();
        await advancedOptions.getByRole("button", { name: "Close", exact: true }).click();
        await expect(advancedOptions).toBeHidden();
    }

    /**
     * Enters a new target database name.
     *
     * The combobox round-trips every edit through the extension and renders the echoed form
     * state, and replacing a selected option first clears the selection. An echo of that clear
     * can land after the new text and blank the field, so re-enter the name until it holds.
     */
    async function setTargetDatabase(targetDatabase: Locator, targetName: string): Promise<void> {
        await expect(async () => {
            if ((await targetDatabase.inputValue()) !== targetName) {
                await targetDatabase.fill(targetName);
            }
            await expect(targetDatabase).toHaveValue(targetName);
            // Give any in-flight echo of an earlier edit time to arrive before trusting the value.
            await vsCodePage.waitForTimeout(500);
            await expect(targetDatabase).toHaveValue(targetName, { timeout: 0 });
        }).toPass({ timeout: 60 * 1000 });
    }

    /** Sets the restore target to a new database name and runs the restore. */
    async function restoreAsNewDatabase(dialog: FrameLocator, targetName: string): Promise<void> {
        // Restore is enabled once the restore plan has loaded; a plan load resets the target.
        const restoreButton = dialog.getByRole("button", { name: "Restore", exact: true });
        await expect(restoreButton).toBeEnabled({ timeout: 60 * 1000 });
        await disableTailLogBackup(dialog);
        await setTargetDatabase(
            dialog.getByRole("combobox", { name: "Target Database" }),
            targetName,
        );
        await expect(restoreButton).toBeEnabled();
        await restoreButton.click();
    }

    /** Closes the Restore Database dialog, which stays open after a restore. */
    async function closeRestoreDialog(dialog: FrameLocator): Promise<void> {
        await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
        await expect(dialog.getByRole("button", { name: "Restore", exact: true })).toHaveCount(0);
    }

    /** Waits for a restored database to come online with the seeded rows. */
    async function expectRestoredDatabase(databaseName: string): Promise<void> {
        await expect.poll(() => databaseExists(databaseName), { timeout: 60 * 1000 }).toBe(true);
        expect(await countSeededRows(databaseName)).toBe(SEEDED_ROW_COUNT);
    }

    test("Full backup to file from the database context menu", testCases(5878927), async () => {
        await backupThroughDialog(
            sourceDatabases.fullBackup,
            "Full",
            "BACKUP DATABASE successfully processed",
        );
        await expectNewBackupOnServer(sourceDatabases.fullBackup, "D");
    });

    // Flaky in the Linux CI build-and-test smoke run (passed on retry): the dialog's webview did not appear within 30s.
    // TODO: Stabilize this test and re-enable it.
    test.fixme(
        "Differential backup to file from the database context menu",
        testCases(5878925),
        async () => {
            await backupThroughDialog(
                sourceDatabases.differentialBackup,
                "Differential",
                "BACKUP DATABASE WITH DIFFERENTIAL successfully processed",
            );
            await expectNewBackupOnServer(sourceDatabases.differentialBackup, "I");
        },
    );

    test(
        "Transaction log backup to file from the database context menu",
        testCases(5878924),
        async () => {
            await backupThroughDialog(
                sourceDatabases.logBackup,
                "Transaction Log",
                "BACKUP LOG successfully processed",
            );
            await expectNewBackupOnServer(sourceDatabases.logBackup, "L");
        },
    );

    // Failed in the Linux CI build-and-test smoke run: the connection quick pick (input[aria-controls="quickInput_list"]) never appeared after running the script.
    // TODO: Stabilize this test and re-enable it.
    test.fixme(
        "Script and run a full backup from the database context menu",
        testCases(5878926),
        async () => {
            const databaseName = sourceDatabases.scriptFullBackup;
            const { script, backupPath } = await scriptAndRunBackup(databaseName, "Full");
            expect(script).not.toMatch(/\bDIFFERENTIAL\b/);
            await expectNewBackupOnServer(databaseName, "D", backupPath);
            await revertAndCloseActiveEditor();
        },
    );

    // Failed in the Linux CI build-and-test smoke run: the connection quick pick (input[aria-controls="quickInput_list"]) never appeared after running the script.
    // TODO: Stabilize this test and re-enable it.
    test.fixme(
        "Script and run a differential backup from the database context menu",
        testCases(5878921),
        async () => {
            const databaseName = sourceDatabases.scriptDifferentialBackup;
            const { script, backupPath } = await scriptAndRunBackup(databaseName, "Differential");
            expect(script).toMatch(/\bWITH\s+DIFFERENTIAL\b/);
            await expectNewBackupOnServer(databaseName, "I", backupPath);
            await revertAndCloseActiveEditor();
        },
    );

    test("Restore from a database's backup history", testCases(5878920), async () => {
        const sourceName = sourceDatabases.restoreFromDatabase;
        const dialog = await openRestoreDialog(vsCodePage, sourceName);
        await expect(dialog.getByRole("radio", { name: "Database" })).toBeChecked();

        const sourceDatabase = dialog.getByRole("combobox", { name: "Source Database" });
        await sourceDatabase.click();
        await dialog.getByRole("option", { name: sourceName, exact: true }).click();
        await expect(sourceDatabase).toHaveText(sourceName);
        const backupSets = dialog.getByRole("table", { name: "Backup sets to restore" });
        await expect(backupSets).toContainText(sourceName, { timeout: 60 * 1000 });

        await restoreAsNewDatabase(dialog, restoredFromDatabase);
        await waitForBackgroundTaskSucceeded(vsCodePage, "Restore Database", restoredFromDatabase);
        await expectRestoredDatabase(restoredFromDatabase);
        // The source must still be online, not left restoring by a tail-log backup.
        expect(await countSeededRows(sourceName)).toBe(SEEDED_ROW_COUNT);
        await closeRestoreDialog(dialog);
    });

    // Flaky in the Linux CI build-and-test smoke run (passed on retry): the dialog's webview did not appear within 30s.
    // TODO: Stabilize this test and re-enable it.
    test.fixme(
        "Restore from a .bak file chosen in the file browser",
        testCases(5878923),
        async () => {
            const sourceName = sourceDatabases.restoreFromFile;
            const backupPath = seedBackupPaths.get(sourceName)!;
            const backupFileName = backupPath.slice(backupFolder.length).replace(/^[\\/]/, "");

            const dialog = await openRestoreDialog(vsCodePage, sourceName);
            await dialog.getByRole("radio", { name: "Backup File" }).check();
            await dialog.getByRole("button", { name: "Browse files" }).click();

            // The file browser lists the server's filesystem, opened at the default backup folder.
            const fileBrowser = dialog.getByRole("dialog", { name: "Select a file" });
            await expect(fileBrowser).toBeVisible();
            await fileBrowser.getByRole("treeitem", { name: backupFileName, exact: true }).click();
            await expect(fileBrowser.getByRole("textbox", { name: "Selected Path" })).toHaveValue(
                backupPath,
            );
            await fileBrowser.getByRole("button", { name: "Select", exact: true }).click();
            await expect(fileBrowser).toBeHidden();

            // Choosing the file loads its backup sets into the restore table.
            const backupSets = dialog.getByRole("table", { name: "Backup sets to restore" });
            await expect(backupSets).toContainText(sourceName, { timeout: 60 * 1000 });
            await expect(backupSets).toContainText("Full");

            await restoreAsNewDatabase(dialog, restoredFromFile);
            await waitForBackgroundTaskSucceeded(vsCodePage, "Restore Database", restoredFromFile);
            await expectRestoredDatabase(restoredFromFile);
            await closeRestoreDialog(dialog);
        },
    );
});
