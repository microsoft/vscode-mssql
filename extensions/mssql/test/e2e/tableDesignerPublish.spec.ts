/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { FrameLocator, Page } from "@playwright/test";
import { test, expect } from "./baseFixtures";
import { getSeededLaunchConfig } from "./utils/seededConnection";
import {
    dropDatabaseIfExists,
    querySingleValue,
    recreateDatabase,
    runSql,
    uniqueDatabaseName,
} from "./utils/sqlClient";
import {
    addColumn,
    clearNotifications,
    closeDesigner,
    continueEditing,
    getApplyChangesDialog,
    getColumnRow,
    getColumns,
    getPrimaryKeyColumns,
    getPublishButton,
    NEW_TABLE_TITLE,
    openExistingTableDesigner,
    openNewTableDesigner,
    openPreviewReport,
    openPublishScript,
    publishFromPreview,
    revertAndCloseActiveEditor,
    scrollObjectExplorerNodeIntoView,
    setColumnCheckbox,
    setTableName,
} from "./utils/tableDesignerPublishHelpers";
import { testCases } from "./utils/testCases";
import { useSharedVsCodeLifecycle } from "./utils/testLifecycle";

async function tableExists(databaseName: string, tableName: string): Promise<boolean> {
    const count = await querySingleValue<number>(
        `SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLES
         WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = '${tableName}'`,
        databaseName,
    );
    return count === 1;
}

/**
 * Table Designer: creating a new table and either opening its publish script or publishing it.
 */
test.describe("Table Designer - create a table", () => {
    const databaseName = uniqueDatabaseName("TableDesignerCreate");
    let page: Page;

    test.beforeAll(async () => {
        await recreateDatabase(databaseName);
    });

    const getContext = useSharedVsCodeLifecycle({
        launchOptions: { initialConfig: getSeededLaunchConfig() },
    });

    test.beforeEach(() => {
        page = getContext().page;
    });

    test.afterAll(async () => {
        await dropDatabaseIfExists(databaseName);
    });

    test(
        "Open Publish Script opens the CREATE TABLE script without creating the table",
        testCases(5878892),
        async () => {
            const frame = await openNewTableDesigner(page, databaseName);
            await setTableName(page, frame, "ScriptedTable");
            await addColumn(page, frame, "Title", "nvarchar(50)");

            const dialog = await openPreviewReport(frame);
            await expect(dialog).toContainText(/Create\s*\[dbo\]\.\[ScriptedTable\] \(Table\)/);

            const script = await openPublishScript(getContext().electronApp, page, dialog);
            expect(script).toContain("CREATE TABLE [dbo].[ScriptedTable]");
            expect(script).toMatch(/\[Title\]\s+NVARCHAR \(50\) NULL/);
            expect(await tableExists(databaseName, "ScriptedTable")).toBe(false);

            await revertAndCloseActiveEditor(page);
            await clearNotifications(page);
            await closeDesigner(page, NEW_TABLE_TITLE, { declineRestorePrompt: true });
        },
    );

    test("Publish creates the table on the server", testCases(5878892), async () => {
        let frame = await openNewTableDesigner(page, databaseName);
        await setTableName(page, frame, "PublishedTable");
        await addColumn(page, frame, "Title", "nvarchar(50)");

        const dialog = await openPreviewReport(frame);
        frame = await publishFromPreview(page, dialog, "dbo.PublishedTable");

        expect(await getColumns(databaseName, "PublishedTable")).toEqual({
            Id: "int NOT NULL",
            Title: "nvarchar(50) NULL",
        });
        expect(await getPrimaryKeyColumns(databaseName, "PublishedTable")).toEqual(["Id"]);
        // Publishing refreshes the Tables folder, so the new table appears in Object Explorer.
        await scrollObjectExplorerNodeIntoView(page, "dbo.PublishedTable");

        await getApplyChangesDialog(frame).getByRole("button", { name: "Close" }).click();
        await expect(page.getByRole("tab", { name: /^dbo\.PublishedTable/ })).toHaveCount(0);
    });
});

/**
 * Table Designer: editing an existing table opened with Modify Table Structure, and either
 * opening the ALTER script or publishing the changes.
 */
test.describe("Table Designer - edit a table", () => {
    const databaseName = uniqueDatabaseName("TableDesignerEdit");
    let page: Page;

    test.beforeAll(async () => {
        await recreateDatabase(databaseName);
        for (const table of ["ScriptCustomers", "PublishCustomers"]) {
            await runSql(
                `CREATE TABLE dbo.${table} (Id INT NOT NULL, Name NVARCHAR(50) NULL);
                 INSERT INTO dbo.${table} (Id, Name) VALUES (1, N'Ada'), (2, N'Grace');`,
                databaseName,
            );
        }
    });

    const getContext = useSharedVsCodeLifecycle({
        launchOptions: { initialConfig: getSeededLaunchConfig() },
    });

    test.beforeEach(() => {
        page = getContext().page;
    });

    test.afterAll(async () => {
        await dropDatabaseIfExists(databaseName);
    });

    /** Adds a CreatedOn column, makes Name NOT NULL, and makes Id the primary key. */
    async function editCustomersTable(frame: FrameLocator): Promise<void> {
        await addColumn(page, frame, "CreatedOn", "date");
        await setColumnCheckbox(getColumnRow(frame, "Name"), "Allow Nulls", false);
        await setColumnCheckbox(getColumnRow(frame, "Id"), "Primary Key", true);
    }

    test(
        "Open Publish Script shows the ALTER statements for the edits",
        testCases(5878893),
        async () => {
            const frame = await openExistingTableDesigner(
                page,
                databaseName,
                "dbo.ScriptCustomers",
            );
            await expect(frame.getByRole("textbox", { name: "Table name" })).toHaveValue(
                "ScriptCustomers",
            );
            await editCustomersTable(frame);

            const dialog = await openPreviewReport(frame);
            await expect(dialog).toContainText(/Alter\s*\[dbo\]\.\[ScriptCustomers\] \(Table\)/);
            await expect(dialog).toContainText(
                /Create\s*\[dbo\]\.\[PK_ScriptCustomers\] \(Primary Key\)/,
            );

            const script = await openPublishScript(getContext().electronApp, page, dialog);
            expect(script).toContain(
                "ALTER TABLE [dbo].[ScriptCustomers] ALTER COLUMN [Name] NVARCHAR (50) NOT NULL;",
            );
            expect(script).toMatch(
                /ALTER TABLE \[dbo\]\.\[ScriptCustomers\]\s+ADD \[CreatedOn\] DATE NULL;/,
            );
            expect(script).toMatch(
                /ALTER TABLE \[dbo\]\.\[ScriptCustomers\]\s+ADD CONSTRAINT \[PK_ScriptCustomers\] PRIMARY KEY CLUSTERED \(\[Id\] ASC\);/,
            );
            // An edit is scripted in place rather than by rebuilding the table.
            expect(script).not.toContain("CREATE TABLE [dbo].[ScriptCustomers]");

            // Opening the script does not apply it.
            expect(await getColumns(databaseName, "ScriptCustomers")).toEqual({
                Id: "int NOT NULL",
                Name: "nvarchar(50) NULL",
            });
            expect(await getPrimaryKeyColumns(databaseName, "ScriptCustomers")).toEqual([]);

            await revertAndCloseActiveEditor(page);
            await clearNotifications(page);
            await closeDesigner(page, "dbo.ScriptCustomers", { declineRestorePrompt: true });
        },
    );

    test("Publish applies the edits to the table", testCases(5878893), async () => {
        let frame = await openExistingTableDesigner(page, databaseName, "dbo.PublishCustomers");
        await editCustomersTable(frame);

        const dialog = await openPreviewReport(frame);
        frame = await publishFromPreview(page, dialog, "dbo.PublishCustomers");

        expect(await getColumns(databaseName, "PublishCustomers")).toEqual({
            Id: "int NOT NULL",
            Name: "nvarchar(50) NOT NULL",
            CreatedOn: "date NULL",
        });
        expect(await getPrimaryKeyColumns(databaseName, "PublishCustomers")).toEqual(["Id"]);
        expect(
            await querySingleValue<number>(
                "SELECT COUNT(*) FROM dbo.PublishCustomers",
                databaseName,
            ),
        ).toBe(2);

        // The designer reloads from the published table and has nothing left to publish.
        await continueEditing(frame);
        await expect(getPublishButton(frame)).toBeDisabled();
        await expect(getColumnRow(frame, "CreatedOn")).toBeVisible();
        await expect(
            getColumnRow(frame, "Name").getByRole("checkbox", { name: "Allow Nulls" }),
        ).not.toBeChecked();
        await expect(
            getColumnRow(frame, "Id").getByRole("checkbox", { name: "Primary Key" }),
        ).toBeChecked();

        await closeDesigner(page, "dbo.PublishCustomers");
    });
});
