/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as cp from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { expect, FrameLocator, Locator, Page } from "@playwright/test";
import { Connection, Request } from "tedious";
import { QuickInput } from "../pageObjects";
import { VsCodeAppHandle } from "./launchVscodeWithMsSqlExt";
import { test } from "../baseFixtures";
import { clickContextMenuItem, getSeededLaunchConfig } from "./seededConnection";
import { useSharedVsCodeLifecycle, VsCodeLaunchContext } from "./testLifecycle";
import { recreateDatabase, runSql, SqlRow } from "./sqlClient";
import {
    getModifierKey,
    getWebviewByTitle,
    readClipboard,
    withClipboardLock,
    writeClipboard,
} from "./testHelpers";

/** Name of the checked-in SDK-style fixture project (and of its .sqlproj file). */
export const FIXTURE_PROJECT_NAME = "PublishFixture";

const FIXTURE_DIR = path.join(
    __dirname,
    "..",
    "..",
    "resources",
    "e2e",
    "sqlProjectsPublish",
    FIXTURE_PROJECT_NAME,
);

/** A disposable copy of the fixture project, so tests never modify the checked-in sources. */
export interface FixtureProjectCopy {
    /** Folder containing the project; open it as the VS Code workspace. */
    projectDir: string;
    sqlprojPath: string;
    /** Absolute path of a file inside the project, from forward-slash relative segments. */
    file(relativePath: string): string;
    read(relativePath: string): string;
}

/**
 * Registers a shared VS Code lifecycle opened on a fresh temp copy of the fixture project.
 *
 * The copy is made in a beforeAll (not at module load, which also happens when a describe is
 * filtered out) and is removed afterwards, together with the VS Code profile directory that
 * the shared lifecycle leaves behind.
 */
export function useFixtureProjectLifecycle(
    options: {
        initialConfig?: Record<string, unknown>;
        /** Adjusts the copied project before VS Code opens it. */
        prepareProject?: (project: FixtureProjectCopy) => void;
        afterLaunch?: (context: VsCodeLaunchContext) => Promise<void>;
    } = {},
): { project: FixtureProjectCopy; getContext: () => VsCodeLaunchContext } {
    // realpath: on macOS the temp dir is a symlink, while VS Code and STS report resolved paths.
    const root = path.join(
        fs.realpathSync(os.tmpdir()),
        `mssql-e2e-sqlprojpub-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`,
    );
    const projectDir = path.join(root, FIXTURE_PROJECT_NAME);
    const file = (relativePath: string) => path.join(projectDir, ...relativePath.split("/"));
    const project: FixtureProjectCopy = {
        projectDir,
        sqlprojPath: file(`${FIXTURE_PROJECT_NAME}.sqlproj`),
        file,
        read: (relativePath) => fs.readFileSync(file(relativePath), "utf8"),
    };

    test.beforeAll(() => {
        fs.cpSync(FIXTURE_DIR, projectDir, { recursive: true });
        options.prepareProject?.(project);
    });

    const getContext = useSharedVsCodeLifecycle({
        launchOptions: {
            initialConfig: options.initialConfig ?? getSeededLaunchConfig(),
            extraLaunchArgs: [projectDir],
        },
        afterLaunch: options.afterLaunch,
    });

    // Registered after the lifecycle, so it runs once VS Code has been closed.
    test.afterAll(() => {
        fs.rmSync(root, { recursive: true, force: true, maxRetries: 3 });
        let context: VsCodeLaunchContext | undefined;
        try {
            context = getContext();
        } catch {
            return;
        }
        let closed: boolean;
        try {
            const electronProcess = context.electronApp.process();
            closed =
                typeof electronProcess.exitCode === "number" ||
                typeof electronProcess.signalCode === "string";
        } catch {
            // The app handle is unusable once VS Code has been closed.
            closed = true;
        }
        if (closed) {
            fs.rmSync(path.dirname(context.userDataDir), {
                recursive: true,
                force: true,
                maxRetries: 3,
            });
        }
    });

    return { project, getContext };
}

/** The Database Projects tree. */
export function getDatabaseProjectsTree(page: Page): Locator {
    return page.getByRole("tree", { name: "Database Projects" });
}

/** Shows the Database Projects view and waits for the fixture project node. */
export async function showDatabaseProjectsView(page: Page): Promise<Locator> {
    const tree = getDatabaseProjectsTree(page);
    if (!(await tree.isVisible())) {
        await page.getByRole("tab", { name: /^Database Projects/ }).click();
    }
    const projectNode = getProjectNode(page);
    await expect(projectNode).toBeVisible({ timeout: 2 * 60 * 1000 });
    return projectNode;
}

/** The fixture project's root node. */
export function getProjectNode(page: Page): Locator {
    return getDatabaseProjectsTree(page).getByRole("treeitem", {
        name: FIXTURE_PROJECT_NAME,
        exact: true,
    });
}

/**
 * A file or folder node. Their accessible names are the item's full path, so match on the
 * trailing path segment (either separator, so it works on Windows too).
 */
export function getProjectItemNode(page: Page, fileName: string): Locator {
    const escaped = fileName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return getDatabaseProjectsTree(page).getByRole("treeitem", {
        name: new RegExp(`[\\\\/]${escaped}$`),
    });
}

/** Right-clicks the project node and runs a context menu item. */
export async function runProjectContextAction(page: Page, menuLabel: string): Promise<void> {
    const projectNode = await showDatabaseProjectsView(page);
    await projectNode.click({ button: "right" });
    await clickContextMenuItem(page, menuLabel);
}

/** Opens the Publish dialog from the project node and waits until it has loaded the project. */
export async function openPublishDialog(page: Page): Promise<FrameLocator> {
    await runProjectContextAction(page, "Publish");
    const dialog = await getWebviewByTitle(page, "Publish Project");
    await expect(dialog.getByText(`Publish Project - ${FIXTURE_PROJECT_NAME}`)).toBeVisible({
        timeout: 60 * 1000,
    });
    // The SQLCMD table appears once the project's properties have been read.
    await expect(dialog.getByRole("textbox", { name: "Value for EnvName" })).toBeVisible({
        timeout: 60 * 1000,
    });
    return dialog;
}

/** Picks a saved connection in the Publish dialog's Server dropdown and waits for it to connect. */
export async function selectPublishServer(dialog: FrameLocator, profileName: string) {
    await dialog.getByRole("button", { name: "Server" }).click();
    await dialog.getByRole("option", { name: profileName, exact: true }).click();
    await expect(dialog.getByRole("button", { name: "Server" })).toHaveText(profileName, {
        timeout: 60 * 1000,
    });
    // The database list is fetched after connecting; it always contains master.
    await expect(dialog.getByRole("button", { name: "Publish", exact: true })).toBeEnabled({
        timeout: 60 * 1000,
    });
}

/** Types a database name into the Publish dialog's Database combobox. */
export async function setPublishDatabase(dialog: FrameLocator, databaseName: string) {
    const database = dialog.getByRole("combobox", { name: "Database" });
    await database.fill(databaseName);
    await database.press("Tab");
    await expect(database).toHaveValue(databaseName);
}

/** Sets a SQLCMD variable value in the Publish dialog. */
export async function setSqlCmdVariable(dialog: FrameLocator, name: string, value: string) {
    const input = dialog.getByRole("textbox", { name: `Value for ${name}` });
    await input.fill(value);
    await input.blur();
    await expect(input).toHaveValue(value);
}

/**
 * Answers VS Code's simple (HTML) file dialog, enabled by `files.simpleDialog.enable` in the
 * seeded settings, by typing an absolute path.
 */
export async function answerSimpleFileDialog(page: Page, filePath: string): Promise<void> {
    const pathBox = page.getByRole("textbox", { name: /path/i });
    await expect(pathBox).toBeVisible({ timeout: 30 * 1000 });
    await pathBox.fill(filePath);
    await expect(pathBox).toHaveValue(filePath);
    await pathBox.press("Enter");
    await expect(pathBox).toBeHidden({ timeout: 30 * 1000 });
}

/**
 * Reads the whole active editor through the clipboard. The rendered view only contains the
 * lines that are on screen, and generated deployment scripts are much longer than that.
 */
export async function readActiveEditorText(
    app: VsCodeAppHandle,
    page: Page,
    editor: Locator,
): Promise<string> {
    return withClipboardLock(async () => {
        await writeClipboard(app, "");
        await editor.click();
        await page.keyboard.press(`${getModifierKey()}+A`);
        await page.keyboard.press(`${getModifierKey()}+C`);
        let text = "";
        await expect
            .poll(async () => (text = await readClipboard(app)), { timeout: 10 * 1000 })
            .not.toBe("");
        return text;
    });
}

/** The editor in the active editor group. */
export function getActiveEditor(page: Page): Locator {
    return page.locator(".editor-group-container.active").getByRole("code").first();
}

/** True when the Docker CLI is installed and the engine is running. */
export function isDockerAvailable(): boolean {
    const result = cp.spawnSync("docker", ["info", "--format", "{{.ServerVersion}}"], {
        encoding: "utf8",
        shell: process.platform === "win32",
    });
    return result.status === 0 && !!result.stdout.trim();
}

/**
 * On Apple silicon the extension's Docker prerequisite check reads Docker Desktop's settings
 * file. macOS guards that file behind an app-data privacy consent prompt, which blocks an
 * unattended run indefinitely; returns false when the file cannot be read promptly.
 */
export function canReadDockerDesktopSettings(): boolean {
    if (process.platform !== "darwin" || process.arch === "x64") {
        return true;
    }
    const settingsPath = path.join(
        os.homedir(),
        "Library",
        "Group Containers",
        "group.com.docker",
        "settings-store.json",
    );
    const result = cp.spawnSync("cat", [settingsPath], { timeout: 2000 });
    return result.status === 0;
}

/** Names of all containers, running or not. */
export function listContainerNames(): string[] {
    const result = cp.spawnSync("docker", ["ps", "-a", "--format", "{{.Names}}"], {
        encoding: "utf8",
        shell: process.platform === "win32",
    });
    return result.status === 0 ? splitLines(result.stdout) : [];
}

function splitLines(output: string): string[] {
    return output
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.length > 0);
}

/** Names of the containers (running or not) that publish the given host port. */
export function findContainersPublishingPort(port: number): string[] {
    const result = cp.spawnSync(
        "docker",
        ["ps", "-a", "--filter", `publish=${port}`, "--format", "{{.Names}}"],
        { encoding: "utf8", shell: process.platform === "win32" },
    );
    return result.status === 0 ? splitLines(result.stdout) : [];
}

/** True when the named container is running. */
export function isContainerRunning(containerName: string): boolean {
    const result = cp.spawnSync(
        "docker",
        ["inspect", "--format", "{{.State.Running}}", containerName],
        { encoding: "utf8", shell: process.platform === "win32" },
    );
    return result.status === 0 && result.stdout.trim() === "true";
}

/** Force-removes containers this suite created. Never pass a name the suite did not create. */
export function removeContainers(containerNames: string[]): void {
    if (containerNames.length === 0) {
        return;
    }
    cp.spawnSync("docker", ["rm", "-f", ...containerNames], {
        encoding: "utf8",
        shell: process.platform === "win32",
    });
}

/** Closes the active editor, discarding unsaved changes (e.g. a generated, untitled script). */
export async function revertAndCloseActiveEditor(page: Page): Promise<void> {
    await new QuickInput(page).runCommand(
        "View: Revert and Close Editor",
        "View: Revert and Close Editor",
    );
}

/** Closes every editor; use only when none of them has unsaved changes. */
export async function closeAllEditors(page: Page): Promise<void> {
    await new QuickInput(page).runCommand("View: Close All Editors", "View: Close All Editors");
}

/** Runs a query against a SQL Server container this suite published to. */
export async function queryContainer(
    port: number,
    password: string,
    sql: string,
    database = "master",
): Promise<SqlRow[]> {
    const connection = await new Promise<Connection>((resolve, reject) => {
        const candidate = new Connection({
            server: "localhost",
            authentication: { type: "default", options: { userName: "sa", password } },
            options: {
                database,
                port,
                encrypt: true,
                trustServerCertificate: true,
                connectTimeout: 30 * 1000,
            },
        });
        candidate.on("connect", (error) => (error ? reject(error) : resolve(candidate)));
        candidate.connect();
    });
    try {
        return await new Promise<SqlRow[]>((resolve, reject) => {
            const rows: SqlRow[] = [];
            const request = new Request(sql, (error) => (error ? reject(error) : resolve(rows)));
            request.on("row", (columns) => {
                const row: SqlRow = {};
                for (const column of columns) {
                    row[column.metadata.colName] = column.value;
                }
                rows.push(row);
            });
            connection.execSql(request);
        });
    } finally {
        connection.close();
    }
}

/** Opens the Publish dialog's Advanced drawer. */
export async function openAdvancedOptions(dialog: FrameLocator): Promise<Locator> {
    await dialog.getByRole("button", { name: "Advanced", exact: true }).click();
    const drawer = dialog.getByRole("dialog", { name: "Advanced Publish Options" });
    await expect(drawer).toBeVisible();
    return drawer;
}

/** Sets one boolean deployment option through the Advanced drawer and confirms with OK. */
export async function setAdvancedOption(
    dialog: FrameLocator,
    optionName: string,
    checked: boolean,
): Promise<void> {
    const drawer = await openAdvancedOptions(dialog);
    await drawer.getByRole("checkbox", { name: optionName, exact: true }).setChecked(checked);
    await drawer.getByRole("button", { name: "OK" }).click();
    await expect(drawer).toBeHidden();
}

/** Fixture scripts in dependency order, used to create a database matching the project. */
const FIXTURE_OBJECT_SCRIPTS = [
    "Sales/Sales.sql",
    "Archive/Archive.sql",
    "dbo/Tables/DeploymentInfo.sql",
    "dbo/Tables/Customer.sql",
    "dbo/Tables/Orders.sql",
    "dbo/Tables/Product.sql",
    "Sales/Tables/Product.sql",
    "dbo/Views/CustomerOrders.sql",
    "dbo/StoredProcedures/GetCustomer.sql",
];

/** Reads a file of the checked-in fixture project. */
export function readFixtureFile(relativePath: string): string {
    return fs.readFileSync(path.join(FIXTURE_DIR, ...relativePath.split("/")), "utf8");
}

/** Creates a database containing the fixture project's original schema. */
export async function createFixtureDatabase(databaseName: string): Promise<void> {
    await recreateDatabase(databaseName);
    for (const script of FIXTURE_OBJECT_SCRIPTS) {
        await runSql(
            fs.readFileSync(path.join(FIXTURE_DIR, ...script.split("/")), "utf8"),
            databaseName,
        );
    }
}

/**
 * Opens a file through Quick Open and waits for its editor tab. Pass a relative path as
 * `searchText` when several files share the name.
 */
export async function openFileWithQuickOpen(
    page: Page,
    fileName: string,
    searchText = fileName,
): Promise<void> {
    const quickInput = new QuickInput(page);
    // Replacing the palette's ">" prefix switches it to file search.
    await quickInput.open();
    await quickInput.filter(searchText);
    await quickInput.pick(fileName);
    await expect(page.getByRole("tab", { name: new RegExp(`^${fileName}`) })).toHaveAttribute(
        "aria-selected",
        "true",
    );
}

/**
 * Clicks on the first rendered occurrence of `text` in the active editor, which focuses the
 * editor and puts the cursor inside that word.
 */
export async function clickInActiveEditor(page: Page, text: string): Promise<void> {
    const occurrence = getActiveEditor(page).getByText(text).first();
    await expect(occurrence).toBeVisible({ timeout: 30 * 1000 });
    const box = (await occurrence.boundingBox())!;
    // Click inside the word rather than on its edge, so the cursor is unambiguously within it.
    await occurrence.click({ position: { x: Math.min(box.width / 2, 20), y: box.height / 2 } });
    await expect(getActiveEditor(page).getByRole("textbox").first()).toBeFocused();
}

/**
 * Runs Find All References at the cursor and checks that the References view lists exactly the
 * given files (by file name).
 */
export async function expectFindAllReferences(page: Page, fileNames: string[]): Promise<void> {
    await new QuickInput(page).runCommand(
        "References: Find All References",
        "References: Find All References",
    );
    const references = page.getByRole("tree", { name: "References" });
    const files = references.getByRole("treeitem", { level: 1 });
    for (const fileName of fileNames) {
        await expect(files.filter({ has: page.getByText(fileName, { exact: true }) })).toHaveCount(
            1,
            { timeout: 60 * 1000 },
        );
    }
    await expect(files).toHaveCount(fileNames.length);
    // The view takes focus once it has rendered the results; wait for that so it cannot steal
    // focus from whatever the test does next (e.g. close a Quick Open).
    await expect(references).toBeFocused();
}

/** VS Code's Refactor Preview tree of pending edits. */
export function getRefactorPreview(page: Page): Locator {
    return page.getByRole("tree", { name: "Bulk Edit" });
}
