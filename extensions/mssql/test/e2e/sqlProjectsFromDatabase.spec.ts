/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from "fs";
import * as path from "path";
import { Page } from "@playwright/test";
import { test, expect } from "./baseFixtures";
import { QuickInput } from "./pageObjects/quickInput";
import {
    expandObjectExplorerPath,
    getObjectExplorerNode,
    getObjectExplorerPane,
    getSeededLaunchConfig,
    SEEDED_PROFILE_NAME,
} from "./utils/seededConnection";
import {
    dropDatabaseIfExists,
    recreateDatabase,
    runSql,
    uniqueDatabaseName,
} from "./utils/sqlClient";
import {
    answerModalDialog,
    buildProjectFromTree,
    closeAllEditors,
    containsPath,
    expectFileToContain,
    getProjectsViewToolbar,
    getProjectTreeItem,
    getQuickInputBox,
    getSqlProjectSettings,
    killAllTerminals,
    openProjectsView,
    pickPathOption,
    readText,
    removeDir,
    reserveTempDir,
    runProjectContextAction,
    runTreeItemContextMenu,
    sqlprojPath,
    submitInputBox,
    waitForFile,
    waitForNotification,
    waitForProjectFile,
    waitForQuickInputTitle,
} from "./utils/sqlProjectHelpers";
import { getWebviewByTitle } from "./utils/testHelpers";
import { testCases } from "./utils/testCases";
import { useSharedVsCodeLifecycle } from "./utils/testLifecycle";

const SDK_PATTERN = /Microsoft\.Build\.Sql/;

/**
 * SQL Database Projects - create a project from a database and update a project from a database,
 * launched from Object Explorer, the command palette, the Database Projects view's overflow menu
 * and a project node.
 */
test.describe("SQL Database Projects - create and update from database", () => {
    const workspaceDir = reserveTempDir("sqlproj-fromdb");
    const databaseName = uniqueDatabaseName("SqlProjFromDb");

    // Declared before the lifecycle hooks so the folder exists when VS Code opens it.
    test.beforeAll(() => {
        fs.mkdirSync(workspaceDir, { recursive: true });
    });

    const getContext = useSharedVsCodeLifecycle({
        launchOptions: {
            initialConfig: getSeededLaunchConfig(getSqlProjectSettings(workspaceDir)),
            extraLaunchArgs: [workspaceDir],
        },
        afterEach: async ({ page }) => {
            await new QuickInput(page).close();
        },
        beforeClose: async ({ page }) => {
            await killAllTerminals(page);
            await closeAllEditors(page);
        },
    });

    test.beforeAll(async () => {
        await recreateDatabase(databaseName);
        await runSql(
            `CREATE TABLE dbo.Products (Id INT NOT NULL PRIMARY KEY, Name NVARCHAR(100) NOT NULL);
            GO
            CREATE VIEW dbo.ProductNames AS SELECT Name FROM dbo.Products;`,
            databaseName,
        );
    });

    test.afterAll(async () => {
        await dropDatabaseIfExists(databaseName);
        removeDir(workspaceDir);
    });

    function projectFileFor(name: string): string {
        return path.join(workspaceDir, name, `${name}.sqlproj`);
    }

    async function openDatabaseContextMenu(page: Page, menuLabel: string): Promise<void> {
        const sqlServerTab = page
            .getByRole("tablist", { name: "Active View Switcher" })
            .getByRole("tab", { name: /^SQL Server/ });
        if ((await sqlServerTab.getAttribute("aria-selected")) !== "true") {
            await sqlServerTab.click();
        }
        await expandObjectExplorerPath(page, [SEEDED_PROFILE_NAME, "Databases"]);
        await runTreeItemContextMenu(
            page,
            getObjectExplorerPane(page).getByRole("tree"),
            getObjectExplorerNode(page, databaseName),
            ["SQL Database Projects", menuLabel],
            new QuickInput(page).widget,
        );
    }

    /** Picks the seeded server in the connection quick pick the flows open without context. */
    async function pickSeededConnection(page: Page): Promise<void> {
        const option = new QuickInput(page).widget
            .getByRole("option", { name: new RegExp(`^${SEEDED_PROFILE_NAME}\\b`) })
            .first();
        await expect(option).toBeVisible({ timeout: 60 * 1000 });
        await option.click();
    }

    /**
     * Answers the create-from-database prompts after the connection is known: database, project
     * name, location, folder structure, permissions, SDK style and default build.
     */
    async function answerCreateFromDatabasePrompts(
        page: Page,
        options: { name?: string; sdkStyle: boolean },
    ): Promise<{ databases: string[]; suggestedName: string; name: string }> {
        const quickInput = new QuickInput(page);
        await waitForQuickInputTitle(page, "Select database", 60 * 1000);
        await expect(quickInput.rows.first()).toBeVisible();
        const databases = await quickInput.labels();
        await quickInput.pick(databaseName);

        await waitForQuickInputTitle(page, "Enter project name");
        const suggestedName = await getQuickInputBox(page).inputValue();
        const name = options.name ?? suggestedName;
        await submitInputBox(page, name);

        await waitForQuickInputTitle(page, "Select location to create project");
        await pickPathOption(page, workspaceDir);
        await waitForQuickInputTitle(page, "Select folder structure");
        await quickInput.pick("Schema/Object Type");
        await waitForQuickInputTitle(page, "Include permissions in project");
        await quickInput.pick("No (default)");
        await waitForQuickInputTitle(page, "SDK-style project");
        await quickInput.pick(options.sdkStyle ? "Yes (Recommended)" : "No");
        await waitForQuickInputTitle(page, "default build configuration");
        await quickInput.pick("No");
        return { databases, suggestedName, name };
    }

    /** Waits for an extracted project and checks it contains the seeded objects. */
    async function expectExtractedProject(page: Page, name: string, sdkStyle: boolean) {
        const projectFile = projectFileFor(name);
        await waitForFile(projectFile, 2 * 60 * 1000);
        const projectDir = path.dirname(projectFile);
        await waitForFile(path.join(projectDir, "dbo", "Tables", "Products.sql"), 2 * 60 * 1000);
        await waitForFile(path.join(projectDir, "dbo", "Views", "ProductNames.sql"));
        expect(SDK_PATTERN.test(readText(projectFile))).toBe(sdkStyle);
        if (!sdkStyle) {
            await expectFileToContain(projectFile, sqlprojPath("dbo/Tables/Products.sql"));
        }
        await openProjectsView(page);
        await expect(getProjectTreeItem(page, name)).toBeVisible({ timeout: 60 * 1000 });
        return projectFile;
    }

    test.describe("Create project from database", () => {
        test(
            "from a database node, with the connection, database and name prefilled",
            testCases(5878852, 5878849),
            async () => {
                const { page } = getContext();
                await openDatabaseContextMenu(page, "Create Project from Database");
                const answers = await answerCreateFromDatabasePrompts(page, { sdkStyle: false });

                // Launched from the database node: no connection prompt, and that database is first.
                expect(answers.databases[0]).toBe(databaseName);
                expect(answers.suggestedName).toBe(`DatabaseProject${databaseName}`);

                const projectFile = await expectExtractedProject(page, answers.name, false);
                await buildProjectFromTree(page, projectFile);
            },
        );

        test("from the command palette, as an SDK-style project", testCases(5878852), async () => {
            const { page } = getContext();
            await new QuickInput(page).runCommand(
                "Database Projects: Create Project from Database",
                "Database Projects: Create Project from Database",
            );
            await pickSeededConnection(page);
            await answerCreateFromDatabasePrompts(page, { name: "FromDbSdk", sdkStyle: true });
            const projectFile = await expectExtractedProject(page, "FromDbSdk", true);
            await buildProjectFromTree(page, projectFile);
        });

        test("from the Database Projects view's overflow menu", testCases(5878852), async () => {
            const { page } = getContext();
            await openProjectsView(page);
            await getProjectsViewToolbar(page)
                .getByRole("button", { name: "Views and More Actions..." })
                .click();
            await page
                .getByRole("menu")
                .getByRole("menuitem", { name: "Create Project from Database", exact: true })
                .click();
            await pickSeededConnection(page);
            await answerCreateFromDatabasePrompts(page, {
                name: "FromDbOverflow",
                sdkStyle: false,
            });
            await expectExtractedProject(page, "FromDbOverflow", false);
        });
    });

    test.describe("Update project from database", () => {
        const ordersFile = (project: string) =>
            path.join(workspaceDir, project, "dbo", "Tables", "Orders.sql");

        test.beforeAll(async () => {
            await runSql(
                "CREATE TABLE dbo.Orders (Id INT NOT NULL PRIMARY KEY, ProductId INT NOT NULL);",
                databaseName,
            );
        });

        async function applyAllChanges(page: Page, project: string): Promise<void> {
            const quickInput = new QuickInput(page);
            await waitForQuickInputTitle(page, "Action");
            expect(await quickInput.labels()).toEqual([
                "View changes in Schema Compare",
                "Apply all changes",
            ]);
            await quickInput.pick("Apply all changes");
            await answerModalDialog(
                page,
                "Yes",
                "Are you sure you want to update the target project?",
            );
            await waitForNotification(page, "Project was successfully updated.", 2 * 60 * 1000);
            await waitForFile(ordersFile(project));
        }

        test(
            "from a database node, choosing the project and applying all changes",
            testCases(5878852),
            async () => {
                const { page } = getContext();
                const project = `DatabaseProject${databaseName}`;
                const quickInput = new QuickInput(page);
                await openDatabaseContextMenu(page, "Update Project from Database");

                // The database comes from the node, so the first prompt is the project file.
                await waitForQuickInputTitle(page, "Select project file", 60 * 1000);
                await expect(quickInput.rows.first()).toBeVisible();
                const labels = await quickInput.labels();
                expect(labels).toContain("Browse...");
                expect(containsPath(labels, projectFileFor(project))).toBe(true);
                await pickPathOption(page, projectFileFor(project));
                await applyAllChanges(page, project);
                await expectFileToContain(
                    projectFileFor(project),
                    sqlprojPath("dbo/Tables/Orders.sql"),
                );
            },
        );

        test(
            "from a project node, viewing the changes in Schema Compare",
            testCases(5878852),
            async () => {
                const { page } = getContext();
                const quickInput = new QuickInput(page);
                await runProjectContextAction(
                    page,
                    getProjectTreeItem(page, "FromDbSdk"),
                    "Update Project from Database",
                    quickInput.widget,
                );
                await pickSeededConnection(page);
                await waitForQuickInputTitle(page, "Select database", 60 * 1000);
                await quickInput.pick(databaseName);
                // The project comes from the node, so the next prompt is the action.
                await waitForQuickInputTitle(page, "Action");
                await quickInput.pick("View changes in Schema Compare");

                const schemaCompare = await getWebviewByTitle(page, "Schema Compare", 60 * 1000);
                // Source and target are filled in from the database and the project.
                await expect(schemaCompare.getByLabel("Source", { exact: true })).toHaveValue(
                    new RegExp(`${databaseName}$`),
                    { timeout: 60 * 1000 },
                );
                await expect(schemaCompare.getByLabel("Target", { exact: true })).toHaveValue(
                    /FromDbSdk\.sqlproj$/,
                );
                // The comparison runs automatically and finds the table the project lacks.
                await expect(
                    schemaCompare.getByText("dbo.Orders", { exact: true }).first(),
                ).toBeVisible({
                    timeout: 2 * 60 * 1000,
                });
                expect(fs.existsSync(ordersFile("FromDbSdk"))).toBe(false);
            },
        );

        test(
            "from the command palette, browsing projects and applying all changes",
            testCases(5878852),
            async () => {
                const { page } = getContext();
                const quickInput = new QuickInput(page);
                await quickInput.runCommand(
                    "Database Projects: Update Project from Database",
                    "Database Projects: Update Project from Database",
                );
                await pickSeededConnection(page);
                await waitForQuickInputTitle(page, "Select database", 60 * 1000);
                await quickInput.pick(databaseName);
                await waitForQuickInputTitle(page, "Select project file");
                await expect(quickInput.rows.first()).toBeVisible();
                const labels = await quickInput.labels();
                expect(labels).toContain("Browse...");
                expect(containsPath(labels, projectFileFor("FromDbOverflow"))).toBe(true);
                await pickPathOption(page, projectFileFor("FromDbOverflow"));
                await applyAllChanges(page, "FromDbOverflow");
                await waitForProjectFile(path.join(workspaceDir, "FromDbOverflow"), "Orders.sql");
            },
        );

        test(
            "is not offered in the Database Projects view's overflow menu",
            testCases(5878852),
            async () => {
                const { page } = getContext();
                await openProjectsView(page);
                await getProjectsViewToolbar(page)
                    .getByRole("button", { name: "Views and More Actions..." })
                    .click();
                const menu = page.getByRole("menu");
                await expect(
                    menu.getByRole("menuitem", {
                        name: "Create Project from Database",
                        exact: true,
                    }),
                ).toBeVisible();
                await expect(
                    menu.getByRole("menuitem", { name: "Update Project from Database" }),
                ).toHaveCount(0);
                await page.keyboard.press("Escape");
            },
        );
    });
});
