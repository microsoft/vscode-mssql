/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { FrameLocator, Page } from "@playwright/test";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { expect, test } from "./baseFixtures";
import {
    countMismatchedRows,
    DACPAC_SOURCE_OBJECTS,
    DACPAC_SOURCE_SEED_SCRIPT,
    DACPAC_SOURCE_TABLES,
    executeAndWaitForCompletion,
    expectSuccessNotification,
    getTableRowCounts,
    getUserObjects,
    openDacpacDialogFromObjectExplorer,
    selectOperation,
    waitForPackageFile,
} from "./utils/dacpacDialogHelpers";
import {
    closeAllEditors,
    getNoDifferencesMessage,
    openSchemaCompareFromPalette,
    runComparison,
    SchemaEndpoint,
    selectEndpoint,
} from "./utils/schemaCompareHelpers";
import { getSeededLaunchConfig, SEEDED_PROFILE_NAME } from "./utils/seededConnection";
import {
    dropDatabaseIfExists,
    querySingleValue,
    recreateDatabase,
    runSql,
    uniqueDatabaseName,
} from "./utils/sqlClient";
import { testCases } from "./utils/testCases";
import { useSharedVsCodeLifecycle } from "./utils/testLifecycle";

/**
 * Dacpac Dialog suite: drives the Data-tier Application (DACPAC/BACPAC) dialog opened from the
 * Object Explorer database context menu. A seeded source database is extracted to a .dacpac and
 * published to a new database, and exported to a .bacpac and imported to a new database on the
 * same server. Schema Compare must then report no differences against the source, and the
 * catalogs (and, for the bacpac, the table data) are compared over SQL as well.
 */
test.describe("MSSQL Extension - DACPAC/BACPAC dialog", () => {
    const sourceDatabase = uniqueDatabaseName("DacSource");
    const deployedDatabase = uniqueDatabaseName("DacDeployed");
    const importedDatabase = uniqueDatabaseName("BacImported");
    let workDir: string;
    let dacpacPath: string;
    let bacpacPath: string;
    let vsCodePage: Page;

    // Registered before the lifecycle hooks so the source database exists before Object Explorer
    // first lists it.
    test.beforeAll(async () => {
        // Resolved so the paths match what VS Code's file dialogs and Schema Compare report.
        workDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "mssql-e2e-dacpac-")));
        dacpacPath = path.join(workDir, `${sourceDatabase}.dacpac`);
        bacpacPath = path.join(workDir, `${sourceDatabase}.bacpac`);
        await recreateDatabase(sourceDatabase);
        await runSql(fs.readFileSync(DACPAC_SOURCE_SEED_SCRIPT, "utf8"), sourceDatabase);
    });

    useSharedVsCodeLifecycle({
        launchOptions: { initialConfig: getSeededLaunchConfig() },
        afterLaunch: async ({ page }) => {
            vsCodePage = page;
        },
    });

    test.afterAll(async () => {
        for (const databaseName of [sourceDatabase, deployedDatabase, importedDatabase]) {
            await dropDatabaseIfExists(databaseName);
        }
        if (workDir) {
            fs.rmSync(workDir, { recursive: true, force: true });
        }
    });

    async function databaseExists(databaseName: string): Promise<boolean> {
        return (
            (await querySingleValue<number>(
                `SELECT COUNT(*) FROM sys.databases WHERE name = N'${databaseName}';`,
            )) === 1
        );
    }

    /** Closes the dialog through its Cancel button. */
    async function closeDialog(dialog: FrameLocator): Promise<void> {
        const cancel = dialog.getByRole("button", { name: "Cancel", exact: true });
        await cancel.click();
        await expect(cancel).toBeHidden();
    }

    /** Compares two schemas in a new Schema Compare panel and expects no differences. */
    async function expectSchemaCompareFindsNoDifferences(
        source: SchemaEndpoint,
        target: SchemaEndpoint,
    ): Promise<void> {
        const frame = await openSchemaCompareFromPalette(vsCodePage);
        await selectEndpoint(vsCodePage, frame, "source", source);
        await selectEndpoint(vsCodePage, frame, "target", target);
        await runComparison(frame);
        await expect(getNoDifferencesMessage(frame)).toBeVisible();
        await closeAllEditors(vsCodePage);
    }

    /** Expects a database's user objects (tables, keys, view, procedure) to match the source. */
    async function expectSameUserObjects(databaseName: string): Promise<void> {
        const sourceObjects = await getUserObjects(sourceDatabase);
        expect(sourceObjects).toEqual(expect.arrayContaining(DACPAC_SOURCE_OBJECTS));
        expect(await getUserObjects(databaseName)).toEqual(sourceObjects);
    }

    function databaseEndpoint(database: string): SchemaEndpoint {
        return { kind: "database", connection: SEEDED_PROFILE_NAME, database };
    }

    test.describe("Extract and publish a DACPAC", () => {
        test.describe.configure({ mode: "serial" });

        test(
            "Extract DACPAC: extracts the source database from the dialog launched in Object Explorer",
            testCases(5878945),
            async () => {
                test.setTimeout(5 * 60 * 1000);
                const dialog = await openDacpacDialogFromObjectExplorer(vsCodePage, sourceDatabase);

                await selectOperation(dialog, "Extract DACPAC");
                await expect(dialog.getByRole("combobox", { name: "Source Database" })).toHaveText(
                    sourceDatabase,
                );
                const outputFile = dialog.getByRole("textbox", { name: "Output file" });
                await expect(outputFile, "A .dacpac output path should be suggested.").toHaveValue(
                    /\.dacpac$/,
                );
                await outputFile.fill(dacpacPath);
                await dialog
                    .getByRole("textbox", { name: "Application Name" })
                    .fill(sourceDatabase);

                await executeAndWaitForCompletion(dialog, "Output file");
                await expectSuccessNotification(
                    vsCodePage,
                    `DACPAC extracted successfully to '${path.basename(dacpacPath)}'`,
                );
                await waitForPackageFile(dacpacPath);
                await closeDialog(dialog);
            },
        );

        test(
            "Publish DACPAC: deploys the extracted package to a new database",
            testCases(5878945),
            async () => {
                test.setTimeout(5 * 60 * 1000);
                const dialog = await openDacpacDialogFromObjectExplorer(vsCodePage, sourceDatabase);

                await selectOperation(dialog, "Publish DACPAC");
                await dialog.getByRole("textbox", { name: "Package file" }).fill(dacpacPath);
                await dialog.getByRole("radio", { name: "New Database", exact: true }).check();
                await dialog
                    .getByRole("textbox", { name: "Database Name", exact: true })
                    .fill(deployedDatabase);

                await executeAndWaitForCompletion(dialog, "Package file");
                await expectSuccessNotification(
                    vsCodePage,
                    `DACPAC deployed successfully to database '${deployedDatabase}'`,
                );
                await closeDialog(dialog);

                await expect
                    .poll(() => databaseExists(deployedDatabase), { timeout: 60 * 1000 })
                    .toBe(true);
                await expectSameUserObjects(deployedDatabase);
                // A dacpac carries schema only, so the deployed tables are empty.
                expect(await getTableRowCounts(deployedDatabase)).toEqual(
                    Object.fromEntries(DACPAC_SOURCE_TABLES.map((table) => [table, 0])),
                );
            },
        );

        test(
            "Publish DACPAC: Schema Compare finds no differences from the source database",
            testCases(5878945),
            async () => {
                test.setTimeout(5 * 60 * 1000);
                await expectSchemaCompareFindsNoDifferences(
                    databaseEndpoint(sourceDatabase),
                    databaseEndpoint(deployedDatabase),
                );
                await expectSchemaCompareFindsNoDifferences(
                    { kind: "dacpac", file: dacpacPath },
                    databaseEndpoint(sourceDatabase),
                );
            },
        );
    });

    test.describe("Export and import a BACPAC", () => {
        test.describe.configure({ mode: "serial" });

        test(
            "Export BACPAC: exports the source database from the dialog launched in Object Explorer",
            testCases(5878946),
            async () => {
                test.setTimeout(5 * 60 * 1000);
                const dialog = await openDacpacDialogFromObjectExplorer(vsCodePage, sourceDatabase);

                await selectOperation(dialog, "Export BACPAC");
                await expect(dialog.getByRole("combobox", { name: "Source Database" })).toHaveText(
                    sourceDatabase,
                );
                const outputFile = dialog.getByRole("textbox", { name: "Output file" });
                await expect(outputFile, "A .bacpac output path should be suggested.").toHaveValue(
                    /\.bacpac$/,
                );
                await outputFile.fill(bacpacPath);

                await executeAndWaitForCompletion(dialog, "Output file");
                await expectSuccessNotification(
                    vsCodePage,
                    `BACPAC exported successfully to '${path.basename(bacpacPath)}'`,
                );
                await waitForPackageFile(bacpacPath);
                await closeDialog(dialog);
            },
        );

        test(
            "Import BACPAC: imports the package to a new database with the same schema and data",
            testCases(5878946),
            async () => {
                test.setTimeout(5 * 60 * 1000);
                const dialog = await openDacpacDialogFromObjectExplorer(vsCodePage, sourceDatabase);

                await selectOperation(dialog, "Import BACPAC");
                await dialog.getByRole("textbox", { name: "Package file" }).fill(bacpacPath);
                await dialog
                    .getByRole("textbox", { name: "Database Name", exact: true })
                    .fill(importedDatabase);

                await executeAndWaitForCompletion(dialog, "Package file");
                await expectSuccessNotification(
                    vsCodePage,
                    `BACPAC imported successfully to database '${importedDatabase}'`,
                );
                await closeDialog(dialog);

                await expect
                    .poll(() => databaseExists(importedDatabase), { timeout: 60 * 1000 })
                    .toBe(true);
                await expectSameUserObjects(importedDatabase);
                expect(await getTableRowCounts(importedDatabase)).toEqual(
                    await getTableRowCounts(sourceDatabase),
                );
                for (const table of DACPAC_SOURCE_TABLES) {
                    expect(
                        await countMismatchedRows(table, sourceDatabase, importedDatabase),
                        `${table} rows should match the source database.`,
                    ).toBe(0);
                }
            },
        );

        test(
            "Import BACPAC: Schema Compare finds no differences from the source database",
            testCases(5878946),
            async () => {
                test.setTimeout(5 * 60 * 1000);
                await expectSchemaCompareFindsNoDifferences(
                    databaseEndpoint(sourceDatabase),
                    databaseEndpoint(importedDatabase),
                );
            },
        );
    });
});
