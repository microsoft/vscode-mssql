/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect, FrameLocator, Locator, Page } from "@playwright/test";
import { randomUUID } from "crypto";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { QuickInput } from "../pageObjects/quickInput";
import { getWebviewByTitle } from "./testHelpers";
import { SEEDED_PROFILE_NAME } from "./seededConnection";

/** Title of the Database Projects activity bar container and its single view. */
export const PROJECTS_VIEW_TITLE = "Database Projects";

/**
 * Returns a unique temp directory path without creating it, so specs can name their folders when
 * they are loaded (Playwright loads every spec file just to list tests) but create them only in a
 * hook. Symlinks are resolved (macOS /var -> /private/var) so paths match what VS Code reports.
 */
export function reserveTempDir(prefix: string): string {
    return path.join(
        fs.realpathSync(os.tmpdir()),
        `mssql-e2e-${prefix}-${randomUUID().slice(0, 8)}`,
    );
}

export function removeDir(dir: string | undefined): void {
    if (dir) {
        fs.rmSync(dir, { recursive: true, force: true });
    }
}

/**
 * Settings every Database Projects suite needs on top of getSeededLaunchConfig: workbench-drawn
 * modal dialogs (macOS would otherwise show native ones Playwright cannot reach), a default
 * project save location that the new-project quick picks offer as a row, no .NET install prompt,
 * and no Chat side bar taking up room.
 */
export function getSqlProjectSettings(saveLocation: string): Record<string, unknown> {
    return {
        "window.dialogStyle": "custom",
        "projects.defaultProjectSaveLocation": saveLocation,
        "sqlDatabaseProjects.netCoreDoNotAsk": true,
        "workbench.secondarySideBar.defaultVisibility": "hidden",
    };
}

/** Folder holding the checked-in .sqlproj fixtures. */
export const SQL_PROJECT_FIXTURES = path.join(
    __dirname,
    "..",
    "..",
    "resources",
    "e2e",
    "sqlProjects",
);

/**
 * Writes a legacy-style project named `name` under `parentDir`, based on the ExistingLegacy
 * fixture, with a fresh project GUID and a single table `[dbo].[<name>Table]`.
 */
export function writeLegacyProject(parentDir: string, name: string): string {
    const projectDir = path.join(parentDir, name);
    const tablesDir = path.join(projectDir, "dbo", "Tables");
    fs.mkdirSync(tablesDir, { recursive: true });
    const template = fs.readFileSync(
        path.join(SQL_PROJECT_FIXTURES, "ExistingLegacy", "ExistingLegacy.sqlproj"),
        "utf8",
    );
    const projectFile = path.join(projectDir, `${name}.sqlproj`);
    fs.writeFileSync(
        projectFile,
        template
            .replace(/ExistingLegacy/g, name)
            .replace(
                /<ProjectGuid>[^<]*<\/ProjectGuid>/,
                `<ProjectGuid>{${randomUUID().toUpperCase()}}</ProjectGuid>`,
            )
            .replace(/dbo\\Tables\\Inventory\.sql/, `dbo\\Tables\\${name}Table.sql`),
    );
    fs.writeFileSync(
        path.join(tablesDir, `${name}Table.sql`),
        `CREATE TABLE [dbo].[${name}Table]\n(\n  [Id] INT NOT NULL PRIMARY KEY\n)\n`,
    );
    return projectFile;
}

/** Opens the Database Projects activity bar container. */
export async function openProjectsView(page: Page): Promise<Locator> {
    const tab = page
        .getByRole("tablist", { name: "Active View Switcher" })
        .getByRole("tab", { name: new RegExp(`^${PROJECTS_VIEW_TITLE}`) });
    await expect(tab).toBeVisible({ timeout: 30 * 1000 });
    if ((await tab.getAttribute("aria-selected")) !== "true") {
        await tab.click();
    }
    await expect(tab).toHaveAttribute("aria-selected", "true");
    return getProjectsPane(page);
}

/** The Database Projects tree. */
export function getProjectsPane(page: Page): Locator {
    return page.getByRole("tree", { name: PROJECTS_VIEW_TITLE, exact: true });
}

/** The view title toolbar ("New", "Open existing", ..., "Views and More Actions..."). */
export function getProjectsViewToolbar(page: Page): Locator {
    return page.getByRole("toolbar", { name: `${PROJECTS_VIEW_TITLE} actions` });
}

/**
 * Finds a Database Projects tree item. Project nodes are named after the project, while the
 * workbench names folder, file and other nodes after their resource path, so `label` may be a
 * trailing path such as "dbo/Tables/Customers.sql" to disambiguate.
 */
export function getProjectTreeItem(page: Page, label: string): Locator {
    const pattern = label
        .split("/")
        .map((segment) => escape(segment))
        .join("[\\\\/]");
    return getProjectsPane(page).getByRole("treeitem", {
        // Decorations such as " • Contains emphasized items" may follow the name.
        name: new RegExp(`(^|[\\\\/])${pattern}(\\s+•.*)?\\s*$`),
    });
}

/** Nodes whose children (references, SQLCMD variables) are named by their label alone. */
const LABEL_ONLY_PARENTS = ["Database References", "SQLCMD Variables"];

/**
 * A database reference or SQLCMD variable node. These carry no resource path, so their name is
 * just the label; the tree level tells them apart from a project of the same name.
 */
export function getLabelOnlyTreeItem(page: Page, label: string): Locator {
    return getProjectsPane(page).getByRole("treeitem", { name: label, exact: true, level: 3 });
}

/** Expands a tree item in the Database Projects view if it is collapsed. */
export async function expandProjectTreeItem(item: Locator): Promise<void> {
    await expect(item).toBeVisible({ timeout: 60 * 1000 });
    if ((await item.getAttribute("aria-expanded")) !== "true") {
        await item.click();
        await item.press("ArrowRight");
    }
    await expect(item).toHaveAttribute("aria-expanded", "true");
}

/**
 * Expands a project and every folder above `relativePath` (e.g. "dbo/Tables/Customers.sql"),
 * then returns the now visible node. With no path, returns the project node itself.
 */
export async function revealProjectTreeItem(
    page: Page,
    projectName: string,
    relativePath = "",
): Promise<Locator> {
    await openProjectsView(page);
    const segments = relativePath.split("/").filter(Boolean);
    let current = projectName;
    for (const segment of segments) {
        await expandProjectTreeItem(getProjectTreeItem(page, current));
        current = `${current}/${segment}`;
    }
    const node =
        segments.length === 2 && LABEL_ONLY_PARENTS.includes(segments[0])
            ? getLabelOnlyTreeItem(page, segments[1])
            : getProjectTreeItem(page, current);
    await expect(node).toBeVisible({ timeout: 30 * 1000 });
    return node;
}

/**
 * Right-clicks a Database Projects tree item and runs a context menu entry. When `opens` is
 * given, the gesture is retried until that locator (e.g. the prompt the command shows) appears.
 */
export async function runProjectContextAction(
    page: Page,
    node: Locator,
    menuLabel: string,
    opens?: Locator,
): Promise<void> {
    await openProjectsView(page);
    await runTreeItemContextMenu(page, getProjectsPane(page), node, [menuLabel], opens);
}

/**
 * Right-clicks any workbench tree item and clicks through a context menu path such as
 * ["SQL Database Projects", "Create Project from Database"].
 *
 * Trees re-render, and recycle their rows, whenever their data changes, which can tear down a
 * freshly opened menu or move a row under the pointer. So the gesture checks that the menu
 * belongs to the intended row (right-clicking focuses it, which the tree exposes as its active
 * descendant) and is retried until the click lands.
 */
export async function runTreeItemContextMenu(
    page: Page,
    tree: Locator,
    node: Locator,
    menuPath: string[],
    opens?: Locator,
): Promise<void> {
    await expect(node).toBeVisible({ timeout: 60 * 1000 });
    await expect(async () => {
        await new QuickInput(page).close();
        if ((await page.getByRole("menu").count()) > 0) {
            await page.keyboard.press("Escape");
            await expect(page.getByRole("menu")).toHaveCount(0);
        }
        await node.click({ button: "right", timeout: 5 * 1000 });
        const rowId = await node.getAttribute("id", { timeout: 5 * 1000 });
        await expect(tree).toHaveAttribute("aria-activedescendant", rowId!, { timeout: 2 * 1000 });
        for (const [index, label] of menuPath.entries()) {
            // An opened submenu is nested in its parent, so the innermost menu is the last one.
            const item = page
                .getByRole("menu")
                .last()
                .getByRole("menuitem", { name: label, exact: true });
            await item.hover({ timeout: 5 * 1000 });
            if (index === menuPath.length - 1) {
                await item.click({ timeout: 5 * 1000 });
            } else {
                await expect(
                    page.getByRole("menuitem", { name: label, exact: true, expanded: true }),
                ).toBeVisible({ timeout: 5 * 1000 });
            }
        }
        await expect(page.getByRole("menu")).toHaveCount(0, { timeout: 5 * 1000 });
        if (opens) {
            await expect(opens).toBeVisible({ timeout: 10 * 1000 });
        }
    }).toPass({ timeout: 90 * 1000 });
}

/** Answers the active input box with `value`, replacing anything prefilled. */
export async function submitInputBox(page: Page, value: string): Promise<void> {
    const input = getQuickInputBox(page);
    await expect(input).toBeVisible({ timeout: 30 * 1000 });
    await input.fill(value);
    await expect(input).toHaveValue(value);
    await input.press("Enter");
}

/** The text box of the quick input that is currently open. */
export function getQuickInputBox(page: Page): Locator {
    return new QuickInput(page).input.filter({ visible: true });
}

/** Waits for the open quick input to show a title (or prompt) containing `title`. */
export async function waitForQuickInputTitle(
    page: Page,
    title: string | RegExp,
    timeout = 60 * 1000,
): Promise<void> {
    await expect(new QuickInput(page).widget).toContainText(title, { timeout });
}

/**
 * Picks the quick pick row for a file system path. VS Code renders paths through `Uri.fsPath`,
 * which lower-cases Windows drive letters, so the match ignores case.
 */
export async function pickPathOption(page: Page, fsPath: string): Promise<void> {
    await new QuickInput(page).widget
        .getByRole("option", { name: new RegExp(`^${escape(fsPath)}\\b`, "i") })
        .first()
        .click();
}

/** Whether a list of quick pick labels contains a path, ignoring case (see pickPathOption). */
export function containsPath(labels: string[], fsPath: string): boolean {
    return labels.some((label) => label.toLowerCase() === fsPath.toLowerCase());
}

/**
 * Types a path into VS Code's simple file dialog (enabled by getSeededLaunchConfig) and accepts
 * it. Folder dialogs accept a folder path; file dialogs accept a file path.
 */
export async function acceptSimpleDialogPath(page: Page, targetPath: string): Promise<void> {
    await submitInputBox(page, targetPath);
}

export type NewProjectOptions = {
    projectType?: "SQL Server Database" | "Azure SQL Database";
    name: string;
    /** Exact label of the location row, usually the default save location path. */
    location: string;
    /** Target platform row label. */
    targetPlatform: string;
    sdkStyle: boolean;
    configureDefaultBuild: boolean;
};

/** Rows observed while answering the new project prompts, for assertions about the flow. */
export type NewProjectPromptRows = {
    targetPlatforms: string[];
    defaultBuildOptions: string[];
};

/** Drives the "Database Projects: New" quick pick flow end to end. */
export async function createNewProject(
    page: Page,
    options: NewProjectOptions,
): Promise<{ projectFile: string; rows: NewProjectPromptRows }> {
    await new QuickInput(page).runCommand("Database Projects: New", "Database Projects: New");
    const rows = await answerNewProjectPrompts(page, options);
    const projectFile = path.join(options.location, options.name, `${options.name}.sqlproj`);
    await waitForFile(projectFile);
    await openProjectsView(page);
    await expect(getProjectTreeItem(page, options.name)).toBeVisible({ timeout: 60 * 1000 });
    return { projectFile, rows };
}

/** Answers the new project prompts once the project type quick pick is open. */
export async function answerNewProjectPrompts(
    page: Page,
    options: NewProjectOptions,
): Promise<NewProjectPromptRows> {
    const quickInput = new QuickInput(page);
    await waitForQuickInputTitle(page, "Select Database Project Type");
    await quickInput.pick(options.projectType ?? "SQL Server Database");
    await waitForQuickInputTitle(page, "Enter Project Name");
    await submitInputBox(page, options.name);
    await waitForQuickInputTitle(page, "Select Project Location");
    await pickPathOption(page, options.location);
    await waitForQuickInputTitle(page, "Select Target Platform");
    await expect(quickInput.rows.first()).toBeVisible();
    const targetPlatforms = await quickInput.labels();
    await quickInput.pick(options.targetPlatform);
    await waitForQuickInputTitle(page, "SDK-style project");
    await quickInput.pick(options.sdkStyle ? "Yes (Recommended)" : "No");
    await waitForQuickInputTitle(page, "default build configuration");
    await expect(quickInput.rows.first()).toBeVisible();
    const defaultBuildOptions = await quickInput.labels();
    await quickInput.pick(options.configureDefaultBuild ? "Yes" : "No");
    return { targetPlatforms, defaultBuildOptions };
}

/** Polls until a file exists. */
export async function waitForFile(filePath: string, timeout = 60 * 1000): Promise<void> {
    await expect
        .poll(() => fs.existsSync(filePath), {
            timeout,
            message: `Expected ${filePath} to exist.`,
        })
        .toBe(true);
}

/** Polls until a file no longer exists. */
export async function waitForFileToBeRemoved(filePath: string, timeout = 30 * 1000): Promise<void> {
    await expect
        .poll(() => fs.existsSync(filePath), {
            timeout,
            message: `Expected ${filePath} to be removed.`,
        })
        .toBe(false);
}

export function readText(filePath: string): string {
    return fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf8") : "";
}

/** Polls a file's text until it matches. */
export async function expectFileToContain(
    filePath: string,
    expected: string | RegExp,
    timeout = 30 * 1000,
): Promise<void> {
    await expect.poll(() => readText(filePath), { timeout }).toMatch(asRegExp(expected));
}

/** Polls a file's text until it no longer matches. */
export async function expectFileNotToContain(
    filePath: string,
    unexpected: string | RegExp,
    timeout = 30 * 1000,
): Promise<void> {
    await expect.poll(() => readText(filePath), { timeout }).not.toMatch(asRegExp(unexpected));
}

/** Path of the dacpac a project build produces. */
export function getDacpacPath(projectFile: string): string {
    const name = path.basename(projectFile, ".sqlproj");
    return path.join(path.dirname(projectFile), "bin", "Debug", `${name}.dacpac`);
}

/**
 * Runs a project's Build (or Build With Code Analysis) context action and waits for a fresh
 * dacpac. Removing the previous dacpac first guarantees the assertion reflects this build.
 */
export async function buildProjectFromTree(
    page: Page,
    projectFile: string,
    menuLabel: "Build" | "Build With Code Analysis" = "Build",
    timeout = 4 * 60 * 1000,
): Promise<string> {
    const dacpac = getDacpacPath(projectFile);
    fs.rmSync(dacpac, { force: true });
    const projectName = path.basename(projectFile, ".sqlproj");
    await runProjectContextAction(page, getProjectTreeItem(page, projectName), menuLabel);
    await waitForFile(dacpac, timeout);
    return dacpac;
}

/** The terminal input of a task terminal, named after its task label (e.g. "Build"). */
export function getTaskTerminal(page: Page, taskLabel: string | RegExp): Locator {
    const label = typeof taskLabel === "string" ? escape(taskLabel) : taskLabel.source;
    return page.getByRole("textbox", { name: new RegExp(`^Terminal \\d+, ${label}\\b`) });
}

/** Kills every terminal so task terminals from earlier tests do not linger. */
export async function killAllTerminals(page: Page): Promise<void> {
    await new QuickInput(page).runCommand(
        "Terminal: Kill All Terminals",
        "Terminal: Kill All Terminals",
    );
}

/** Clicks a button in the workbench's modal dialog, optionally checking its message first. */
export async function answerModalDialog(
    page: Page,
    button: string,
    message?: string | RegExp,
): Promise<void> {
    const dialog = page.getByRole("dialog").filter({
        has: page.getByRole("button", { name: button, exact: true }),
    });
    await expect(dialog).toBeVisible({ timeout: 30 * 1000 });
    if (message) {
        await expect(dialog).toContainText(message);
    }
    await dialog.getByRole("button", { name: button, exact: true }).click();
    await expect(dialog).toBeHidden();
}

/** Waits for a notification toast whose message matches. */
export async function waitForNotification(
    page: Page,
    message: string | RegExp,
    timeout = 60 * 1000,
): Promise<Locator> {
    const toast = page
        .getByRole("dialog", { name: /notification/i })
        .filter({ hasText: message })
        .first();
    await expect(toast).toBeVisible({ timeout });
    return toast;
}

/** Clears every notification so later assertions only see new ones. */
export async function clearNotifications(page: Page): Promise<void> {
    await new QuickInput(page).runCommand(
        "Notifications: Clear All Notifications",
        "Notifications: Clear All Notifications",
    );
}

/** Closes every editor, discarding nothing (callers only open saved or generated content). */
export async function closeAllEditors(page: Page): Promise<void> {
    // A focused webview (e.g. the Publish dialog) swallows the palette shortcut.
    await (await openProjectsView(page)).focus();
    await new QuickInput(page).runCommand("View: Close All Editors", "View: Close All Editors");
}

/**
 * Saves the active (untitled) editor to `filePath` through the simple Save As dialog, so its full
 * text can be read from disk instead of from the virtualized editor view.
 */
export async function saveActiveEditorAs(page: Page, filePath: string): Promise<string> {
    await new QuickInput(page).runCommand("File: Save As...", "File: Save As...");
    await acceptSimpleDialogPath(page, filePath);
    await expect
        .poll(() => readText(filePath).length, { message: `${filePath} was not saved.` })
        .toBeGreaterThan(0);
    return readText(filePath);
}

/** Finds a file by name anywhere under `root`, or undefined when there is none. */
export function findFile(root: string, fileName: string): string | undefined {
    const match = (fs.readdirSync(root, { recursive: true }) as string[]).find(
        (entry) => path.basename(entry) === fileName,
    );
    return match ? path.join(root, match) : undefined;
}

/** Polls until a file with this name exists under `root` and returns its path. */
export async function waitForProjectFile(root: string, fileName: string): Promise<string> {
    await expect
        .poll(() => findFile(root, fileName), {
            timeout: 30 * 1000,
            message: `Expected ${fileName} under ${root}.`,
        })
        .toBeTruthy();
    return findFile(root, fileName)!;
}

/**
 * Adds a new item (table, view, folder, ...) through a tree node's context menu and answers the
 * name prompt. Script items open in an editor afterwards; that is awaited so the editor taking
 * focus cannot close a quick input opened by the next step.
 */
export async function addItemFromTree(
    page: Page,
    node: Locator,
    menuLabel: string,
    name: string,
): Promise<void> {
    await runProjectContextAction(page, node, menuLabel, new QuickInput(page).widget);
    await submitInputBox(page, name);
    if (menuLabel !== "Add Folder") {
        await expect(
            page.getByRole("tab", { name: new RegExp(`^${escape(name)}\\.sql\\b`) }),
        ).toHaveAttribute("aria-selected", "true", { timeout: 30 * 1000 });
    }
}

/** Matches a project-relative path in a .sqlproj, which always uses backslash separators. */
export function sqlprojPath(relativePath: string): RegExp {
    return new RegExp(`Include="${relativePath.split("/").map(escape).join("\\\\")}"`);
}

/** Matches a SQLCMD variable entry with the given default value in a .sqlproj. */
export function sqlCmdVariablePattern(name: string, defaultValue: string): RegExp {
    return new RegExp(
        `<SqlCmdVariable Include="${escape(name)}">(?:(?!</SqlCmdVariable>)[\\s\\S])*` +
            `<DefaultValue>${escape(defaultValue)}</DefaultValue>`,
    );
}

/** Opens the Publish dialog for a project and waits until it is interactive. */
export async function openPublishDialog(page: Page, projectName: string): Promise<FrameLocator> {
    await runProjectContextAction(page, getProjectTreeItem(page, projectName), "Publish");
    const frame = await getWebviewByTitle(page, "Publish Project", 60 * 1000);
    await expect(frame.getByRole("button", { name: "Publish", exact: true })).toBeVisible({
        timeout: 60 * 1000,
    });
    return frame;
}

/** Picks the seeded server and types the target database in the Publish dialog. */
export async function choosePublishTarget(
    frame: FrameLocator,
    databaseName: string,
    profileName = SEEDED_PROFILE_NAME,
): Promise<void> {
    await frame.getByRole("button", { name: "Server", exact: true }).click();
    await frame
        .getByRole("listbox", { name: "Server" })
        .getByRole("option", { name: profileName, exact: true })
        .click();
    const database = frame.getByRole("combobox", { name: "Database", exact: true });
    await expect(database).toBeEnabled({ timeout: 60 * 1000 });
    await database.fill(databaseName);
    await database.press("Tab");
    await expect(database).toHaveValue(databaseName);
    await expect(frame.getByRole("button", { name: "Generate Script", exact: true })).toBeEnabled({
        timeout: 60 * 1000,
    });
}

/** Sets a deployment option in the Publish dialog's Advanced Publish Options drawer. */
export async function setPublishAdvancedOption(
    frame: FrameLocator,
    optionName: string,
    checked: boolean,
): Promise<void> {
    await frame.getByRole("button", { name: "Advanced", exact: true }).click();
    const drawer = frame.getByRole("dialog", { name: "Advanced Publish Options" });
    await expect(drawer).toBeVisible();
    await drawer.getByRole("searchbox").fill(optionName);
    const option = drawer.getByRole("checkbox", { name: optionName, exact: true });
    await option.setChecked(checked);
    await drawer.getByRole("button", { name: "OK", exact: true }).click();
    await expect(drawer).toBeHidden();
}

/** The value box of a SQLCMD variable row in the Publish dialog. */
export function getPublishSqlCmdValue(frame: FrameLocator, variableName: string): Locator {
    return frame
        .getByRole("table", { name: "SQLCMD Variables" })
        .getByRole("row", { name: new RegExp(`^${escape(variableName)}\\b`) })
        .getByRole("textbox");
}

/**
 * Clicks Generate Script, waits for the deployment script editor and saves it to `outputPath`.
 * Returns the full script text.
 */
export async function generatePublishScript(
    page: Page,
    frame: FrameLocator,
    outputPath: string,
): Promise<string> {
    await frame.getByRole("button", { name: "Generate Script", exact: true }).click();
    const scriptTab = page.getByRole("tab", { name: /^Untitled-\d+/ });
    const failure = page.getByRole("dialog", { name: /Generate script: Failed/ });
    await expect(scriptTab.or(failure).first()).toBeVisible({ timeout: 3 * 60 * 1000 });
    if (await failure.isVisible()) {
        throw new Error(`Script generation failed: ${await failure.getAttribute("aria-label")}`);
    }
    await expect(page.getByRole("tab", { name: /^Untitled-\d+/ })).toHaveAttribute(
        "aria-selected",
        "true",
    );
    // Saving turns the untitled script into a file, so later tests never meet a dirty editor.
    return saveActiveEditorAs(page, outputPath);
}

function asRegExp(value: string | RegExp): RegExp {
    return typeof value === "string" ? new RegExp(escape(value)) : value;
}

function escape(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
