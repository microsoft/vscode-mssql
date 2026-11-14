/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as path from "path";
import { FrameLocator, Page } from "@playwright/test";
import { expect, test } from "./baseFixtures";
import { QuickInput } from "./pageObjects/quickInput";
import {
    browseForFile,
    FLAT_FILE_FIXTURES,
    getAllowNullsCheckbox,
    getDataTypeDropdown,
    getImportedColumns,
    getPrimaryKeyCheckbox,
    getPrimaryKeyColumns,
    getTableNameInput,
    goToModifyColumns,
    goToPreviewData,
    importDataAndFinish,
    openImportWizard,
    selectDataType,
} from "./utils/flatFileImportHelpers";
import { getSeededLaunchConfig } from "./utils/seededConnection";
import {
    dropDatabaseIfExists,
    quoteName,
    recreateDatabase,
    runSql,
    SqlRow,
    uniqueDatabaseName,
} from "./utils/sqlClient";
import { testCases } from "./utils/testCases";
import { useSharedVsCodeLifecycle } from "./utils/testLifecycle";

const PRODUCTS_CSV = path.join(FLAT_FILE_FIXTURES, "products.csv");
/** contacts.csv leaves City empty for ContactId 2. */
const CONTACTS_CSV = path.join(FLAT_FILE_FIXTURES, "contacts.csv");

const PRODUCT_COLUMNS = ["ProductId", "ProductName", "Price", "Quantity"];
const PRODUCT_ROWS = [
    { ProductId: 1, ProductName: "Widget", Price: 9.99, Quantity: 10 },
    { ProductId: 2, ProductName: "Gadget", Price: 19.5, Quantity: 25 },
    { ProductId: 3, ProductName: "Gizmo", Price: 4.25, Quantity: 100 },
    { ProductId: 4, ProductName: "Doohickey", Price: 12, Quantity: 7 },
    { ProductId: 5, ProductName: "Thingamajig", Price: 7.75, Quantity: 42 },
];

/**
 * Flat-file Import suite: drives the Import Flat File wizard opened from a database's Object
 * Explorer context menu through Specify Input File, Preview Data, Modify Columns, and Summary.
 * Each test imports a checked-in CSV fixture into a new table of one shared empty database, then
 * verifies the table's schema, nullability, primary key, and data directly on the server.
 */
test.describe("MSSQL Extension - Flat-file Import", () => {
    const databaseName = uniqueDatabaseName("FlatFileImport");
    let vsCodePage: Page;

    // Registered before the lifecycle hooks so the database exists before Object Explorer first
    // lists it.
    test.beforeAll(async () => {
        await recreateDatabase(databaseName);
    });

    useSharedVsCodeLifecycle({
        launchOptions: { initialConfig: getSeededLaunchConfig() },
        afterLaunch: async ({ page }) => {
            vsCodePage = page;
        },
    });

    // A wizard left open by a failed test would otherwise be picked up by the next test.
    test.beforeEach(async () => {
        await new QuickInput(vsCodePage).runCommand("Close All Editors", "View: Close All Editors");
    });

    test.afterAll(async () => {
        await dropDatabaseIfExists(databaseName);
    });

    /** Opens the wizard, browses to a fixture, and optionally renames the new table. */
    async function startImport(csvPath: string, tableName?: string): Promise<FrameLocator> {
        const wizard = await openImportWizard(vsCodePage, databaseName);
        await browseForFile(vsCodePage, wizard, csvPath);
        if (tableName) {
            await getTableNameInput(wizard).fill(tableName);
            await expect(getTableNameInput(wizard)).toHaveValue(tableName);
        }
        return wizard;
    }

    /**
     * Reads an imported products table. Price is rounded to the CSV's two decimals because the
     * import stores float values with single precision (9.99 reads back as 9.989999771...).
     */
    async function selectProducts(tableName: string): Promise<SqlRow[]> {
        const [rows] = await runSql(
            `SELECT ProductId, ProductName, CAST(Price AS decimal(10, 2)) AS Price, Quantity
             FROM dbo.${quoteName(tableName)} ORDER BY ProductId`,
            databaseName,
        );
        return rows;
    }

    test(
        "imports a CSV into a new table using the proposed schema",
        testCases(5878915),
        async () => {
            const wizard = await openImportWizard(vsCodePage, databaseName);
            await expect(
                wizard.getByRole("combobox", {
                    name: "Database the table is created in",
                    exact: true,
                }),
            ).toHaveText(databaseName);

            await browseForFile(vsCodePage, wizard, PRODUCTS_CSV);
            await expect(getTableNameInput(wizard)).toHaveValue("products");
            await expect(
                wizard.getByRole("button", { name: "Table Schema", exact: true }),
            ).toHaveText("dbo");

            const preview = await goToPreviewData(wizard);
            await expect(preview.getByRole("columnheader")).toHaveText(PRODUCT_COLUMNS);
            await expect(preview.getByRole("row")).toHaveCount(PRODUCT_ROWS.length + 1);
            await expect(preview.getByRole("row").nth(1).getByRole("cell")).toHaveText([
                "1",
                "Widget",
                "9.99",
                "10",
            ]);
            await expect(preview.getByRole("row").last().getByRole("cell")).toHaveText([
                "5",
                "Thingamajig",
                "7.75",
                "42",
            ]);

            const columnSettings = await goToModifyColumns(wizard);
            for (const column of PRODUCT_COLUMNS) {
                await expect(
                    columnSettings.getByRole("textbox", {
                        name: `Column name for ${column}`,
                        exact: true,
                    }),
                ).toHaveValue(column);
            }
            await expect(getDataTypeDropdown(wizard, "ProductId")).toHaveText("tinyint");
            await expect(getDataTypeDropdown(wizard, "ProductName")).toHaveText("nvarchar(50)");
            await expect(getDataTypeDropdown(wizard, "Price")).toHaveText("float");
            await expect(getDataTypeDropdown(wizard, "Quantity")).toHaveText("tinyint");
            for (const column of PRODUCT_COLUMNS) {
                await expect(getPrimaryKeyCheckbox(wizard, column)).not.toBeChecked();
                await expect(getAllowNullsCheckbox(wizard, column)).not.toBeChecked();
            }

            await importDataAndFinish(vsCodePage, wizard);

            expect(await getImportedColumns(databaseName, "products")).toEqual([
                { name: "ProductId", dataType: "tinyint", maxLength: undefined, isNullable: false },
                { name: "ProductName", dataType: "nvarchar", maxLength: 50, isNullable: false },
                { name: "Price", dataType: "float", maxLength: undefined, isNullable: false },
                { name: "Quantity", dataType: "tinyint", maxLength: undefined, isNullable: false },
            ]);
            expect(await selectProducts("products")).toEqual(PRODUCT_ROWS);
        },
    );

    test("imports a CSV after changing a column's data type", testCases(5878916), async () => {
        const tableName = "ProductsRetyped";
        const wizard = await startImport(PRODUCTS_CSV, tableName);
        await goToPreviewData(wizard);
        await goToModifyColumns(wizard);

        await expect(getDataTypeDropdown(wizard, "Quantity")).toHaveText("tinyint");
        await selectDataType(wizard, "Quantity", "int");

        await importDataAndFinish(vsCodePage, wizard);

        const columns = await getImportedColumns(databaseName, tableName);
        expect(columns.find((column) => column.name === "Quantity")).toEqual({
            name: "Quantity",
            dataType: "int",
            maxLength: undefined,
            isNullable: false,
        });
        expect(columns.find((column) => column.name === "ProductId")?.dataType).toBe("tinyint");
        expect(await selectProducts(tableName)).toEqual(PRODUCT_ROWS);
    });

    test("imports an empty CSV cell as NULL", testCases(5878917), async () => {
        const wizard = await startImport(CONTACTS_CSV);
        await expect(getTableNameInput(wizard)).toHaveValue("contacts");

        const preview = await goToPreviewData(wizard);
        await expect(preview.getByRole("row").nth(2).getByRole("cell")).toHaveText([
            "2",
            "Alan",
            "Turing",
            "",
        ]);

        await goToModifyColumns(wizard);
        await expect(getAllowNullsCheckbox(wizard, "City")).toBeChecked();
        for (const column of ["ContactId", "FirstName", "LastName"]) {
            await expect(getAllowNullsCheckbox(wizard, column)).not.toBeChecked();
        }

        await importDataAndFinish(vsCodePage, wizard);

        const columns = await getImportedColumns(databaseName, "contacts");
        expect(columns.map(({ name, isNullable }) => ({ name, isNullable }))).toEqual([
            { name: "ContactId", isNullable: false },
            { name: "FirstName", isNullable: false },
            { name: "LastName", isNullable: false },
            { name: "City", isNullable: true },
        ]);
        const [rows] = await runSql(
            "SELECT ContactId, City FROM dbo.contacts ORDER BY ContactId",
            databaseName,
        );
        expect(rows.map((row) => row.ContactId)).toEqual([1, 2, 3, 4]);
        expect(rows[1].City, "The empty CSV cell should be imported as NULL").toBeNull();
        expect([rows[0].City, rows[2].City, rows[3].City]).toEqual([
            "London",
            "Arlington",
            "Austin",
        ]);
    });

    test("imports a CSV with columns set as the primary key", testCases(5878918), async () => {
        const tableName = "ProductsWithKey";
        const keyColumns = ["ProductId", "ProductName"];
        const wizard = await startImport(PRODUCTS_CSV, tableName);
        await goToPreviewData(wizard);
        await goToModifyColumns(wizard);

        for (const column of keyColumns) {
            await getPrimaryKeyCheckbox(wizard, column).check();
            await expect(getPrimaryKeyCheckbox(wizard, column)).toBeChecked();
            // A key column cannot be nullable, so the wizard locks its Allow Nulls box.
            await expect(getAllowNullsCheckbox(wizard, column)).toBeDisabled();
        }
        await expect(getPrimaryKeyCheckbox(wizard, "Price")).not.toBeChecked();

        await importDataAndFinish(vsCodePage, wizard);

        expect(await getPrimaryKeyColumns(databaseName, tableName)).toEqual(keyColumns);
        expect(await selectProducts(tableName)).toEqual(PRODUCT_ROWS);
    });
});
