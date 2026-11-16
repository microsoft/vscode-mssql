/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { FrameLocator, Locator, Page } from "@playwright/test";
import { test, expect } from "./baseFixtures";
import { VsCodeAppHandle } from "./utils/launchVscodeWithMsSqlExt";
import {
    addColumn,
    closeSchemaDesigner,
    copyDefinition,
    expectVisibleTables,
    getCanvas,
    getColumnNode,
    getDefinitionEditor,
    getEditorColumnRow,
    getFilterButton,
    getRelationshipEdges,
    getSelectedTableNode,
    getTableNode,
    openDefinitionPanel,
    openEditTable,
    openFindTables,
    openSchemaDesigner,
    openTableFilter,
    readSeedScript,
    saveTable,
    selectDropdownOption,
    setColumnType,
    toggleFilterItem,
} from "./utils/schemaDesignerCanvasHelpers";
import { getSeededLaunchConfig } from "./utils/seededConnection";
import {
    dropDatabaseIfExists,
    recreateDatabase,
    runSql,
    uniqueDatabaseName,
} from "./utils/sqlClient";
import { testCases } from "./utils/testCases";
import { useSharedVsCodeLifecycle } from "./utils/testLifecycle";

const ALL_TABLES = [
    "dbo.Customers",
    "dbo.CustomerNotes",
    "dbo.Products",
    "Sales.Orders",
    "Sales.OrderLines",
];
const DBO_TABLES = ["dbo.Customers", "dbo.CustomerNotes", "dbo.Products"];
const SEEDED_FOREIGN_KEYS = [
    "FK_CustomerNotes_Customers",
    "FK_Orders_Customers",
    "FK_OrderLines_Orders",
    "FK_OrderLines_Products",
];

/** Center of an element's bounding box in page coordinates. */
async function getCenter(locator: Locator): Promise<{ x: number; y: number }> {
    const box = await locator.boundingBox();
    expect(box, "The element should be laid out on screen.").not.toBeNull();
    return { x: box!.x + box!.width / 2, y: box!.y + box!.height / 2 };
}

/** Distance between the centers of a table node and the canvas. */
async function getDistanceFromCanvasCenter(frame: FrameLocator, table: string): Promise<number> {
    const canvas = await getCenter(getCanvas(frame));
    const node = await getCenter(getTableNode(frame, table));
    return Math.hypot(node.x - canvas.x, node.y - canvas.y);
}

/** Rendered width of a table node, which scales with the canvas zoom. */
async function getRenderedWidth(frame: FrameLocator, table: string): Promise<number> {
    return (await getTableNode(frame, table).boundingBox())?.width ?? 0;
}

/** Whether a table node lies entirely inside the visible canvas. */
async function isInsideCanvas(frame: FrameLocator, table: string): Promise<boolean> {
    const canvas = await getCanvas(frame).boundingBox();
    const node = await getTableNode(frame, table).boundingBox();
    if (!canvas || !node) {
        return false;
    }
    return (
        node.x >= canvas.x &&
        node.y >= canvas.y &&
        node.x + node.width <= canvas.x + canvas.width &&
        node.y + node.height <= canvas.y + canvas.height
    );
}

/** Selects a Definition panel output format and waits for it to be the checked option. */
async function selectDefinitionType(definitionType: Locator, label: string): Promise<void> {
    const option = definitionType.getByRole("radio", { name: label, exact: true });
    await option.click();
    await expect(option).toBeChecked();
}

/** Escapes a literal for use inside a regular expression. */
function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Matches the T-SQL the Definition panel generates for one foreign key. */
function foreignKeyScript(
    name: string,
    table: string,
    column: string,
    referencedTable: string,
): RegExp {
    return new RegExp(
        `ALTER TABLE ${escapeRegExp(table)}\\s+ADD CONSTRAINT \\[${name}\\]\\s+` +
            `FOREIGN KEY \\(\\[${column}\\]\\)\\s+REFERENCES ${escapeRegExp(referencedTable)}\\(\\[Id\\]\\)`,
    );
}

/** The CREATE TABLE statement for one table in a T-SQL definition. */
function getCreateTableStatement(script: string, table: string): string {
    const start = script.indexOf(`CREATE TABLE ${table} (`);
    expect(start, `The definition should create ${table}.`).toBeGreaterThanOrEqual(0);
    return script.slice(start, script.indexOf(");", start) + 2);
}

/**
 * Schema Designer canvas: loading a database with tables in the dbo and Sales schemas, the
 * Definition panel's whole-schema script, the table filter checklist and Find Tables. Every test
 * opens a fresh designer and closes it afterwards, discarding any edits, so the tests are
 * independent and nothing is published to the database.
 */
test.describe("Schema Designer canvas", () => {
    const databaseName = uniqueDatabaseName("SchemaDesignerCanvas");
    let app: VsCodeAppHandle;
    let page: Page;
    let frame: FrameLocator;
    let hasUnpublishedEdits = false;

    test.beforeAll(async () => {
        await recreateDatabase(databaseName);
        await runSql(readSeedScript(), databaseName);
    });

    const getContext = useSharedVsCodeLifecycle({
        launchOptions: { initialConfig: getSeededLaunchConfig() },
    });

    test.beforeEach(async () => {
        ({ electronApp: app, page } = getContext());
        hasUnpublishedEdits = false;
        frame = await openSchemaDesigner(page, databaseName, "dbo.Customers");
    });

    test.afterEach(async () => {
        await closeSchemaDesigner(page, databaseName, hasUnpublishedEdits);
    });

    test.afterAll(async () => {
        await dropDatabaseIfExists(databaseName);
    });

    test.describe("Loading the diagram", () => {
        test(
            "Shows every table with its columns and the foreign keys between them",
            testCases(5878929),
            async () => {
                await expectVisibleTables(frame, ALL_TABLES);

                const customers = getTableNode(frame, "dbo.Customers");
                await expect(getColumnNode(customers, "Id", "int")).toBeVisible();
                await expect(getColumnNode(customers, "Name", "nvarchar")).toBeVisible();
                await expect(getColumnNode(customers, "Email", "nvarchar")).toBeVisible();
                const orders = getTableNode(frame, "Sales.Orders");
                await expect(getColumnNode(orders, "CustomerId", "int")).toBeVisible();
                await expect(getColumnNode(orders, "OrderDate", "datetime2")).toBeVisible();
                const orderLines = getTableNode(frame, "Sales.OrderLines");
                for (const column of ["Id", "OrderId", "ProductId", "Quantity"]) {
                    await expect(getColumnNode(orderLines, column, "int")).toBeVisible();
                }

                await expect(getRelationshipEdges(frame)).toHaveCount(SEEDED_FOREIGN_KEYS.length);
                await expect(frame.getByRole("button", { name: "Apply Changes" })).toBeDisabled();
            },
        );

        test(
            "Table columns carry their primary key and nullability",
            testCases(5878929),
            async () => {
                // The canvas shows keys only as icons, so read the metadata from Edit Table.
                const dialog = await openEditTable(frame, "dbo.Customers");
                const primaryKey = (column: string) =>
                    getEditorColumnRow(dialog, column).getByRole("checkbox", {
                        name: "Primary Key",
                    });
                await expect(primaryKey("Id")).toBeChecked();
                await expect(primaryKey("Name")).not.toBeChecked();
                await expect(primaryKey("Email")).not.toBeChecked();

                // Primary key columns are never nullable, so only the others offer Allow Null.
                for (const { column, allowNull } of [
                    { column: "Name", allowNull: false },
                    { column: "Email", allowNull: true },
                ]) {
                    await getEditorColumnRow(dialog, column)
                        .getByRole("button", { name: "Advanced options" })
                        .click();
                    const allowNullCheckbox = frame.getByRole("checkbox", { name: "Allow Null" });
                    await expect(allowNullCheckbox).toBeChecked({ checked: allowNull });
                    await page.keyboard.press("Escape");
                    await expect(allowNullCheckbox).toBeHidden();
                }
                await dialog.getByRole("button", { name: "Cancel" }).click();
                await expect(dialog).toBeHidden();
            },
        );

        test(
            "Zoom controls and dragging the canvas move the diagram",
            testCases(5878929),
            async () => {
                const canvas = getCanvas(frame);
                const table = "Sales.Orders";
                const initialWidth = await getRenderedWidth(frame, table);

                await canvas.getByRole("button", { name: "Zoom In" }).click();
                await expect
                    .poll(() => getRenderedWidth(frame, table))
                    .toBeGreaterThan(initialWidth * 1.1);

                await canvas.getByRole("button", { name: "Zoom Out" }).click();
                await canvas.getByRole("button", { name: "Zoom Out" }).click();
                await expect
                    .poll(() => getRenderedWidth(frame, table))
                    .toBeLessThan(initialWidth * 0.9);

                await canvas.getByRole("button", { name: "Fit View" }).click();
                for (const name of ALL_TABLES) {
                    await expect.poll(() => isInsideCanvas(frame, name)).toBe(true);
                }

                // Fit View leaves a margin around the tables, so the canvas corner is empty pane.
                const before = await getCenter(getTableNode(frame, table));
                const canvasBox = (await canvas.boundingBox())!;
                const start = { x: canvasBox.x + 15, y: canvasBox.y + 15 };
                const offset = { x: 120, y: 60 };
                await page.mouse.move(start.x, start.y);
                await page.mouse.down();
                await page.mouse.move(start.x + offset.x, start.y + offset.y, { steps: 10 });
                await page.mouse.up();

                // The table moves with the pane by the distance dragged.
                await expect
                    .poll(async () => {
                        const after = await getCenter(getTableNode(frame, table));
                        return Math.max(
                            Math.abs(after.x - before.x - offset.x),
                            Math.abs(after.y - before.y - offset.y),
                        );
                    })
                    .toBeLessThan(3);
                await expectVisibleTables(frame, ALL_TABLES);
                await expect(getRelationshipEdges(frame)).toHaveCount(SEEDED_FOREIGN_KEYS.length);
            },
        );
    });

    test.describe("Definition panel", () => {
        test("Shows the whole schema as T-SQL", testCases(5878931), async () => {
            const definitionType = await openDefinitionPanel(frame);
            await selectDefinitionType(definitionType, "T-SQL");
            await expect(getDefinitionEditor(frame)).toContainText("CREATE TABLE");

            const script = await copyDefinition(app, page, frame);
            expect(getCreateTableStatement(script, "[dbo].[Customers]")).toMatch(
                /\[Id\] int NOT NULL,\s+\[Name\] nvarchar\(100\) NOT NULL,\s+\[Email\] nvarchar\(200\),\s+PRIMARY KEY \(\[Id\]\)/,
            );
            expect(getCreateTableStatement(script, "[Sales].[Orders]")).toMatch(
                /\[CustomerId\] int NOT NULL,\s+\[OrderDate\] datetime2\(7\) NOT NULL/,
            );
            for (const table of [
                "[dbo].[CustomerNotes]",
                "[dbo].[Products]",
                "[Sales].[OrderLines]",
            ]) {
                getCreateTableStatement(script, table);
            }
            expect(script).toMatch(
                foreignKeyScript(
                    "FK_OrderLines_Products",
                    "[Sales].[OrderLines]",
                    "ProductId",
                    "[dbo].[Products]",
                ),
            );
            expect(script).toMatch(
                foreignKeyScript(
                    "FK_Orders_Customers",
                    "[Sales].[Orders]",
                    "CustomerId",
                    "[dbo].[Customers]",
                ),
            );
            for (const foreignKey of SEEDED_FOREIGN_KEYS) {
                expect(script).toContain(`ADD CONSTRAINT [${foreignKey}]`);
            }
        });

        // Failed in the Linux CI build-and-test smoke run: a definition format radio button was not found.
        // TODO: Stabilize this test, then remove its @quarantine tag.
        test(
            "Renders the whole schema in ORM formats",
            { ...testCases(5878931), tag: "@quarantine" },
            async () => {
                const definitionType = await openDefinitionPanel(frame);
                await expect(definitionType.getByRole("radio")).toHaveText([
                    "T-SQL",
                    "Prisma",
                    "Sequelize",
                    "TypeORM",
                    "Drizzle",
                    "SQLAlchemy",
                    "EF Core",
                ]);

                await selectDefinitionType(definitionType, "Prisma");
                await expect(getDefinitionEditor(frame)).toContainText('provider = "sqlserver"');
                await expect(getDefinitionEditor(frame)).toContainText(
                    'schemas = ["dbo", "Sales"]',
                );
                const prisma = await copyDefinition(app, page, frame);
                for (const model of [
                    "Customers",
                    "CustomerNotes",
                    "Products",
                    "Orders",
                    "OrderLines",
                ]) {
                    expect(prisma).toContain(`model ${model} {`);
                }

                await selectDefinitionType(definitionType, "EF Core");
                await expect(getDefinitionEditor(frame)).toContainText(
                    "using Microsoft.EntityFrameworkCore;",
                );
                const efCore = await copyDefinition(app, page, frame);
                expect(efCore).toContain("public partial class CustomerNotes");
                expect(efCore).toContain('entity.ToTable("Orders", "Sales");');
                expect(efCore).toContain('entity.ToTable("Products", "dbo");');
                expect(efCore).toMatch(
                    /entity\.HasOne\(d => d\.Product\)\s+\.WithMany\(p => p\.OrderLines\)\s+\.HasForeignKey\(d => d\.ProductId\);/,
                );

                // Leave the default format selected for the next designer.
                await selectDefinitionType(definitionType, "T-SQL");
            },
        );

        test(
            "Updates when columns are added, renamed and retyped",
            testCases(5878931),
            async () => {
                const definitionType = await openDefinitionPanel(frame);
                await selectDefinitionType(definitionType, "T-SQL");

                const dialog = await openEditTable(frame, "dbo.Customers");
                await getEditorColumnRow(dialog, "Name")
                    .getByRole("textbox", { name: "Column Name" })
                    .fill("FullName");
                await setColumnType(frame, dialog, "Email", "varchar");
                await addColumn(frame, dialog, "LoyaltyPoints", "int");
                await saveTable(dialog);
                hasUnpublishedEdits = true;

                const customers = getTableNode(frame, "dbo.Customers");
                await expect(getColumnNode(customers, "FullName", "nvarchar")).toBeVisible();
                await expect(getColumnNode(customers, "Email", "varchar")).toBeVisible();
                await expect(getColumnNode(customers, "LoyaltyPoints", "int")).toBeVisible();

                const script = await copyDefinition(app, page, frame);
                const createCustomers = getCreateTableStatement(script, "[dbo].[Customers]");
                expect(createCustomers).toContain("[FullName] nvarchar(100) NOT NULL");
                expect(createCustomers).toMatch(/\[Email\] varchar\b/);
                expect(createCustomers).toMatch(/\[LoyaltyPoints\] int\b/);
                expect(createCustomers).not.toContain("[Name]");
                expect(createCustomers).not.toContain("nvarchar(200)");
            },
        );

        test("Updates when a foreign key is added", testCases(5878931), async () => {
            const definitionType = await openDefinitionPanel(frame);
            await selectDefinitionType(definitionType, "T-SQL");
            const foreignKey = "FK_CustomerNotes_Products";

            const dialog = await openEditTable(frame, "dbo.CustomerNotes");
            await addColumn(frame, dialog, "ProductId", "int");
            await dialog.getByRole("tab", { name: "Foreign Keys" }).click();
            await dialog.getByRole("button", { name: "Add new foreign key" }).click();
            await dialog.getByRole("textbox", { name: "Foreign key name" }).last().fill(foreignKey);
            await selectDropdownOption(
                frame,
                dialog.getByRole("button", { name: "Target Table" }).last(),
                "Target Table",
                "dbo.Products",
            );
            await selectDropdownOption(
                frame,
                dialog.getByRole("button", { name: "Source Column" }).last(),
                "Source Column",
                "ProductId",
            );
            await selectDropdownOption(
                frame,
                dialog.getByRole("button", { name: "Foreign Column" }).last(),
                "Foreign Column",
                "Id",
            );
            await saveTable(dialog);
            hasUnpublishedEdits = true;

            await expect(getRelationshipEdges(frame)).toHaveCount(SEEDED_FOREIGN_KEYS.length + 1);
            const script = await copyDefinition(app, page, frame);
            expect(getCreateTableStatement(script, "[dbo].[CustomerNotes]")).toMatch(
                /\[ProductId\] int\b/,
            );
            expect(script).toMatch(
                foreignKeyScript(
                    foreignKey,
                    "[dbo].[CustomerNotes]",
                    "ProductId",
                    "[dbo].[Products]",
                ),
            );
            // The existing foreign key on the table is still scripted.
            expect(script).toContain("ADD CONSTRAINT [FK_CustomerNotes_Customers]");
        });

        test(
            "Updates when a column and a foreign key are removed",
            testCases(5878931),
            async () => {
                const definitionType = await openDefinitionPanel(frame);
                await selectDefinitionType(definitionType, "T-SQL");
                const foreignKey = "FK_CustomerNotes_Customers";

                const dialog = await openEditTable(frame, "dbo.CustomerNotes");
                await getEditorColumnRow(dialog, "Note")
                    .getByRole("button", { name: "Delete" })
                    .click();
                await expect(getEditorColumnRow(dialog, "Note")).toHaveCount(0);
                await dialog.getByRole("tab", { name: "Foreign Keys" }).click();
                await dialog
                    .getByRole("button", { name: `Delete foreign key ${foreignKey}` })
                    .click();
                await expect(dialog.getByRole("textbox", { name: "Foreign key name" })).toHaveCount(
                    0,
                );
                await saveTable(dialog);
                hasUnpublishedEdits = true;

                const customerNotes = getTableNode(frame, "dbo.CustomerNotes");
                await expect(getColumnNode(customerNotes, "Note", "nvarchar")).toHaveCount(0);
                await expect(getRelationshipEdges(frame)).toHaveCount(
                    SEEDED_FOREIGN_KEYS.length - 1,
                );

                const script = await copyDefinition(app, page, frame);
                const createCustomerNotes = getCreateTableStatement(
                    script,
                    "[dbo].[CustomerNotes]",
                );
                expect(createCustomerNotes).toMatch(/\[CustomerId\] int NOT NULL/);
                expect(createCustomerNotes).not.toContain("[Note]");
                expect(script).not.toContain(foreignKey);
                expect(script).toContain("ADD CONSTRAINT [FK_Orders_Customers]");
            },
        );
    });

    test.describe("Table filter", () => {
        test(
            "Checking a schema shows only its tables and the relationships between them",
            testCases(5878932),
            async () => {
                const checklist = await openTableFilter(frame);
                const schemaItems = checklist.getByRole("treeitem", { level: 1 });
                await expect(schemaItems).toHaveCount(2);
                await expect(
                    checklist.getByRole("treeitem", { name: "dbo" }).getByRole("treeitem"),
                ).toHaveText(["CustomerNotes", "Customers", "Products"]);
                await expect(
                    checklist.getByRole("treeitem", { name: "Sales" }).getByRole("treeitem"),
                ).toHaveText(["OrderLines", "Orders"]);

                await toggleFilterItem(checklist, "dbo");
                for (const table of ["CustomerNotes", "Customers", "Products"]) {
                    await expect(
                        checklist.getByRole("treeitem", { name: table, exact: true }),
                    ).toBeChecked();
                }
                await expectVisibleTables(frame, DBO_TABLES);
                // Only CustomerNotes -> Customers stays; the Sales foreign keys are hidden.
                await expect(getRelationshipEdges(frame)).toHaveCount(1);
                await expect(getFilterButton(frame)).toHaveAccessibleName("Filter (3)");

                await frame.getByRole("button", { name: "Clear All" }).click();
                await expectVisibleTables(frame, ALL_TABLES);
                await expect(getRelationshipEdges(frame)).toHaveCount(SEEDED_FOREIGN_KEYS.length);
                await expect(getFilterButton(frame)).toHaveAccessibleName("Filter");
            },
        );

        test(
            "Search narrows the checklist and filters combine with table relationships",
            testCases(5878932),
            async () => {
                const checklist = await openTableFilter(frame);
                await frame
                    .getByRole("searchbox", { name: "Search tables to filter" })
                    .fill("Order");
                const schemaItems = checklist.getByRole("treeitem", { level: 1 });
                await expect(schemaItems).toHaveCount(1);
                await expect(schemaItems).toHaveAccessibleName("Sales");
                await expect(checklist.getByRole("treeitem", { level: 2 })).toHaveText([
                    "OrderLines",
                    "Orders",
                ]);

                await toggleFilterItem(checklist, "Sales");
                await expectVisibleTables(frame, ["Sales.Orders", "Sales.OrderLines"]);
                await expect(getRelationshipEdges(frame)).toHaveCount(1);

                await toggleFilterItem(checklist, "Orders");
                await expectVisibleTables(frame, ["Sales.OrderLines"]);
                // Both of OrderLines' foreign keys point at hidden tables, so neither is drawn.
                await expect(getRelationshipEdges(frame)).toHaveCount(0);

                const relationships = frame.getByRole("switch", {
                    name: "Show table relationships",
                });
                await relationships.click();
                await expect(relationships).toBeChecked();
                await expectVisibleTables(frame, [
                    "Sales.OrderLines",
                    "Sales.Orders",
                    "dbo.Products",
                ]);
                await expect(getRelationshipEdges(frame)).toHaveCount(2);

                await frame.getByRole("button", { name: "Clear All" }).click();
                await expectVisibleTables(frame, ALL_TABLES);
                await expect(getRelationshipEdges(frame)).toHaveCount(SEEDED_FOREIGN_KEYS.length);
            },
        );
    });

    test.describe("Find Tables", () => {
        // Failed in the Linux CI build-and-test smoke run: Find Tables reported 4 matches instead of 5.
        // TODO: Stabilize this test, then remove its @quarantine tag.
        test(
            "Matches full and partial table names",
            { ...testCases(5878933), tag: "@quarantine" },
            async () => {
                const searchBox = await openFindTables(frame, page);
                const findWidget = frame.getByRole("search", { name: "Find tables" });
                const findNext = findWidget.getByRole("button", { name: "Find Next" });

                await searchBox.fill("Customers");
                await expect(findWidget.getByText("1 of 1", { exact: true })).toBeVisible();
                await expect(getSelectedTableNode(frame)).toHaveAccessibleName(
                    "Table dbo.Customers",
                );

                // A partial name matches every table containing it and highlights the match.
                await searchBox.fill("Cust");
                await expect(findWidget.getByText("1 of 2", { exact: true })).toBeVisible();
                for (const table of ["dbo.Customers", "dbo.CustomerNotes"]) {
                    await expect(
                        getTableNode(frame, table).getByText("Cust", { exact: true }),
                    ).toBeVisible();
                }
                await expect(
                    getTableNode(frame, "Sales.Orders").getByText("Cust", { exact: true }),
                ).toHaveCount(0);

                // Only table names are searched, so a column name finds nothing.
                await searchBox.fill("Email");
                // The visible count comes first; a screen reader status repeats it.
                await expect(
                    findWidget.getByText("No results", { exact: true }).first(),
                ).toBeVisible();
                await expect(findNext).toBeDisabled();

                await searchBox.fill("Cust");
                await expect(findWidget.getByText("1 of 2", { exact: true })).toBeVisible();
                await findWidget.getByRole("button", { name: "clear" }).click();
                await expect(searchBox).toHaveValue("");
                await expect(findWidget.getByText("No results", { exact: true })).toBeVisible();
                await expect(findNext).toBeDisabled();
                await expect(getCanvas(frame).getByText("Cust", { exact: true })).toHaveCount(0);
                await expectVisibleTables(frame, ALL_TABLES);

                await findWidget.getByRole("button", { name: "Close Find" }).click();
                await expect(findWidget).toBeHidden();
            },
        );

        test("Selecting a result selects and centers its table", testCases(5878933), async () => {
            const searchBox = await openFindTables(frame, page);
            const findWidget = frame.getByRole("search", { name: "Find tables" });

            await searchBox.fill("Order");
            await expect(findWidget.getByText("1 of 2", { exact: true })).toBeVisible();
            const first = (await getSelectedTableNode(frame).getAttribute("aria-label"))!.replace(
                /^Table /,
                "",
            );
            expect(["Sales.Orders", "Sales.OrderLines"]).toContain(first);
            const second = first === "Sales.Orders" ? "Sales.OrderLines" : "Sales.Orders";
            await expect.poll(() => getDistanceFromCanvasCenter(frame, first)).toBeLessThan(30);

            await searchBox.press("Enter");
            await expect(findWidget.getByText("2 of 2", { exact: true })).toBeVisible();
            await expect(getSelectedTableNode(frame)).toHaveAccessibleName(`Table ${second}`);
            await expect.poll(() => getDistanceFromCanvasCenter(frame, second)).toBeLessThan(30);

            await findWidget.getByRole("button", { name: "Find Previous" }).click();
            await expect(findWidget.getByText("1 of 2", { exact: true })).toBeVisible();
            await expect(getSelectedTableNode(frame)).toHaveAccessibleName(`Table ${first}`);
            await expect.poll(() => getDistanceFromCanvasCenter(frame, first)).toBeLessThan(30);
        });
    });
});
