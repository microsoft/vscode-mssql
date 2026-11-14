/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { FrameLocator, Locator, Page } from "@playwright/test";
import { test, expect } from "./baseFixtures";
import { VsCodeAppHandle } from "./utils/launchVscodeWithMsSqlExt";
import { readActiveEditorText } from "./utils/schemaCompareHelpers";
import {
    expandObjectExplorerPath,
    getObjectExplorerNode,
    getSeededLaunchConfig,
    runObjectExplorerContextAction,
    SEEDED_PROFILE_NAME,
    waitForActiveEditorTab,
} from "./utils/seededConnection";
import {
    dropDatabaseIfExists,
    recreateDatabase,
    runSql,
    SqlRow,
    uniqueDatabaseName,
} from "./utils/sqlClient";
import { testCases } from "./utils/testCases";
import { getWebviewByTitle } from "./utils/testHelpers";
import { useSharedVsCodeLifecycle } from "./utils/testLifecycle";

const SEED_SCRIPT = `
CREATE TABLE dbo.Customers (
    Id INT NOT NULL CONSTRAINT PK_Customers PRIMARY KEY,
    Name NVARCHAR(100) NOT NULL
);
CREATE TABLE dbo.Orders (
    Id INT NOT NULL CONSTRAINT PK_Orders PRIMARY KEY,
    CustomerId INT NOT NULL,
    Total DECIMAL(10, 2) NULL
);`;

const FOREIGN_KEY_NAME = "FK_Orders_Customers";

const PUBLISH_CONFIRMATION = "I have read the summary and understand the potential risks.";

/** The Apply Changes dialog, which shows the publish summary and then the publish result. */
function getPublishDialog(frame: FrameLocator): Locator {
    return frame.getByRole("dialog", { name: "Apply Changes" });
}

/** A table node on the diagram canvas. */
function getTableNode(frame: FrameLocator, qualifiedName: string): Locator {
    return frame.getByRole("group", { name: `Table ${qualifiedName}`, exact: true });
}

/** A column row inside a table node, named for the column and its data type. */
function getColumnNode(table: Locator, columnName: string, dataType: string): Locator {
    return table.getByRole("group", {
        name: `Column ${columnName}, type ${dataType}`,
        exact: true,
    });
}

/** Foreign key edges; React Flow names each one for the nodes it connects. */
function getRelationshipEdges(frame: FrameLocator): Locator {
    return frame.getByRole("application").getByRole("group", { name: /^Edge from / });
}

/** A column row in the Add/Edit Table dialog, found by the value of its name text box. */
function getEditorColumnRow(dialog: Locator, columnName: string): Locator {
    // A row's accessible name starts with the value of its Column Name text box.
    return dialog.getByRole("row", { name: new RegExp(`^${columnName}\\b`) });
}

/** Picks an option in one of the dialog's searchable dropdowns. */
async function selectDropdownOption(
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
async function setColumnType(
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

/** Opens the Edit Table dialog from a table node's toolbar. */
async function openEditTable(frame: FrameLocator, qualifiedName: string): Promise<Locator> {
    await getTableNode(frame, qualifiedName).getByRole("button", { name: "Edit Table" }).click();
    const dialog = frame.getByRole("dialog", { name: "Edit Table" });
    await expect(dialog).toBeVisible();
    return dialog;
}

/** Columns of a table as `name type(length) NULL|NOT NULL` strings, in column order. */
async function describeColumns(database: string, table: string): Promise<string[]> {
    const [rows] = await runSql(
        `SELECT COLUMN_NAME AS name, DATA_TYPE AS type, CHARACTER_MAXIMUM_LENGTH AS length,
                IS_NULLABLE AS nullable
         FROM INFORMATION_SCHEMA.COLUMNS
         WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = '${table}'
         ORDER BY ORDINAL_POSITION;`,
        database,
    );
    return rows.map(
        (row: SqlRow) =>
            `${row.name} ${row.type}${row.length ? `(${row.length})` : ""} ` +
            (row.nullable === "YES" ? "NULL" : "NOT NULL"),
    );
}

/**
 * Schema Designer: open a seeded database's diagram from Object Explorer, add a table, edit
 * existing columns, add a foreign key, then review the publish summary and script and publish.
 * Each step builds on the previous one, so the tests run in order against one designer.
 */
test.describe("Schema Designer", () => {
    test.describe.configure({ mode: "serial" });

    const databaseName = uniqueDatabaseName("SchemaDesigner");
    const designerTitle = `Visualize and Design Schema - ${databaseName}`;
    let app: VsCodeAppHandle;
    let page: Page;
    let frame: FrameLocator;

    test.beforeAll(async () => {
        await recreateDatabase(databaseName);
        await runSql(SEED_SCRIPT, databaseName);
    });

    const getContext = useSharedVsCodeLifecycle({
        launchOptions: { initialConfig: getSeededLaunchConfig() },
    });

    test.afterAll(async () => {
        await dropDatabaseIfExists(databaseName);
    });

    test("Opens with the database's existing tables", testCases(5878930), async () => {
        ({ electronApp: app, page } = getContext());
        await expandObjectExplorerPath(page, [SEEDED_PROFILE_NAME, "Databases"]);
        await runObjectExplorerContextAction(
            page,
            getObjectExplorerNode(page, databaseName),
            "Visualize and Design Schema...",
        );
        frame = await getWebviewByTitle(page, designerTitle, 60 * 1000);

        const customers = getTableNode(frame, "dbo.Customers");
        await expect(customers).toBeVisible({ timeout: 2 * 60 * 1000 });
        await expect(getColumnNode(customers, "Id", "int")).toBeVisible();
        await expect(getColumnNode(customers, "Name", "nvarchar")).toBeVisible();
        const orders = getTableNode(frame, "dbo.Orders");
        await expect(getColumnNode(orders, "CustomerId", "int")).toBeVisible();
        await expect(getColumnNode(orders, "Total", "decimal")).toBeVisible();
        await expect(getRelationshipEdges(frame)).toHaveCount(0);
        await expect(frame.getByRole("button", { name: "Apply Changes" })).toBeDisabled();
    });

    test(
        "Add Table creates a table with new columns and constraints",
        testCases(5878930),
        async () => {
            await frame.getByRole("button", { name: "Add Table" }).click();
            const dialog = frame.getByRole("dialog", { name: "Add Table" });
            await expect(dialog).toBeVisible();

            await dialog.getByRole("textbox", { name: "Table name" }).fill("Products");
            // New tables start with an Id primary key column.
            const idRow = getEditorColumnRow(dialog, "Id");
            await expect(idRow.getByRole("checkbox", { name: "Primary Key" })).toBeChecked();

            await dialog.getByRole("button", { name: "Add new column" }).click();
            const newRow = dialog.getByRole("row", { name: /^column_\d+\b/ });
            await expect(newRow).toBeVisible();
            await newRow.getByRole("textbox", { name: "Column Name" }).fill("ProductName");
            await setColumnType(frame, dialog, "ProductName", "nvarchar");

            await getEditorColumnRow(dialog, "ProductName")
                .getByRole("button", { name: "Advanced options" })
                .click();
            const allowNull = frame.getByRole("checkbox", { name: "Allow Null" });
            await expect(allowNull).toBeChecked();
            await allowNull.uncheck();
            await frame.getByRole("textbox", { name: "Max Length" }).fill("100");
            await page.keyboard.press("Escape");
            await expect(allowNull).toBeHidden();

            await dialog.getByRole("button", { name: "Add", exact: true }).click();
            await expect(dialog).toBeHidden();

            const products = getTableNode(frame, "dbo.Products");
            await expect(products).toBeVisible();
            await expect(getColumnNode(products, "Id", "int")).toBeVisible();
            await expect(getColumnNode(products, "ProductName", "nvarchar")).toBeVisible();
            await expect(frame.getByRole("button", { name: "Apply Changes" })).toBeEnabled();
        },
    );

    test(
        "Editing an existing table changes its columns on the canvas",
        testCases(5878930),
        async () => {
            let dialog = await openEditTable(frame, "dbo.Orders");
            await setColumnType(frame, dialog, "Total", "money");
            await dialog.getByRole("button", { name: "Save" }).click();
            await expect(dialog).toBeHidden();
            const orders = getTableNode(frame, "dbo.Orders");
            await expect(getColumnNode(orders, "Total", "money")).toBeVisible();
            await expect(getColumnNode(orders, "Total", "decimal")).toHaveCount(0);

            dialog = await openEditTable(frame, "dbo.Customers");
            await getEditorColumnRow(dialog, "Name")
                .getByRole("textbox", { name: "Column Name" })
                .fill("CustomerName");
            await dialog.getByRole("button", { name: "Save" }).click();
            await expect(dialog).toBeHidden();
            const customers = getTableNode(frame, "dbo.Customers");
            await expect(getColumnNode(customers, "CustomerName", "nvarchar")).toBeVisible();
            await expect(getColumnNode(customers, "Name", "nvarchar")).toHaveCount(0);
        },
    );

    test("Adding a foreign key draws a relationship edge", testCases(5878930), async () => {
        const dialog = await openEditTable(frame, "dbo.Orders");
        await dialog.getByRole("tab", { name: "Foreign Keys" }).click();
        await dialog.getByRole("button", { name: "Add new foreign key" }).click();

        await dialog.getByRole("textbox", { name: "Foreign key name" }).fill(FOREIGN_KEY_NAME);
        await selectDropdownOption(
            frame,
            dialog.getByRole("button", { name: "Target Table" }),
            "Target Table",
            "dbo.Customers",
        );
        await selectDropdownOption(
            frame,
            dialog.getByRole("button", { name: "Source Column" }),
            "Source Column",
            "CustomerId",
        );
        await selectDropdownOption(
            frame,
            dialog.getByRole("button", { name: "Foreign Column" }),
            "Foreign Column",
            "Id",
        );
        await dialog.getByRole("button", { name: "Save" }).click();
        await expect(dialog).toBeHidden();

        await expect(getRelationshipEdges(frame)).toHaveCount(1);
    });

    test("Apply Changes summarizes the pending changes", testCases(5878930), async () => {
        await frame.getByRole("button", { name: "Apply Changes" }).click();
        const dialog = getPublishDialog(frame);
        await expect(dialog).toBeVisible();
        await expect(dialog.getByRole("checkbox", { name: PUBLISH_CONFIRMATION })).toBeVisible({
            timeout: 2 * 60 * 1000,
        });

        // The summary groups the changes by the action the deployment takes.
        for (const action of ["Rename", "Alter", "Create"]) {
            await expect(dialog.getByRole("heading", { name: action, exact: true })).toBeVisible();
        }
        const items = await dialog.getByRole("listitem").allInnerTexts();
        expect(items).toEqual(
            expect.arrayContaining([
                "[dbo].[Customers].[CustomerName] (Column)",
                "[dbo].[Orders] (Table)",
                "[dbo].[Products] (Table)",
                `[dbo].[${FOREIGN_KEY_NAME}] (Foreign Key)`,
            ]),
        );
        // Changing DECIMAL to MONEY is flagged as possible data loss.
        expect(items.join("\n")).toMatch(/column Total in table \[dbo\]\.\[Orders\]/);
    });

    test("Open Publish Script shows the DDL for each change", testCases(5878930), async () => {
        const dialog = getPublishDialog(frame);
        const publish = dialog.getByRole("button", { name: "Publish", exact: true });
        const openScript = dialog.getByRole("button", { name: "Open Publish Script" });
        await expect(publish).toBeDisabled();
        await dialog.getByRole("checkbox", { name: PUBLISH_CONFIRMATION }).check();
        await expect(publish).toBeEnabled();

        await openScript.click();
        await waitForActiveEditorTab(page, /^Untitled-\d+/);
        const script = await readActiveEditorText(app, page);
        expect(script).toContain(
            "EXECUTE sp_rename @objname = N'[dbo].[Customers].[Name]', @newname = N'CustomerName', @objtype = N'COLUMN';",
        );
        expect(script).toContain("ALTER TABLE [dbo].[Orders] ALTER COLUMN [Total] MONEY NULL;");
        expect(script).toMatch(/CREATE TABLE \[dbo\]\.\[Products\] \(\s+\[Id\]\s+INT\s+IDENTITY/);
        expect(script).toMatch(/\[ProductName\] NVARCHAR \(100\) NOT NULL/);
        expect(script).toContain("CONSTRAINT [PK_Products] PRIMARY KEY CLUSTERED ([Id] ASC)");
        expect(script).toContain(
            `ADD CONSTRAINT [${FOREIGN_KEY_NAME}] FOREIGN KEY ([CustomerId]) REFERENCES [dbo].[Customers] ([Id])`,
        );
    });

    test("Publish applies the changes to the database", testCases(5878930), async () => {
        // Return from the script editor to the designer, whose dialog stays open.
        await page.getByRole("tab", { name: designerTitle }).click();
        frame = await getWebviewByTitle(page, designerTitle);
        const dialog = getPublishDialog(frame);
        await dialog.getByRole("button", { name: "Publish", exact: true }).click();
        await expect(dialog.getByText("Changes published successfully")).toBeVisible({
            timeout: 2 * 60 * 1000,
        });

        expect(await describeColumns(databaseName, "Products")).toEqual([
            "Id int NOT NULL",
            "ProductName nvarchar(100) NOT NULL",
        ]);
        expect(await describeColumns(databaseName, "Customers")).toEqual([
            "Id int NOT NULL",
            "CustomerName nvarchar(100) NOT NULL",
        ]);
        expect(await describeColumns(databaseName, "Orders")).toEqual([
            "Id int NOT NULL",
            "CustomerId int NOT NULL",
            "Total money NULL",
        ]);
        const [foreignKeys] = await runSql(
            `SELECT fk.name AS name,
                    OBJECT_NAME(fk.parent_object_id) AS parentTable,
                    COL_NAME(fkc.parent_object_id, fkc.parent_column_id) AS parentColumn,
                    OBJECT_NAME(fk.referenced_object_id) AS referencedTable,
                    COL_NAME(fkc.referenced_object_id, fkc.referenced_column_id) AS referencedColumn
             FROM sys.foreign_keys fk
             JOIN sys.foreign_key_columns fkc ON fkc.constraint_object_id = fk.object_id;`,
            databaseName,
        );
        expect(foreignKeys).toEqual([
            {
                name: FOREIGN_KEY_NAME,
                parentTable: "Orders",
                parentColumn: "CustomerId",
                referencedTable: "Customers",
                referencedColumn: "Id",
            },
        ]);

        // The designer now matches the database, so nothing is left to apply.
        // Close would also close the designer after a publish, so keep editing instead.
        await dialog.getByRole("button", { name: "Continue Editing" }).click();
        await expect(dialog).toBeHidden();
        await expect(frame.getByRole("button", { name: "Apply Changes" })).toBeDisabled({
            timeout: 60 * 1000,
        });
        await expect(
            getColumnNode(getTableNode(frame, "dbo.Products"), "ProductName", "nvarchar"),
        ).toBeVisible();
        await expect(getRelationshipEdges(frame)).toHaveCount(1);
    });
});
