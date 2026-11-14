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
import {
    acceptSimpleDialogPath,
    answerNewProjectPrompts,
    getProjectsViewToolbar,
    getProjectTreeItem,
    getSqlProjectSettings,
    openProjectsView,
    readText,
    removeDir,
    reserveTempDir,
    runProjectContextAction,
    waitForFile,
    waitForQuickInputTitle,
    writeLegacyProject,
} from "./utils/sqlProjectHelpers";
import { testCases } from "./utils/testCases";
import { useSharedVsCodeLifecycle } from "./utils/testLifecycle";

/** Creates a project from the Database Projects view's "New" action. */
async function createProjectFromView(page: Page, name: string, location: string): Promise<void> {
    await openProjectsView(page);
    await getProjectsViewToolbar(page).getByRole("button", { name: "New", exact: true }).click();
    await answerNewProjectPrompts(page, {
        name,
        location,
        targetPlatform: "SQL Server 2025",
        sdkStyle: false,
        configureDefaultBuild: false,
    });
    await waitForFile(path.join(location, name, `${name}.sqlproj`));
}

/** Opens an existing project from the Database Projects view's "Open existing" action. */
async function openExistingFromView(page: Page, projectFile: string): Promise<void> {
    await openProjectsView(page);
    await getProjectsViewToolbar(page)
        .getByRole("button", { name: "Open existing", exact: true })
        .click();
    await acceptSimpleDialogPath(page, projectFile);
}

async function expectProjectInView(page: Page, name: string): Promise<void> {
    // Adding the first folder to a window restarts the extension host, so allow for the view
    // to repopulate.
    await expect(async () => {
        await openProjectsView(page);
        await expect(getProjectTreeItem(page, name)).toBeVisible({ timeout: 5 * 1000 });
    }).toPass({ timeout: 2 * 60 * 1000 });
}

/**
 * SQL Database Projects - workspaces. Creating and opening projects with no workspace, a saved
 * .code-workspace and an untitled workspace open; the Database Projects view toolbar and its
 * overflow menu; and removing and re-adding projects, which the workspace file records.
 */
test.describe("SQL Database Projects - workspaces", () => {
    test.describe("with no workspace open", () => {
        const saveLocation = reserveTempDir("sqlproj-nows");
        const outsideDir = reserveTempDir("sqlproj-nows-outside");
        const existingProject = path.join(outsideDir, "NoWsExisting", "NoWsExisting.sqlproj");

        // Declared before the lifecycle hooks so the folders exist when VS Code starts.
        test.beforeAll(() => {
            fs.mkdirSync(saveLocation, { recursive: true });
            writeLegacyProject(outsideDir, "NoWsExisting");
        });

        const getContext = useSharedVsCodeLifecycle({
            launchOptions: {
                initialConfig: getSeededLaunchConfig(getSqlProjectSettings(saveLocation)),
            },
        });

        test.afterAll(() => {
            removeDir(saveLocation);
            removeDir(outsideDir);
        });

        test(
            "create a project, which adds its folder to the window",
            testCases(5878847),
            async () => {
                const { page } = getContext();
                await openProjectsView(page);
                await expect(
                    page.getByRole("button", { name: "Create new", exact: true }),
                ).toBeVisible();

                await createProjectFromView(page, "NoWsProj", saveLocation);
                await expectProjectInView(page, "NoWsProj");
                // Adding the project's folder to an empty window turns it into an untitled workspace.
                await expect(page).toHaveTitle(/Untitled \(Workspace\)/, { timeout: 60 * 1000 });
            },
        );

        test("open an existing project from another folder", testCases(5878847), async () => {
            const { page } = getContext();
            await expect(getProjectTreeItem(page, "NoWsExisting")).toHaveCount(0);
            await openExistingFromView(page, existingProject);
            await expectProjectInView(page, "NoWsExisting");
            await expectProjectInView(page, "NoWsProj");
        });
    });

    test.describe("with a workspace file open", () => {
        const root = reserveTempDir("sqlproj-ws");
        const mainFolder = path.join(root, "main");
        const workspaceFile = path.join(root, "projects.code-workspace");
        const outsideProject = path.join(root, "outside", "WsOutside", "WsOutside.sqlproj");

        // Declared before the lifecycle hooks so the workspace exists when VS Code opens it.
        test.beforeAll(() => {
            fs.mkdirSync(mainFolder, { recursive: true });
            fs.writeFileSync(
                workspaceFile,
                JSON.stringify({ folders: [{ path: "main" }], settings: {} }, undefined, 4),
            );
            writeLegacyProject(path.join(root, "outside"), "WsOutside");
        });
        const projectFile = path.join(mainFolder, "WsProj", "WsProj.sqlproj");

        const getContext = useSharedVsCodeLifecycle({
            launchOptions: {
                initialConfig: getSeededLaunchConfig(getSqlProjectSettings(mainFolder)),
                extraLaunchArgs: [workspaceFile],
            },
        });

        test.afterAll(() => removeDir(root));

        /** Workspace folders and excluded projects recorded in the .code-workspace file. */
        function readWorkspace(): {
            folders: { path: string }[];
            excluded: string[];
        } {
            const json = JSON.parse(readText(workspaceFile) || "{}");
            return {
                folders: (json.folders ?? []).map((folder: { path: string }) => ({
                    path: path.normalize(folder.path),
                })),
                excluded: json.settings?.["dataworkspace.excludedProjects"] ?? [],
            };
        }

        test("create a project inside the workspace", testCases(5878847), async () => {
            const { page } = getContext();
            await createProjectFromView(page, "WsProj", mainFolder);
            await expectProjectInView(page, "WsProj");
            // The project is under an existing workspace folder, so no folder is added.
            expect(readWorkspace().folders.map((folder) => folder.path)).toEqual(["main"]);
        });

        test(
            "open an existing project, which adds its folder to the workspace file",
            testCases(5878847),
            async () => {
                const { page } = getContext();
                await expect(getProjectTreeItem(page, "WsOutside")).toHaveCount(0);
                await openExistingFromView(page, outsideProject);
                await expectProjectInView(page, "WsOutside");
                await expect
                    .poll(() => readWorkspace().folders.map((folder) => folder.path), {
                        timeout: 30 * 1000,
                    })
                    .toEqual(["main", path.join("outside", "WsOutside")]);
            },
        );

        test(
            "remove a project and add it back, updating the workspace file",
            testCases(5878847),
            async () => {
                const { page } = getContext();
                const relativeProject = path.join("main", "WsProj", "WsProj.sqlproj");
                await runProjectContextAction(
                    page,
                    getProjectTreeItem(page, "WsProj"),
                    "Remove Project",
                );
                await expect(getProjectTreeItem(page, "WsProj")).toHaveCount(0);
                await expect
                    .poll(() => readWorkspace().excluded.map((p) => path.normalize(p)))
                    .toEqual([relativeProject]);

                await openExistingFromView(page, projectFile);
                await expectProjectInView(page, "WsProj");
                await expect.poll(() => readWorkspace().excluded).toEqual([]);
            },
        );

        test(
            "view toolbar and overflow menu commands launch the right flows",
            testCases(5878847),
            async () => {
                const { page } = getContext();
                const quickInput = new QuickInput(page);
                const toolbar = getProjectsViewToolbar(page);
                await openProjectsView(page);

                await toolbar.getByRole("button", { name: "New", exact: true }).click();
                await waitForQuickInputTitle(page, "Select Database Project Type");
                expect(await quickInput.labels()).toEqual(
                    expect.arrayContaining(["SQL Server Database", "Azure SQL Database"]),
                );
                await quickInput.close();

                await toolbar.getByRole("button", { name: "Open existing", exact: true }).click();
                // The simple open dialog starts in the default project save location.
                await expect(quickInput.widget).toBeVisible();
                await expect(quickInput.input.filter({ visible: true })).toHaveValue(
                    new RegExp(`${path.basename(mainFolder)}[\\\\/]?$`),
                );
                await quickInput.close();

                await toolbar.getByRole("button", { name: "Find File...", exact: true }).click();
                await expect(quickInput.widget).toBeVisible();
                await quickInput.close();

                await toolbar.getByRole("button", { name: "Refresh", exact: true }).click();
                await expectProjectInView(page, "WsProj");
                await expectProjectInView(page, "WsOutside");

                const openOverflow = async () => {
                    await toolbar
                        .getByRole("button", { name: "Views and More Actions..." })
                        .click();
                    await expect(page.getByRole("menu")).toBeVisible();
                };
                await openOverflow();
                const menu = page.getByRole("menu");
                for (const item of [
                    "Create Project from Database",
                    "Documentation",
                    "Close Workspace",
                ]) {
                    await expect(
                        menu.getByRole("menuitem", { name: item, exact: true }),
                    ).toBeVisible();
                }
                await expect(
                    menu.getByRole("menuitem", { name: "Update Project from Database" }),
                ).toHaveCount(0);
                await menu.getByRole("menuitem", { name: "Create Project from Database" }).click();
                // Without a database node for context, the flow starts by asking for a connection.
                await expect(
                    quickInput.widget.getByRole("option", { name: /e2e-server/ }).first(),
                ).toBeVisible({ timeout: 60 * 1000 });
                await quickInput.close();

                // "Documentation" is only checked for presence: it opens the system browser.
                await openOverflow();
                await menu.getByRole("menuitem", { name: "Close Workspace", exact: true }).click();
                await expect(page).not.toHaveTitle(/projects \(Workspace\)/, {
                    timeout: 60 * 1000,
                });
                await openProjectsView(page);
                await expect(
                    page.getByRole("button", { name: "Create new", exact: true }),
                ).toBeVisible({ timeout: 60 * 1000 });
            },
        );
    });

    test.describe("with an untitled workspace open", () => {
        const root = reserveTempDir("sqlproj-untitled");
        const folder = path.join(root, "folder");
        const outsideProject = path.join(
            root,
            "outside",
            "UntitledOutside",
            "UntitledOutside.sqlproj",
        );

        // Declared before the lifecycle hooks so the folders exist when VS Code starts.
        test.beforeAll(() => {
            fs.mkdirSync(folder, { recursive: true });
            writeLegacyProject(path.join(root, "outside"), "UntitledOutside");
        });

        const getContext = useSharedVsCodeLifecycle({
            launchOptions: {
                initialConfig: getSeededLaunchConfig(getSqlProjectSettings(folder)),
            },
        });

        test.afterAll(() => removeDir(root));

        test(
            "create and open projects after adding a folder to an empty window",
            testCases(5878847),
            async () => {
                const { page } = getContext();
                await new QuickInput(page).runCommand(
                    "Workspaces: Add Folder to Workspace",
                    "Workspaces: Add Folder to Workspace...",
                );
                await acceptSimpleDialogPath(page, folder);
                await expect(page).toHaveTitle(/Untitled \(Workspace\)/, { timeout: 60 * 1000 });

                await createProjectFromView(page, "UntitledProj", folder);
                await expectProjectInView(page, "UntitledProj");
                await expect(getProjectTreeItem(page, "UntitledOutside")).toHaveCount(0);
                await openExistingFromView(page, outsideProject);
                await expectProjectInView(page, "UntitledOutside");
                await expectProjectInView(page, "UntitledProj");
                await expect(page).toHaveTitle(/Untitled \(Workspace\)/);
            },
        );
    });
});
