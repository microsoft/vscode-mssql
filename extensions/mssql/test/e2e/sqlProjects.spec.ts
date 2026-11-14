/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from "fs";
import * as path from "path";
import { Page } from "@playwright/test";
import { test, expect } from "./baseFixtures";
import { QuickInput } from "./pageObjects/quickInput";
import { getSeededLaunchConfig } from "./utils/seededConnection";
import { dropDatabaseIfExists, querySingleValue, uniqueDatabaseName } from "./utils/sqlClient";
import {
    acceptSimpleDialogPath,
    addItemFromTree,
    answerModalDialog,
    buildProjectFromTree,
    choosePublishTarget,
    closeAllEditors,
    createNewProject,
    expectFileNotToContain,
    expectFileToContain,
    generatePublishScript,
    getDacpacPath,
    getProjectsViewToolbar,
    getQuickInputBox,
    getProjectTreeItem,
    getPublishSqlCmdValue,
    getSqlProjectSettings,
    getTaskTerminal,
    killAllTerminals,
    openProjectsView,
    openPublishDialog,
    readText,
    revealProjectTreeItem,
    removeDir,
    reserveTempDir,
    runProjectContextAction,
    SQL_PROJECT_FIXTURES,
    sqlCmdVariablePattern,
    sqlprojPath,
    submitInputBox,
    waitForFile,
    waitForFileToBeRemoved,
    waitForProjectFile,
    waitForQuickInputTitle,
} from "./utils/sqlProjectHelpers";
import { testCases } from "./utils/testCases";
import { useSharedVsCodeLifecycle } from "./utils/testLifecycle";
import { getModifierKey } from "./utils/testHelpers";

const SDK_PATTERN = /Microsoft\.Build\.Sql/;

type ProjectStyle = { name: "Legacy" | "Sdk"; sdkStyle: boolean };
const PROJECT_STYLES: ProjectStyle[] = [
    { name: "Legacy", sdkStyle: false },
    { name: "Sdk", sdkStyle: true },
];

/**
 * SQL Database Projects: new project templates, build and publish of project items, SQLCMD
 * variables, and the build tasks the extension contributes. One VS Code instance is opened on a
 * temporary folder that is also the default project save location, so every project created here
 * lands inside the workspace and shares its .vscode/tasks.json.
 */
test.describe("SQL Database Projects", () => {
    const workspaceDir = reserveTempDir("sqlproj");
    const databasesToDrop: string[] = [];

    // Declared before the lifecycle hooks so the folder exists when VS Code opens it.
    test.beforeAll(() => {
        fs.mkdirSync(workspaceDir, { recursive: true });
    });

    const getContext = useSharedVsCodeLifecycle({
        launchOptions: {
            initialConfig: getSeededLaunchConfig(getSqlProjectSettings(workspaceDir)),
            extraLaunchArgs: [workspaceDir],
        },
        afterLaunch: async ({ page }) => {
            await openProjectsView(page);
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

    /** Creates a project unless an earlier test in this instance already did. */
    async function ensureProject(
        name: string,
        options: Parameters<typeof newProject>[1],
    ): Promise<string> {
        const projectFile = path.join(workspaceDir, name, `${name}.sqlproj`);
        if (!fs.existsSync(projectFile)) {
            await newProject(name, options);
        }
        return projectFile;
    }

    async function newProject(
        name: string,
        options: {
            sdkStyle: boolean;
            targetPlatform?: string;
            projectType?: "SQL Server Database" | "Azure SQL Database";
            configureDefaultBuild?: boolean;
        },
    ) {
        const { page } = getContext();
        return createNewProject(page, {
            name,
            location: workspaceDir,
            projectType: options.projectType,
            targetPlatform: options.targetPlatform ?? "SQL Server 2025",
            sdkStyle: options.sdkStyle,
            configureDefaultBuild: options.configureDefaultBuild ?? false,
        });
    }

    function readTasksJson(): { tasks: { label: string; group?: { isDefault?: boolean } }[] } {
        return JSON.parse(readText(path.join(workspaceDir, ".vscode", "tasks.json")));
    }

    test.describe("New project templates", () => {
        const templates = [
            {
                projectType: "SQL Server Database" as const,
                defaultPlatform: "SQL Server 2025",
                styles: [
                    { sdkStyle: false, platform: "SQL Server 2022", dsp: "Sql160" },
                    { sdkStyle: true, platform: "SQL Server 2019", dsp: "Sql150" },
                ],
            },
            {
                projectType: "Azure SQL Database" as const,
                defaultPlatform: "Azure SQL Database",
                styles: [
                    { sdkStyle: false, platform: "SQL Server 2017", dsp: "Sql140" },
                    { sdkStyle: true, platform: "SQL Server 2016", dsp: "Sql130" },
                ],
            },
        ];

        for (const template of templates) {
            for (const style of template.styles) {
                const styleName = style.sdkStyle ? "SDK-style" : "legacy";
                test(
                    `${template.projectType} template creates ${style.sdkStyle ? "an" : "a"} ${styleName} project for ${style.platform} that builds`,
                    testCases(5878855),
                    async () => {
                        const { page } = getContext();
                        const name = `Tpl${template.projectType.split(" ")[0]}${style.sdkStyle ? "Sdk" : "Legacy"}`;
                        const { projectFile, rows } = await newProject(name, {
                            projectType: template.projectType,
                            targetPlatform: style.platform,
                            sdkStyle: style.sdkStyle,
                        });

                        // The template's default platform is offered first, and a different one was chosen.
                        expect(rows.targetPlatforms[0]).toBe(template.defaultPlatform);
                        expect(style.platform).not.toBe(template.defaultPlatform);

                        const sqlproj = readText(projectFile);
                        expect(sqlproj).toContain(
                            `Microsoft.Data.Tools.Schema.Sql.${style.dsp}DatabaseSchemaProvider`,
                        );
                        if (style.sdkStyle) {
                            expect(sqlproj).toMatch(SDK_PATTERN);
                        } else {
                            expect(sqlproj).not.toMatch(SDK_PATTERN);
                        }

                        await buildProjectFromTree(page, projectFile);
                    },
                );
            }
        }
    });

    test.describe("Build tasks", () => {
        const defaultProject = "BuildTaskDefault";
        const otherProject = "BuildTaskOther";

        test(
            "new project asks whether to configure the default build and writes tasks.json",
            testCases(5878860),
            async () => {
                const yes = await newProject(defaultProject, {
                    sdkStyle: false,
                    configureDefaultBuild: true,
                });
                expect(yes.rows.defaultBuildOptions).toEqual(["Yes", "No"]);
                const no = await newProject(otherProject, {
                    sdkStyle: false,
                    configureDefaultBuild: false,
                });
                expect(no.rows.defaultBuildOptions).toEqual(["Yes", "No"]);

                const tasks = readTasksJson().tasks;
                const taskFor = (project: string) =>
                    tasks.find((task) => task.label === `sqlproj: Build ${project}`);
                expect(taskFor(defaultProject)?.group?.isDefault).toBe(true);
                expect(taskFor(otherProject)?.group?.isDefault).toBe(false);
            },
        );

        test(
            "the build keyboard shortcut runs the default build task in a terminal",
            testCases(5878860),
            async () => {
                const { page } = getContext();
                const dacpac = getDacpacPath(
                    await ensureProject(defaultProject, {
                        sdkStyle: false,
                        configureDefaultBuild: true,
                    }),
                );
                await killAllTerminals(page);
                fs.rmSync(dacpac, { force: true });

                await getProjectTreeItem(page, defaultProject).click();
                await page.keyboard.press(`${getModifierKey()}+Shift+B`);

                await expect(
                    getTaskTerminal(page, `sqlproj: Build ${defaultProject}`),
                ).toBeAttached({
                    timeout: 60 * 1000,
                });
                await waitForFile(dacpac, 3 * 60 * 1000);
            },
        );

        test(
            "Build and Build With Code Analysis run in a terminal",
            testCases(5878860),
            async () => {
                const { page } = getContext();
                const projectFile = await ensureProject(otherProject, { sdkStyle: false });
                const projectDir = path.dirname(projectFile);
                const projectNode = getProjectTreeItem(page, otherProject);

                // SELECT * in a procedure violates code analysis rule SR0001, which only a build with
                // code analysis reports.
                await addItemFromTree(page, projectNode, "Add Table", "Widgets");
                await addItemFromTree(page, projectNode, "Add Stored Procedure", "GetWidgets");
                const procedure = await waitForProjectFile(projectDir, "GetWidgets.sql");
                fs.writeFileSync(
                    procedure,
                    "CREATE PROCEDURE [dbo].[GetWidgets]\nAS\n  SELECT * FROM [dbo].[Widgets]\n",
                );
                await closeAllEditors(page);

                await killAllTerminals(page);
                await buildProjectFromTree(page, projectFile, "Build");
                await expect(getTaskTerminal(page, "Build")).toBeAttached();
                await showProblems(page);
                await expect(getSelectStarProblem(page)).toHaveCount(0);

                await killAllTerminals(page);
                await buildProjectFromTree(page, projectFile, "Build With Code Analysis");
                await expect(getTaskTerminal(page, "Build with Code Analysis")).toBeAttached();
                await showProblems(page);
                await expect(getSelectStarProblem(page).first()).toBeVisible({
                    timeout: 60 * 1000,
                });
            },
        );

        test(
            "Run Task lists Build and Build with Code Analysis for every project",
            testCases(5878860),
            async () => {
                const { page } = getContext();
                const quickInput = new QuickInput(page);
                await ensureProject(otherProject, { sdkStyle: false });
                await killAllTerminals(page);
                await quickInput.runCommand("Tasks: Run Task", "Tasks: Run Task");
                await quickInput.pick("sqlproj-build", 60 * 1000);

                const projects = fs
                    .readdirSync(workspaceDir)
                    .filter((entry) =>
                        fs.existsSync(path.join(workspaceDir, entry, `${entry}.sqlproj`)),
                    );
                expect(projects).toContain(otherProject);
                const taskOption = (label: string) =>
                    quickInput.widget.getByRole("option", {
                        name: new RegExp(`^sqlproj-build: ${label}`),
                    });
                // Filter per project; the list is virtualized, so unfiltered rows may not render.
                for (const project of projects) {
                    await getQuickInputBox(page).fill(`${project}.sqlproj`);
                    await expect(taskOption(`${project}\\.sqlproj - Build\\b`)).toHaveCount(2);
                    await expect(
                        taskOption(`${project}\\.sqlproj - Build with Code Analysis`),
                    ).toHaveCount(1);
                }

                const dacpac = getDacpacPath(
                    path.join(workspaceDir, otherProject, `${otherProject}.sqlproj`),
                );
                fs.rmSync(dacpac, { force: true });
                await getQuickInputBox(page).fill(`${otherProject}.sqlproj - Build`);
                await taskOption(`${otherProject}\\.sqlproj - Build(?! with)`).click();
                await expect(getTaskTerminal(page, `${otherProject}.sqlproj - Build`)).toBeAttached(
                    {
                        timeout: 60 * 1000,
                    },
                );
                await waitForFile(dacpac, 3 * 60 * 1000);
            },
        );
    });

    test.describe("SQLCMD variables", () => {
        for (const style of PROJECT_STYLES) {
            test(
                `${style.name}: add, edit, publish and delete a SQLCMD variable`,
                testCases(5878857),
                async () => {
                    const { page } = getContext();
                    const projectName = `SqlCmd${style.name}`;
                    const variable = `${style.name}Var`;
                    const { projectFile } = await newProject(projectName, {
                        sdkStyle: style.sdkStyle,
                    });
                    expect(SDK_PATTERN.test(readText(projectFile))).toBe(style.sdkStyle);

                    const variablesNode = getProjectTreeItem(
                        page,
                        `${projectName}/SQLCMD Variables`,
                    );
                    await runProjectContextAction(page, variablesNode, "Add SQLCMD Variable");
                    await waitForQuickInputTitle(page, "Enter new SQLCMD Variable name");
                    await submitInputBox(page, variable);
                    await waitForQuickInputTitle(page, `Enter default value for SQLCMD variable`);
                    await submitInputBox(page, "InitialValue");

                    const variableNode = await revealProjectTreeItem(
                        page,
                        projectName,
                        `SQLCMD Variables/${variable}`,
                    );
                    await expectFileToContain(
                        projectFile,
                        sqlCmdVariablePattern(variable, "InitialValue"),
                    );

                    await runProjectContextAction(page, variableNode, "Edit");
                    await waitForQuickInputTitle(page, `Enter new default value for variable`);
                    await expect(getQuickInputBox(page)).toHaveValue("InitialValue");
                    await submitInputBox(page, "UpdatedValue");
                    await expectFileToContain(
                        projectFile,
                        sqlCmdVariablePattern(variable, "UpdatedValue"),
                    );

                    const publishDialog = await openPublishDialog(page, projectName);
                    await expect(getPublishSqlCmdValue(publishDialog, variable)).toHaveValue(
                        "UpdatedValue",
                    );
                    await closeAllEditors(page);

                    await runProjectContextAction(page, variableNode, "Delete");
                    await answerModalDialog(
                        page,
                        "Yes",
                        `Are you sure you want to delete the SQLCMD Variable '${variable}'?`,
                    );
                    await expectFileNotToContain(projectFile, `Include="${variable}"`);
                    await expect(variableNode).toHaveCount(0);
                },
            );
        }
    });

    test.describe("Build and publish", () => {
        for (const style of PROJECT_STYLES) {
            const projectName = `Items${style.name}`;
            const projectDir = path.join(workspaceDir, projectName);
            const projectFile = path.join(projectDir, `${projectName}.sqlproj`);

            test(
                `${style.name}: add tables, views, procedures, scripts, folders and deployment scripts, then build`,
                testCases(5878849),
                async () => {
                    const { page } = getContext();
                    await newProject(projectName, { sdkStyle: style.sdkStyle });
                    const projectNode = getProjectTreeItem(page, projectName);

                    await addItemFromTree(page, projectNode, "Add Table", "Customers");
                    await addItemFromTree(page, projectNode, "Add View", "CustomerNames");
                    await addItemFromTree(
                        page,
                        projectNode,
                        "Add Stored Procedure",
                        "GetCustomers",
                    );
                    await addItemFromTree(page, projectNode, "Add Script", "Notes");
                    await addItemFromTree(
                        page,
                        projectNode,
                        "Add Pre-Deployment Script",
                        "PreDeploy",
                    );
                    await addItemFromTree(
                        page,
                        projectNode,
                        "Add Post-Deployment Script",
                        "PostDeploy",
                    );

                    // Nested folders with build items of their own.
                    await addItemFromTree(page, projectNode, "Add Folder", "Sales");
                    const salesNode = getProjectTreeItem(page, `${projectName}/Sales`);
                    await addItemFromTree(page, salesNode, "Add Folder", "Archive");
                    await addItemFromTree(page, salesNode, "Add Folder", "Reports");
                    await addItemFromTree(
                        page,
                        await revealProjectTreeItem(page, projectName, "Sales/Archive"),
                        "Add Table",
                        "Orders",
                    );
                    await addItemFromTree(
                        page,
                        await revealProjectTreeItem(page, projectName, "Sales/Reports"),
                        "Add Table",
                        "Summary",
                    );

                    const expectedFiles = [
                        "dbo/Tables/Customers.sql",
                        "dbo/Views/CustomerNames.sql",
                        "dbo/StoredProcedures/GetCustomers.sql",
                        "Notes.sql",
                        "PreDeploy.sql",
                        "PostDeploy.sql",
                        "Sales/Archive/Orders.sql",
                        "Sales/Reports/Summary.sql",
                    ];
                    for (const file of expectedFiles) {
                        await waitForFile(path.join(projectDir, file));
                    }

                    // The view template selects from a placeholder table, so point it at a real one.
                    fs.writeFileSync(
                        path.join(projectDir, "dbo", "Views", "CustomerNames.sql"),
                        "CREATE VIEW [dbo].[CustomerNames]\n  AS SELECT [Id] FROM [dbo].[Customers]\n",
                    );
                    fs.writeFileSync(
                        path.join(projectDir, "PreDeploy.sql"),
                        "PRINT N'E2E pre-deployment script';\n",
                    );
                    fs.writeFileSync(
                        path.join(projectDir, "PostDeploy.sql"),
                        "INSERT INTO [dbo].[Customers] ([Id]) VALUES (42);\n",
                    );
                    await closeAllEditors(page);

                    const sqlproj = readText(projectFile);
                    expect(sqlproj).toMatch(/<PreDeploy Include="PreDeploy\.sql"/);
                    expect(sqlproj).toMatch(/<PostDeploy Include="PostDeploy\.sql"/);
                    if (!style.sdkStyle) {
                        for (const file of expectedFiles.filter((f) => !f.endsWith("Deploy.sql"))) {
                            expect(sqlproj).toMatch(sqlprojPath(file));
                        }
                        expect(sqlproj).toMatch(sqlprojPath("Sales/Archive"));
                    }
                    await revealProjectTreeItem(page, projectName, "dbo/Tables/Customers.sql");
                    await revealProjectTreeItem(page, projectName, "Sales/Archive/Orders.sql");

                    await buildProjectFromTree(page, projectFile);
                },
            );

            test(
                `${style.name}: add existing SQL and non-SQL files, then build`,
                testCases(5878849),
                async () => {
                    const { page } = getContext();
                    const extraDir = path.join(projectDir, "Extra");
                    fs.mkdirSync(extraDir, { recursive: true });
                    const existingSql = path.join(extraDir, "ExistingThing.sql");
                    const existingText = path.join(extraDir, "notes.txt");
                    fs.writeFileSync(
                        existingSql,
                        "CREATE TABLE [dbo].[ExistingThing]\n(\n  [Id] INT NOT NULL PRIMARY KEY\n)\n",
                    );
                    fs.writeFileSync(existingText, "Not part of the build.\n");

                    const projectNode = getProjectTreeItem(page, projectName);
                    for (const file of [existingSql, existingText]) {
                        await runProjectContextAction(page, projectNode, "Add Existing Item...");
                        await acceptSimpleDialogPath(page, file);
                    }

                    await expectFileToContain(projectFile, /<None Include="Extra\\notes\.txt"/);
                    if (!style.sdkStyle) {
                        await expectFileToContain(
                            projectFile,
                            sqlprojPath("Extra/ExistingThing.sql"),
                        );
                    }
                    await revealProjectTreeItem(page, projectName, "Extra/ExistingThing.sql");
                    await revealProjectTreeItem(page, projectName, "Extra/notes.txt");

                    await buildProjectFromTree(page, projectFile);
                },
            );

            test(
                `${style.name}: exclude and delete files and nested folders, then build`,
                testCases(5878849),
                async () => {
                    const { page } = getContext();
                    // Exclude a file: it leaves the project but stays on disk.
                    const viewFile = path.join(projectDir, "dbo", "Views", "CustomerNames.sql");
                    await runProjectContextAction(
                        page,
                        await revealProjectTreeItem(
                            page,
                            projectName,
                            "dbo/Views/CustomerNames.sql",
                        ),
                        "Exclude from project",
                    );
                    await expect(
                        getProjectTreeItem(page, `${projectName}/dbo/Views/CustomerNames.sql`),
                    ).toHaveCount(0);
                    expect(fs.existsSync(viewFile)).toBe(true);

                    // Exclude a nested folder.
                    await runProjectContextAction(
                        page,
                        await revealProjectTreeItem(page, projectName, "Sales/Reports"),
                        "Exclude from project",
                    );
                    await expect(
                        getProjectTreeItem(page, `${projectName}/Sales/Reports`),
                    ).toHaveCount(0);
                    expect(
                        fs.existsSync(path.join(projectDir, "Sales", "Reports", "Summary.sql")),
                    ).toBe(true);

                    // Delete a file: it is removed from disk.
                    await runProjectContextAction(
                        page,
                        await revealProjectTreeItem(
                            page,
                            projectName,
                            "dbo/StoredProcedures/GetCustomers.sql",
                        ),
                        "Delete",
                    );
                    await answerModalDialog(
                        page,
                        "Yes",
                        "Are you sure you want to delete GetCustomers.sql?",
                    );
                    await waitForFileToBeRemoved(
                        path.join(projectDir, "dbo", "StoredProcedures", "GetCustomers.sql"),
                    );

                    // Delete a nested build item, then the folder that contains it.
                    await runProjectContextAction(
                        page,
                        await revealProjectTreeItem(page, projectName, "Sales/Archive/Orders.sql"),
                        "Delete",
                    );
                    await answerModalDialog(
                        page,
                        "Yes",
                        "Are you sure you want to delete Orders.sql?",
                    );
                    await waitForFileToBeRemoved(
                        path.join(projectDir, "Sales", "Archive", "Orders.sql"),
                    );

                    await runProjectContextAction(
                        page,
                        await revealProjectTreeItem(page, projectName, "Sales"),
                        "Delete",
                    );
                    await answerModalDialog(page, "Yes", "and all of its contents?");
                    await waitForFileToBeRemoved(path.join(projectDir, "Sales"));

                    const sqlproj = readText(projectFile);
                    expect(sqlproj).not.toMatch(
                        sqlprojPath("dbo/StoredProcedures/GetCustomers.sql"),
                    );
                    expect(sqlproj).not.toMatch(sqlprojPath("Sales/Archive/Orders.sql"));
                    if (!style.sdkStyle) {
                        expect(sqlproj).not.toMatch(sqlprojPath("dbo/Views/CustomerNames.sql"));
                    }

                    await buildProjectFromTree(page, projectFile);
                },
            );

            test(
                `${style.name}: generate a deployment script and publish to a new database`,
                testCases(5878849),
                async () => {
                    const { page } = getContext();
                    const databaseName = uniqueDatabaseName(`SqlProj${style.name}`);
                    databasesToDrop.push(databaseName);
                    await closeAllEditors(page);

                    let dialog = await openPublishDialog(page, projectName);
                    await choosePublishTarget(dialog, databaseName);
                    const script = await generatePublishScript(
                        page,
                        dialog,
                        path.join(workspaceDir, `${projectName}-deploy.sql`),
                    );
                    expect(script).toContain(`:setvar DatabaseName "${databaseName}"`);
                    expect(script).toMatch(/CREATE TABLE \[dbo\]\.\[Customers\]/);
                    expect(script).toMatch(/CREATE TABLE \[dbo\]\.\[ExistingThing\]/);
                    expect(script).toContain("E2E pre-deployment script");
                    expect(script).toMatch(
                        /INSERT INTO \[dbo\]\.\[Customers\] \(\[Id\]\) VALUES \(42\)/,
                    );
                    // Excluded and deleted items are not deployed.
                    expect(script).not.toMatch(
                        /\[CustomerNames\]|\[GetCustomers\]|\[Orders\]|\[Summary\]/,
                    );
                    await closeAllEditors(page);

                    dialog = await openPublishDialog(page, projectName);
                    await choosePublishTarget(dialog, databaseName);
                    await dialog.getByRole("button", { name: "Publish", exact: true }).click();

                    await expect
                        .poll(
                            async () =>
                                querySingleValue<number>(
                                    `SELECT COUNT(*) FROM sys.databases WHERE name = N'${databaseName}'`,
                                ),
                            { timeout: 3 * 60 * 1000 },
                        )
                        .toBe(1);
                    // The post-deployment script runs last, so its row proves the whole deployment ran.
                    await expect
                        .poll(
                            async () =>
                                querySingleValue<number>(
                                    "SELECT COUNT(*) FROM dbo.Customers WHERE Id = 42",
                                    databaseName,
                                ).catch(() => 0),
                            { timeout: 3 * 60 * 1000 },
                        )
                        .toBe(1);
                    expect(
                        await querySingleValue<number>(
                            "SELECT COUNT(*) FROM sys.tables WHERE name = N'ExistingThing'",
                            databaseName,
                        ),
                    ).toBe(1);
                    expect(
                        await querySingleValue<number>(
                            "SELECT COUNT(*) FROM sys.views WHERE name = N'CustomerNames'",
                            databaseName,
                        ),
                    ).toBe(0);
                },
            );

            test(
                `${style.name}: open an existing project and build it`,
                testCases(5878849),
                async () => {
                    const { page } = getContext();
                    const existingName = `Existing${style.name}`;
                    const existingDir = path.join(workspaceDir, existingName);
                    fs.cpSync(path.join(SQL_PROJECT_FIXTURES, existingName), existingDir, {
                        recursive: true,
                    });
                    const existingFile = path.join(existingDir, `${existingName}.sqlproj`);

                    await openProjectsView(page);
                    await getProjectsViewToolbar(page)
                        .getByRole("button", { name: "Open existing", exact: true })
                        .click();
                    await acceptSimpleDialogPath(page, existingFile);

                    await revealProjectTreeItem(page, existingName, "dbo/Tables/Inventory.sql");
                    await buildProjectFromTree(page, existingFile);
                },
            );
        }
    });
});

async function showProblems(page: Page): Promise<void> {
    await new QuickInput(page).runCommand(
        "Problems: Focus on Problems View",
        "Problems: Focus on Problems View",
    );
}

/**
 * Problems view entries for code analysis rule SR0001 ("Avoid SELECT *"). Entries are named after
 * their message; the rule ID is only rendered as decoration text.
 */
function getSelectStarProblem(page: Page) {
    return page.getByRole("treeitem", {
        name: /Microsoft\.Rules\.Data : The shape of the result set produced by a SELECT \* statement/,
    });
}
