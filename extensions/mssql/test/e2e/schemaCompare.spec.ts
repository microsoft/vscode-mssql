/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { FrameLocator, Page } from "@playwright/test";
import * as fs from "fs";
import * as path from "path";
import { test, expect } from "./baseFixtures";
import {
    expandObjectExplorerPath,
    getObjectExplorerNode,
    getSeededLaunchConfig,
    runObjectExplorerContextAction,
    SEEDED_PROFILE_NAME,
} from "./utils/seededConnection";
import {
    applyChanges,
    buildFixtureProject,
    closeAllEditors,
    confirmOptionsAndRecompare,
    getDifferenceRows,
    getDifferences,
    getIncludeAllCheckbox,
    getNoDifferencesMessage,
    getSchemaCompareFrame,
    getToolbarButton,
    isDotnetAvailable,
    makeSchemaCompareTempDir,
    openOptions,
    openSchemaCompareFromPalette,
    openSchemaSelector,
    openScmp,
    readActiveEditorText,
    readOptions,
    runComparison,
    saveScmp,
    SCHEMA_COMPARE_FIXTURES,
    SCHEMA_COMPARE_TITLE,
    selectEndpoint,
    setObjectTypesAndRecompare,
    setOptions,
} from "./utils/schemaCompareHelpers";
import {
    dropDatabaseIfExists,
    querySingleValue,
    recreateDatabase,
    runSql,
    uniqueDatabaseName,
} from "./utils/sqlClient";
import { testCases } from "./utils/testCases";
import { VsCodeAppHandle } from "./utils/launchVscodeWithMsSqlExt";
import { useSharedVsCodeLifecycle } from "./utils/testLifecycle";

/** The SimpleGuitarShop fixture's tables, in foreign key order for seeding. */
const GUITAR_SHOP_TABLES = ["Categories", "Customers", "Products", "Orders", "OrderItems"];

/**
 * General options that are on by default and that the options case turns off. The manual case
 * lists them by older names ("Allow drop blocking dependencies", "Allow incompatible platform");
 * these are their current display names.
 */
const GENERAL_OPTIONS = [
    "Allow drop blocking assemblies",
    "Allow incompatible platform during deployment",
    "Allow table recreation in Publish",
    "Block on possible data loss",
    "Block on schema registration drift",
];

/** Object types that are included by default and that the options case excludes. */
const OBJECT_TYPES = [
    "Aggregates",
    "Application Roles",
    "Assemblies",
    "Asymmetric Keys",
    "Broker Priorities",
    "Tables",
];

/** Additional object types excluded when comparing against the Wingtips project. */
const PROJECT_OBJECT_TYPES = [...OBJECT_TYPES, "Views", "Stored Procedures"];

/** Seed script for the SimpleGuitarShop database, built from the fixture project's table files. */
function getGuitarShopScript(): string {
    return GUITAR_SHOP_TABLES.map((table) =>
        fs.readFileSync(
            path.join(SCHEMA_COMPARE_FIXTURES, "SimpleGuitarShop", "dbo", "Tables", `${table}.sql`),
            "utf8",
        ),
    ).join("\nGO\n");
}

function guitarShopTableNames(): string[] {
    return GUITAR_SHOP_TABLES.map((table) => `dbo.${table}`).sort();
}

async function countUserTables(database: string): Promise<number> {
    return (await querySingleValue<number>("SELECT COUNT(*) FROM sys.tables;", database)) ?? 0;
}

/** Expects exactly the five SimpleGuitarShop tables, all with `action`. */
async function expectGuitarShopTables(frame: FrameLocator, action: "Add" | "Delete") {
    await expect(getDifferenceRows(frame)).toHaveCount(GUITAR_SHOP_TABLES.length);
    const differences = await getDifferences(frame);
    expect(differences.map((difference) => difference.type)).toEqual(
        GUITAR_SHOP_TABLES.map(() => "Table"),
    );
    expect(differences.map((difference) => difference.name).sort()).toEqual(guitarShopTableNames());
    expect(differences.every((difference) => difference.action === action)).toBe(true);
}

/** Generates the deployment script and checks it opened in its own editor with every table. */
async function generateAndCheckScript(app: VsCodeAppHandle, page: Page, frame: FrameLocator) {
    const tabs = page.getByRole("tab");
    const tabCountBefore = await tabs.count();
    await getToolbarButton(frame, "Generate Script").click();
    await expect(tabs).toHaveCount(tabCountBefore + 1, { timeout: 2 * 60 * 1000 });
    const script = await readActiveEditorText(app, page);
    for (const table of GUITAR_SHOP_TABLES) {
        expect(script).toContain(`CREATE TABLE [dbo].[${table}]`);
    }
}

/**
 * Schema Compare: database, dacpac, and SQL project endpoints in each direction, the Options
 * drawer, Generate Script and Apply, and saving and reopening comparisons as .scmp files.
 * Dacpacs are built at test time from the SDK-style fixture projects in
 * test/resources/e2e/schemaCompare, and SimpleGuitarShop is seeded from that project's tables.
 */
test.describe("Schema Compare", () => {
    test.skip(!isDotnetAvailable(), "The .NET SDK is required to build the fixture dacpacs.");

    const guitarShopDb = uniqueDatabaseName("SimpleGuitarShop");
    const emptyDb = uniqueDatabaseName("EmptyDb");
    const emptyDb2 = uniqueDatabaseName("EmptyDb2");
    let workDir: string;
    let guitarShopDacpac: string;
    let emptyDacpac: string;
    let wingtipsDacpac: string;
    let wingtipsProject: string;

    test.beforeAll(async () => {
        workDir = makeSchemaCompareTempDir();
        guitarShopDacpac = buildFixtureProject("SimpleGuitarShop", workDir).dacpac;
        emptyDacpac = buildFixtureProject("Empty", workDir).dacpac;
        ({ dacpac: wingtipsDacpac, projectFile: wingtipsProject } = buildFixtureProject(
            "Wingtips",
            workDir,
        ));
    });

    /** Databases this run created, dropped in afterAll. */
    const createdDatabases = new Set<string>();

    /** Creates an empty database, or the seeded SimpleGuitarShop one, unless it already exists. */
    async function ensureDatabase(database: string): Promise<void> {
        if (createdDatabases.has(database)) {
            return;
        }
        await recreateDatabase(database);
        createdDatabases.add(database);
        if (database === guitarShopDb) {
            await runSql(getGuitarShopScript(), guitarShopDb);
        }
    }

    const getContext = useSharedVsCodeLifecycle({
        launchOptions: {
            // Keeps the chat side bar from squeezing the Schema Compare toolbar and grid.
            initialConfig: getSeededLaunchConfig({
                "workbench.secondarySideBar.defaultVisibility": "hidden",
            }),
        },
        afterEach: async ({ page }) => {
            await closeAllEditors(page);
        },
    });

    test.afterAll(async () => {
        for (const database of createdDatabases) {
            await dropDatabaseIfExists(database);
        }
        if (workDir) {
            fs.rmSync(workDir, { recursive: true, force: true });
        }
    });

    /** Returns to the Schema Compare tab after a generated script took focus. */
    async function returnToSchemaCompare(page: Page): Promise<FrameLocator> {
        await page.getByRole("tab", { name: new RegExp(`^${SCHEMA_COMPARE_TITLE}`) }).click();
        return getSchemaCompareFrame(page);
    }

    test(
        "Database to database: compare, generate script, filter object types, and apply",
        testCases(5878896),
        async () => {
            const { electronApp, page } = getContext();
            await ensureDatabase(guitarShopDb);
            await ensureDatabase(emptyDb);

            await expandObjectExplorerPath(page, [SEEDED_PROFILE_NAME, "Databases"]);
            await runObjectExplorerContextAction(
                page,
                getObjectExplorerNode(page, guitarShopDb),
                "Compare Schemas...",
            );
            let frame = await getSchemaCompareFrame(page);
            await expect(frame.getByRole("textbox", { name: "Source", exact: true })).toHaveValue(
                new RegExp(`\\.${guitarShopDb}$`),
            );

            await selectEndpoint(page, frame, "target", {
                kind: "database",
                connection: SEEDED_PROFILE_NAME,
                database: emptyDb,
            });
            await runComparison(frame);
            await expectGuitarShopTables(frame, "Add");

            await generateAndCheckScript(electronApp, page, frame);
            frame = await returnToSchemaCompare(page);

            await setObjectTypesAndRecompare(page, frame, ["Tables"], false);
            await expect(getNoDifferencesMessage(frame)).toBeVisible();

            await setObjectTypesAndRecompare(page, frame, ["Tables"], true);
            await expectGuitarShopTables(frame, "Add");

            await applyChanges(page, frame);
            expect(await countUserTables(emptyDb)).toBe(GUITAR_SHOP_TABLES.length);
        },
    );

    test(
        "Dacpac to database: compare, generate script, include all, filter, and apply",
        testCases(5878897),
        async () => {
            const { electronApp, page } = getContext();
            await ensureDatabase(emptyDb2);
            let frame = await openSchemaCompareFromPalette(page);
            await selectEndpoint(page, frame, "source", { kind: "dacpac", file: guitarShopDacpac });
            await selectEndpoint(page, frame, "target", {
                kind: "database",
                connection: SEEDED_PROFILE_NAME,
                database: emptyDb2,
            });
            await runComparison(frame);
            await expectGuitarShopTables(frame, "Add");

            await generateAndCheckScript(electronApp, page, frame);
            frame = await returnToSchemaCompare(page);

            const includeAll = getIncludeAllCheckbox(frame);
            await expect(includeAll).toBeChecked();
            await includeAll.click();
            await expect(includeAll).not.toBeChecked();
            await expect
                .poll(async () => (await getDifferences(frame)).map((d) => d.included))
                .toEqual(GUITAR_SHOP_TABLES.map(() => false));
            await expect(getToolbarButton(frame, "Generate Script")).toBeDisabled();
            await expect(getToolbarButton(frame, "Apply")).toBeDisabled();

            await includeAll.click();
            await expect(includeAll).toBeChecked();
            await expect
                .poll(async () => (await getDifferences(frame)).map((d) => d.included))
                .toEqual(GUITAR_SHOP_TABLES.map(() => true));

            await setObjectTypesAndRecompare(page, frame, ["Tables"], false);
            await expect(getNoDifferencesMessage(frame)).toBeVisible();

            await setObjectTypesAndRecompare(page, frame, ["Tables"], true);
            await expectGuitarShopTables(frame, "Add");

            await applyChanges(page, frame);
            expect(await countUserTables(emptyDb2)).toBe(GUITAR_SHOP_TABLES.length);
        },
    );

    test(
        "Dacpac to dacpac: diff editor, disabled script and apply, switch direction, filter",
        testCases(5878898),
        async () => {
            const { page } = getContext();
            const frame = await openSchemaCompareFromPalette(page);
            await selectEndpoint(page, frame, "source", { kind: "dacpac", file: guitarShopDacpac });
            await selectEndpoint(page, frame, "target", { kind: "dacpac", file: emptyDacpac });
            await runComparison(frame);
            await expectGuitarShopTables(frame, "Add");

            const details = frame.getByRole("region", { name: "Comparison Details" });
            for (const table of GUITAR_SHOP_TABLES) {
                const row = getDifferenceRows(frame, "Table").filter({
                    has: frame.getByText(`dbo.${table}`, { exact: true }),
                });
                await row.click();
                await expect(row).toHaveAttribute("aria-selected", "true");
                await expect(details).toContainText(`CREATE TABLE [dbo].[${table}]`);
            }

            await expect(getToolbarButton(frame, "Generate Script")).toBeDisabled();
            await expect(getToolbarButton(frame, "Apply")).toBeDisabled();

            await getToolbarButton(frame, "Switch Direction").click();
            await expect
                .poll(async () => (await getDifferences(frame)).map((d) => d.action), {
                    timeout: 2 * 60 * 1000,
                })
                .toEqual(GUITAR_SHOP_TABLES.map(() => "Delete"));

            await setObjectTypesAndRecompare(page, frame, ["Tables"], false);
            await expect(getNoDifferencesMessage(frame)).toBeVisible();

            await setObjectTypesAndRecompare(page, frame, ["Tables"], true);
            await expectGuitarShopTables(frame, "Delete");
        },
    );

    test(
        "Database to dacpac: excluding tables leaves no table differences",
        testCases(5878899),
        async () => {
            const { page } = getContext();
            await ensureDatabase(guitarShopDb);
            const frame = await openSchemaCompareFromPalette(page);
            await selectEndpoint(page, frame, "source", {
                kind: "database",
                connection: SEEDED_PROFILE_NAME,
                database: guitarShopDb,
            });
            await selectEndpoint(page, frame, "target", { kind: "dacpac", file: wingtipsDacpac });
            await runComparison(frame);
            await expect(getDifferenceRows(frame, "Table").first()).toBeVisible();

            await setObjectTypesAndRecompare(page, frame, ["Tables"], false);
            await expect(getDifferenceRows(frame).first()).toBeVisible();
            const differences = await getDifferences(frame);
            expect(differences.filter((difference) => difference.type === "Table")).toEqual([]);

            await expect(getToolbarButton(frame, "Generate Script")).toBeDisabled();
            await expect(getToolbarButton(frame, "Apply")).toBeDisabled();
        },
    );

    /**
     * Turns off the case's general options and object types, compares, saves the comparison to
     * an .scmp file, reopens Schema Compare with that file, and checks the options and results
     * survived the round trip.
     */
    async function verifyOptionsSurviveScmp(
        page: Page,
        target: { kind: "dacpac" | "sqlproj"; file: string },
        objectTypes: string[],
        scmpName: string,
        expectResults: (frame: FrameLocator) => Promise<void>,
    ): Promise<void> {
        let frame = await openSchemaCompareFromPalette(page);
        await selectEndpoint(page, frame, "source", { kind: "dacpac", file: guitarShopDacpac });
        await selectEndpoint(page, frame, "target", target);

        const allSetTo = (labels: string[], checked: boolean) =>
            Object.fromEntries(labels.map((label) => [label, checked]));
        let drawer = await openOptions(frame);
        expect(await readOptions(drawer, "General Options", GENERAL_OPTIONS)).toEqual(
            allSetTo(GENERAL_OPTIONS, true),
        );
        expect(await readOptions(drawer, "Include Object Types", objectTypes)).toEqual(
            allSetTo(objectTypes, true),
        );
        await setOptions(drawer, "General Options", GENERAL_OPTIONS, false);
        await setOptions(drawer, "Include Object Types", objectTypes, false);
        await confirmOptionsAndRecompare(page, frame, drawer);
        await expectResults(frame);

        const scmpPath = path.join(workDir, scmpName);
        await saveScmp(page, frame, scmpPath);
        await closeAllEditors(page);

        frame = await openSchemaCompareFromPalette(page);
        await openScmp(page, frame, scmpPath);
        await expect(frame.getByRole("textbox", { name: "Source", exact: true })).toHaveValue(
            guitarShopDacpac,
        );
        await expect(frame.getByRole("textbox", { name: "Target", exact: true })).toHaveValue(
            target.file,
        );

        drawer = await openOptions(frame);
        expect(await readOptions(drawer, "General Options", GENERAL_OPTIONS)).toEqual(
            allSetTo(GENERAL_OPTIONS, false),
        );
        expect(await readOptions(drawer, "Include Object Types", objectTypes)).toEqual(
            allSetTo(objectTypes, false),
        );
        await drawer.getByRole("button", { name: "OK", exact: true }).click();
        await expect(drawer).toBeHidden();

        await runComparison(frame);
        await expectResults(frame);
    }

    test(
        "Options and .scmp: dacpac to dacpac options persist through save and open",
        testCases(5878900),
        async () => {
            const { page } = getContext();
            await verifyOptionsSurviveScmp(
                page,
                { kind: "dacpac", file: emptyDacpac },
                OBJECT_TYPES,
                "dacpacToDacpac.scmp",
                async (frame) => {
                    await expect(getNoDifferencesMessage(frame)).toBeVisible();
                },
            );
        },
    );

    test(
        "Options and .scmp: dacpac to SQL project options persist through save and open",
        testCases(5878900),
        async () => {
            const { page } = getContext();
            await verifyOptionsSurviveScmp(
                page,
                { kind: "sqlproj", file: wingtipsProject },
                PROJECT_OBJECT_TYPES,
                "dacpacToProject.scmp",
                async (frame) => {
                    await expect(getDifferenceRows(frame)).toHaveCount(2);
                    const differences = await getDifferences(frame);
                    expect(differences.map((difference) => difference.type).sort()).toEqual([
                        "Function",
                        "Schema",
                    ]);
                },
            );
        },
    );

    test("Database source type offers the saved connections", testCases(5878901), async () => {
        const { page } = getContext();
        const frame = await openSchemaCompareFromPalette(page);
        const drawer = await openSchemaSelector(frame, "source");
        const databaseType = drawer.getByRole("radio", { name: "Database", exact: true });
        await databaseType.check();
        await expect(databaseType).toBeChecked();

        const connection = drawer.getByRole("button", { name: "Connection", exact: true });
        await expect(connection).toBeEnabled();
        await connection.click();
        await expect(
            frame.getByRole("option", { name: SEEDED_PROFILE_NAME, exact: true }),
        ).toBeVisible();
    });
});
