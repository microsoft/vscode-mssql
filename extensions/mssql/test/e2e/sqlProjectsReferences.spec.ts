/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from "fs";
import * as path from "path";
import { test, expect } from "./baseFixtures";
import { QuickInput } from "./pageObjects/quickInput";
import { getSeededLaunchConfig } from "./utils/seededConnection";
import {
    dropDatabaseIfExists,
    querySingleValue,
    recreateDatabase,
    runSql,
    uniqueDatabaseName,
} from "./utils/sqlClient";
import {
    acceptSimpleDialogPath,
    answerModalDialog,
    buildProjectFromTree,
    choosePublishTarget,
    closeAllEditors,
    clearNotifications,
    expectFileNotToContain,
    expectFileToContain,
    generatePublishScript,
    getDacpacPath,
    getLabelOnlyTreeItem,
    getProjectTreeItem,
    getPublishSqlCmdValue,
    getSqlProjectSettings,
    killAllTerminals,
    openProjectsView,
    openPublishDialog,
    readText,
    removeDir,
    reserveTempDir,
    revealProjectTreeItem,
    runProjectContextAction,
    sqlCmdVariablePattern,
    setPublishAdvancedOption,
    sqlprojPath,
    submitInputBox,
    waitForNotification,
    waitForQuickInputTitle,
    writeLegacyProject,
} from "./utils/sqlProjectHelpers";
import { testCases } from "./utils/testCases";
import { useSharedVsCodeLifecycle } from "./utils/testLifecycle";

type ReferenceLocation = "Same database" | "Different database, same server";

/**
 * SQL Database Projects - database references. A main project references two dacpacs, two other
 * projects and the master system database, each either in the same or in a different database.
 * Views in the main project use every reference, so a successful build proves they resolve.
 */
test.describe("SQL Database Projects - database references", () => {
    const workspaceDir = reserveTempDir("sqlproj-refs");
    const main = "RefMain";
    const libraries = ["RefLibSame", "RefLibOther", "RefProjSame", "RefProjOther"];

    // Declared before the lifecycle hooks so the projects exist when VS Code opens the folder.
    test.beforeAll(() => {
        for (const name of [main, ...libraries]) {
            writeLegacyProject(workspaceDir, name);
        }
    });
    const mainDir = path.join(workspaceDir, main);
    const mainFile = path.join(mainDir, `${main}.sqlproj`);
    const databasesToDrop: string[] = [];

    const getContext = useSharedVsCodeLifecycle({
        launchOptions: {
            initialConfig: getSeededLaunchConfig(getSqlProjectSettings(workspaceDir)),
            extraLaunchArgs: [workspaceDir],
        },
        afterLaunch: async ({ page }) => {
            await openProjectsView(page);
            await expect(getProjectTreeItem(page, main)).toBeVisible({ timeout: 60 * 1000 });
        },
        afterEach: async ({ page }) => {
            await new QuickInput(page).close();
        },
        beforeClose: async ({ page }) => {
            await killAllTerminals(page);
        },
    });

    test.afterAll(async () => {
        for (const database of databasesToDrop) {
            await dropDatabaseIfExists(database);
        }
        removeDir(workspaceDir);
    });

    /** Starts "Add Database Reference" on the main project and picks the reference type. */
    async function startAddReference(type: string): Promise<QuickInput> {
        const { page } = getContext();
        const quickInput = new QuickInput(page);
        await runProjectContextAction(
            page,
            await revealProjectTreeItem(page, main, "Database References"),
            "Add Database Reference",
            quickInput.widget,
        );
        await waitForQuickInputTitle(page, "Referenced Database type");
        await quickInput.pick(type);
        return quickInput;
    }

    /** Answers the location, database name/variable and suppress-errors prompts. */
    async function answerLocationPrompts(
        quickInput: QuickInput,
        location: ReferenceLocation,
        databaseVariable: string | undefined,
        afterLocation?: () => Promise<void>,
    ): Promise<void> {
        const { page } = getContext();
        await waitForQuickInputTitle(page, "Location");
        await quickInput.pick(location);
        await afterLocation?.();
        if (databaseVariable) {
            await waitForQuickInputTitle(page, "Database name");
            await submitInputBox(page, databaseVariable);
            await waitForQuickInputTitle(page, "Database variable");
            await submitInputBox(page, databaseVariable);
        }
        await waitForQuickInputTitle(page, "Suppress errors");
        await quickInput.pick("No (default)");
    }

    async function addDacpacReference(
        library: string,
        location: ReferenceLocation,
        databaseVariable?: string,
    ): Promise<void> {
        const { page } = getContext();
        const quickInput = await startAddReference("Data-tier application (.dacpac)");
        await answerLocationPrompts(quickInput, location, databaseVariable, async () => {
            await waitForQuickInputTitle(page, "Select .dacpac");
            await quickInput.pick("Browse...");
            await acceptSimpleDialogPath(
                page,
                getDacpacPath(path.join(workspaceDir, library, `${library}.sqlproj`)),
            );
        });
    }

    async function addProjectReference(
        library: string,
        location: ReferenceLocation,
        databaseVariable?: string,
    ): Promise<void> {
        const { page } = getContext();
        const quickInput = await startAddReference("Project (.sqlproj)");
        await waitForQuickInputTitle(page, "Database project");
        await quickInput.pick(library);
        await answerLocationPrompts(quickInput, location, databaseVariable);
    }

    /** Writes a view into the main project and adds it with "Add Existing Item...". */
    async function addMainView(name: string, body: string): Promise<void> {
        const { page } = getContext();
        const viewsDir = path.join(mainDir, "dbo", "Views");
        fs.mkdirSync(viewsDir, { recursive: true });
        const file = path.join(viewsDir, `${name}.sql`);
        fs.writeFileSync(file, `CREATE VIEW [dbo].[${name}]\n  AS ${body}\n`);
        await runProjectContextAction(
            page,
            await revealProjectTreeItem(page, main),
            "Add Existing Item...",
            new QuickInput(page).widget,
        );
        await acceptSimpleDialogPath(page, file);
        await expectFileToContain(mainFile, sqlprojPath(`dbo/Views/${name}.sql`));
    }

    test(
        "add dacpac references to the same and a different database, then build",
        testCases(5878850),
        async () => {
            const { page } = getContext();
            for (const library of ["RefLibSame", "RefLibOther"]) {
                await buildProjectFromTree(
                    page,
                    path.join(workspaceDir, library, `${library}.sqlproj`),
                );
            }

            await addDacpacReference("RefLibSame", "Same database");
            await expectFileToContain(
                mainFile,
                sqlprojPath("../RefLibSame/bin/Debug/RefLibSame.dacpac"),
            );
            await addDacpacReference("RefLibOther", "Different database, same server", "OtherDb");
            await expectFileToContain(
                mainFile,
                sqlprojPath("../RefLibOther/bin/Debug/RefLibOther.dacpac"),
            );
            await expectFileToContain(
                mainFile,
                /<DatabaseSqlCmdVariable>OtherDb<\/DatabaseSqlCmdVariable>/,
            );
            await expectFileToContain(mainFile, sqlCmdVariablePattern("OtherDb", "OtherDb"));

            await revealProjectTreeItem(page, main, "Database References/RefLibSame");
            await revealProjectTreeItem(page, main, "Database References/RefLibOther");

            await addMainView("UsesLibSame", "SELECT [Id] FROM [dbo].[RefLibSameTable]");
            await addMainView(
                "UsesLibOther",
                "SELECT [Id] FROM [$(OtherDb)].[dbo].[RefLibOtherTable]",
            );
            await buildProjectFromTree(page, mainFile);
        },
    );

    // Each project reference is built on its own: a legacy project with two project references
    // fails a parallel `dotnet build` with SQL72025 ("referenced assembly ... is corrupt"), which
    // is a build tooling issue rather than something these steps cover.
    test(
        "add a same-database project reference, build, then delete it from the tree",
        testCases(5878850),
        async () => {
            const { page } = getContext();
            await addProjectReference("RefProjSame", "Same database");
            await expectFileToContain(mainFile, sqlprojPath("../RefProjSame/RefProjSame.sqlproj"));
            const referenceNode = await revealProjectTreeItem(
                page,
                main,
                "Database References/RefProjSame",
            );
            await addMainView("UsesProjSame", "SELECT [Id] FROM [dbo].[RefProjSameTable]");
            await buildProjectFromTree(page, mainFile);

            await runProjectContextAction(page, referenceNode, "Delete");
            await answerModalDialog(
                page,
                "Yes",
                "Are you sure you want to delete the reference to RefProjSame?",
            );
            await expectFileNotToContain(
                mainFile,
                sqlprojPath("../RefProjSame/RefProjSame.sqlproj"),
            );
            await expect(getLabelOnlyTreeItem(page, "RefProjSame")).toHaveCount(0);
            await runProjectContextAction(
                page,
                await revealProjectTreeItem(page, main, "dbo/Views/UsesProjSame.sql"),
                "Exclude from project",
            );
            await expectFileNotToContain(mainFile, sqlprojPath("dbo/Views/UsesProjSame.sql"));
        },
    );

    test("add a different-database project reference, then build", testCases(5878850), async () => {
        const { page } = getContext();
        await addProjectReference("RefProjOther", "Different database, same server", "ProjOtherDb");
        await expectFileToContain(mainFile, sqlprojPath("../RefProjOther/RefProjOther.sqlproj"));
        await expectFileToContain(
            mainFile,
            /<DatabaseSqlCmdVariable>ProjOtherDb<\/DatabaseSqlCmdVariable>/,
        );
        await expectFileToContain(mainFile, sqlCmdVariablePattern("ProjOtherDb", "ProjOtherDb"));
        await revealProjectTreeItem(page, main, "Database References/RefProjOther");

        await addMainView(
            "UsesProjOther",
            "SELECT [Id] FROM [$(ProjOtherDb)].[dbo].[RefProjOtherTable]",
        );
        // Building the main project builds the referenced project too.
        const referencedDacpac = getDacpacPath(
            path.join(workspaceDir, "RefProjOther", "RefProjOther.sqlproj"),
        );
        fs.rmSync(referencedDacpac, { force: true });
        await buildProjectFromTree(page, mainFile);
        expect(fs.existsSync(referencedDacpac)).toBe(true);
    });

    test(
        "add a master reference whose path follows the target platform, then build",
        testCases(5878850),
        async () => {
            const { page } = getContext();
            const quickInput = await startAddReference("System database");
            await waitForQuickInputTitle(page, "System database");
            expect(await quickInput.labels()).toEqual(["master", "msdb"]);
            await quickInput.pick("master");
            await waitForQuickInputTitle(page, "Database name");
            await submitInputBox(page, "master");
            await waitForQuickInputTitle(page, "Suppress errors");
            await quickInput.pick("No (default)");

            // The fixture targets SQL Server 2022 (Sql160).
            await expectFileToContain(mainFile, /SystemDacpacs\\160\\master\.dacpac/);
            await expectFileToContain(mainFile, /SqlServer\\160\\SqlSchemas\\master\.dacpac/);
            await revealProjectTreeItem(page, main, "Database References/master");
            await addMainView("UsesMaster", "SELECT [name] FROM [sys].[objects]");
            await buildProjectFromTree(page, mainFile);

            await runProjectContextAction(
                page,
                await revealProjectTreeItem(page, main),
                "Change Target Platform",
                quickInput.widget,
            );
            await quickInput.pick("SQL Server 2019");
            await waitForNotification(
                page,
                `Target platform of the project ${main} is now SQL Server 2019`,
            );
            await expectFileToContain(
                mainFile,
                "Microsoft.Data.Tools.Schema.Sql.Sql150DatabaseSchemaProvider",
            );
            await expectFileToContain(mainFile, /SystemDacpacs\\150\\master\.dacpac/);
            await expectFileToContain(mainFile, /SqlServer\\150\\SqlSchemas\\master\.dacpac/);
            await expectFileNotToContain(mainFile, /\\160\\/);
            await buildProjectFromTree(page, mainFile);
        },
    );

    test(
        "refuse to delete a SQLCMD variable a reference uses or to add a duplicate reference",
        testCases(5878850),
        async () => {
            const { page } = getContext();
            await clearNotifications(page);
            await runProjectContextAction(
                page,
                await revealProjectTreeItem(page, main, "SQLCMD Variables/OtherDb"),
                "Delete",
            );
            await answerModalDialog(
                page,
                "Yes",
                "Are you sure you want to delete the SQLCMD Variable 'OtherDb'?",
            );
            await waitForNotification(
                page,
                "SQLCMD variable 'OtherDb' cannot be deleted because it's used by a database reference.",
            );
            expect(readText(mainFile)).toMatch(sqlCmdVariablePattern("OtherDb", "OtherDb"));
            await expect(getLabelOnlyTreeItem(page, "OtherDb")).toBeVisible();

            await clearNotifications(page);
            const before = readText(mainFile);
            await addDacpacReference("RefLibSame", "Same database");
            await waitForNotification(
                page,
                "A reference to this database already exists in this project",
            );
            expect(readText(mainFile)).toBe(before);
        },
    );

    test(
        "publish and generate a script using the references' SQLCMD variables",
        testCases(5878850),
        async () => {
            const { page } = getContext();
            const target = uniqueDatabaseName("SqlProjRefs");
            const otherDb = uniqueDatabaseName("SqlProjRefsOther");
            const projOtherDb = uniqueDatabaseName("SqlProjRefsProjOther");
            databasesToDrop.push(target, otherDb, projOtherDb);
            // Views in other databases need their tables to exist before deployment.
            await recreateDatabase(otherDb);
            await runSql(
                "CREATE TABLE dbo.RefLibOtherTable (Id INT NOT NULL PRIMARY KEY);",
                otherDb,
            );
            await recreateDatabase(projOtherDb);
            await runSql(
                "CREATE TABLE dbo.RefProjOtherTable (Id INT NOT NULL PRIMARY KEY);",
                projOtherDb,
            );

            await closeAllEditors(page);
            let dialog = await openPublishDialog(page, main);
            await choosePublishTarget(dialog, target);
            // Variables added for references to other databases show up with their defaults.
            await expect(getPublishSqlCmdValue(dialog, "OtherDb")).toHaveValue("OtherDb");
            await expect(getPublishSqlCmdValue(dialog, "ProjOtherDb")).toHaveValue("ProjOtherDb");
            await getPublishSqlCmdValue(dialog, "OtherDb").fill(otherDb);
            await getPublishSqlCmdValue(dialog, "ProjOtherDb").fill(projOtherDb);
            await getPublishSqlCmdValue(dialog, "ProjOtherDb").press("Tab");
            // The same-database dacpac's objects are only deployed as composite objects.
            await setPublishAdvancedOption(dialog, "Include composite objects", true);

            const script = await generatePublishScript(
                page,
                dialog,
                path.join(workspaceDir, "references-deploy.sql"),
            );
            expect(script).toContain(`:setvar OtherDb "${otherDb}"`);
            expect(script).toContain(`:setvar ProjOtherDb "${projOtherDb}"`);
            expect(script).toMatch(/CREATE VIEW \[dbo\]\.\[UsesLibOther\]/);
            // Same-database references are deployed together with the project.
            expect(script).toMatch(/CREATE TABLE \[dbo\]\.\[RefLibSameTable\]/);
            await closeAllEditors(page);

            dialog = await openPublishDialog(page, main);
            await choosePublishTarget(dialog, target);
            await getPublishSqlCmdValue(dialog, "OtherDb").fill(otherDb);
            await getPublishSqlCmdValue(dialog, "ProjOtherDb").fill(projOtherDb);
            await getPublishSqlCmdValue(dialog, "ProjOtherDb").press("Tab");
            // The same-database dacpac's objects are only deployed as composite objects.
            await setPublishAdvancedOption(dialog, "Include composite objects", true);
            await dialog.getByRole("button", { name: "Publish", exact: true }).click();

            await expect
                .poll(
                    () =>
                        querySingleValue<number>(
                            "SELECT COUNT(*) FROM sys.views WHERE name LIKE N'Uses%'",
                            target,
                        ).catch(() => 0),
                    { timeout: 3 * 60 * 1000 },
                )
                .toBe(readText(mainFile).match(/<Build Include="dbo\\Views\\Uses/g)?.length);
            expect(
                await querySingleValue<number>(
                    "SELECT COUNT(*) FROM sys.tables WHERE name = N'RefLibSameTable'",
                    target,
                ),
            ).toBe(1);
        },
    );

    test("delete database references from the project tree", testCases(5878850), async () => {
        const { page } = getContext();
        const references = [
            { name: "RefLibSame", entry: "../RefLibSame/bin/Debug/RefLibSame.dacpac" },
            { name: "RefProjOther", entry: "../RefProjOther/RefProjOther.sqlproj" },
        ];
        for (const reference of references) {
            await runProjectContextAction(
                page,
                await revealProjectTreeItem(page, main, `Database References/${reference.name}`),
                "Delete",
            );
            await answerModalDialog(
                page,
                "Yes",
                `Are you sure you want to delete the reference to ${reference.name}?`,
            );
            await expectFileNotToContain(mainFile, sqlprojPath(reference.entry));
            await expect(getLabelOnlyTreeItem(page, reference.name)).toHaveCount(0);
        }
    });
});
