/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect, FrameLocator, Locator, Page } from "@playwright/test";
import * as cp from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { QuickInput } from "../pageObjects/quickInput";
import { VsCodeAppHandle } from "./launchVscodeWithMsSqlExt";
import {
    getModifierKey,
    getWebviewByTitle,
    readClipboard,
    withClipboardLock,
    writeClipboard,
} from "./testHelpers";

/** Title of the Schema Compare webview panel. */
export const SCHEMA_COMPARE_TITLE = "Schema Compare";

/** Checked-in Schema Compare fixtures: SDK-style projects that are built into dacpacs. */
export const SCHEMA_COMPARE_FIXTURES = path.join(
    __dirname,
    "..",
    "..",
    "resources",
    "e2e",
    "schemaCompare",
);

/** Creates a temp directory with symlinks resolved, so paths match what VS Code reports. */
export function makeSchemaCompareTempDir(): string {
    return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "mssql-e2e-schemacompare-")));
}

/**
 * Copies a fixture project into `workDir` and builds it with the .NET SDK, returning the paths of
 * the copied project file and the dacpac it produced.
 */
export function buildFixtureProject(
    projectName: string,
    workDir: string,
): { projectFile: string; dacpac: string } {
    const projectDir = path.join(workDir, projectName);
    fs.cpSync(path.join(SCHEMA_COMPARE_FIXTURES, projectName), projectDir, { recursive: true });
    const projectFile = path.join(projectDir, `${projectName}.sqlproj`);
    const outputDir = path.join(workDir, "dacpacs", projectName);
    const result = cp.spawnSync(
        "dotnet",
        ["build", projectFile, "-nologo", "-v", "q", "-o", outputDir],
        { encoding: "utf8", shell: process.platform === "win32" },
    );
    if (result.status !== 0) {
        throw new Error(
            `dotnet build ${projectName} failed (${result.status}):\n${result.stdout}\n${result.stderr}`,
        );
    }
    const dacpac = path.join(outputDir, `${projectName}.dacpac`);
    if (!fs.existsSync(dacpac)) {
        throw new Error(`dotnet build did not produce ${dacpac}.`);
    }
    // The build leaves bin/obj next to the project, which would make a project endpoint see
    // generated files; only the sources are wanted there.
    fs.rmSync(path.join(projectDir, "bin"), { recursive: true, force: true });
    fs.rmSync(path.join(projectDir, "obj"), { recursive: true, force: true });
    return { projectFile, dacpac };
}

/** True when the .NET SDK needed to build the fixture projects is on PATH. */
export function isDotnetAvailable(): boolean {
    const result = cp.spawnSync("dotnet", ["--version"], {
        encoding: "utf8",
        shell: process.platform === "win32",
    });
    return result.status === 0;
}

/** Opens a new Schema Compare panel from the command palette. */
export async function openSchemaCompareFromPalette(page: Page): Promise<FrameLocator> {
    await new QuickInput(page).runCommand("MS SQL: Compare Schemas", "MS SQL: Compare Schemas...");
    return getSchemaCompareFrame(page);
}

/** Resolves the Schema Compare webview once its toolbar has rendered. */
export async function getSchemaCompareFrame(page: Page): Promise<FrameLocator> {
    const frame = await getWebviewByTitle(page, SCHEMA_COMPARE_TITLE, 60 * 1000);
    await expect(getToolbarButton(frame, "Compare")).toBeVisible({ timeout: 60 * 1000 });
    return frame;
}

/** The Schema Compare action toolbar. */
export function getToolbar(frame: FrameLocator): Locator {
    return frame.getByRole("toolbar", { name: "Schema Compare actions" });
}

export function getToolbarButton(frame: FrameLocator, name: string): Locator {
    return getToolbar(frame).getByRole("button", { name, exact: true });
}

export type SchemaEndpoint =
    | { kind: "database"; connection: string; database: string }
    | { kind: "dacpac"; file: string }
    | { kind: "sqlproj"; file: string };

const ENDPOINT_RADIO_LABELS: Record<SchemaEndpoint["kind"], string> = {
    database: "Database",
    dacpac: "Data-tier Application File (.dacpac)",
    sqlproj: "Database Project",
};

/** Opens the Select Source/Target drawer through its "..." button and returns the drawer. */
export async function openSchemaSelector(
    frame: FrameLocator,
    side: "source" | "target",
): Promise<Locator> {
    const sideLabel = side === "source" ? "Source" : "Target";
    await frame.getByRole("button", { name: `Select ${sideLabel} Schema`, exact: true }).click();
    const drawer = frame.getByRole("dialog", { name: `Select ${sideLabel}` });
    await expect(drawer).toBeVisible();
    return drawer;
}

/** Picks the source or target schema through the selector drawer. */
export async function selectEndpoint(
    page: Page,
    frame: FrameLocator,
    side: "source" | "target",
    endpoint: SchemaEndpoint,
): Promise<void> {
    const drawer = await openSchemaSelector(frame, side);
    await drawer
        .getByRole("radio", { name: ENDPOINT_RADIO_LABELS[endpoint.kind], exact: true })
        .check();

    if (endpoint.kind === "database") {
        const connection = drawer.getByRole("button", { name: "Connection", exact: true });
        await connection.click();
        await frame.getByRole("option", { name: endpoint.connection, exact: true }).click();
        const database = drawer.getByRole("combobox", { name: "Database", exact: true });
        await expect(database).toBeEnabled({ timeout: 60 * 1000 });
        await database.click();
        await frame.getByRole("option", { name: endpoint.database, exact: true }).click();
        await expect(database).toHaveText(endpoint.database);
    } else {
        await drawer.getByRole("button", { name: "Browse...", exact: true }).click();
        await acceptSimpleFileDialog(page, endpoint.file);
        await expect(drawer.getByRole("textbox", { name: "File", exact: true })).toHaveValue(
            endpoint.file,
        );
    }

    const ok = drawer.getByRole("button", { name: "OK", exact: true });
    await expect(ok).toBeEnabled({ timeout: 30 * 1000 });
    await ok.click();
    await expect(drawer).toBeHidden();
}

/** Types a path into VS Code's simple file dialog and accepts it. */
export async function acceptSimpleFileDialog(page: Page, filePath: string): Promise<void> {
    const input = new QuickInput(page).input.filter({ visible: true });
    await expect(input).toBeVisible({ timeout: 30 * 1000 });
    await input.fill(filePath);
    await expect(input).toHaveValue(filePath);
    await input.press("Enter");
    await expect(input).toBeHidden({ timeout: 30 * 1000 });
}

/** Runs a comparison from the toolbar and waits for it to finish. */
export async function runComparison(frame: FrameLocator): Promise<void> {
    await getToolbarButton(frame, "Compare").click();
    await waitForComparison(frame);
}

/**
 * Waits until a comparison has produced either a differences grid or the no-differences text.
 * The previous result stays on screen until the new comparison starts, so this first gives the
 * "Comparing..." status a moment to appear; a very fast comparison may finish before it renders.
 */
export async function waitForComparison(frame: FrameLocator): Promise<void> {
    const comparing = frame.getByText("Comparing...");
    await comparing.waitFor({ state: "visible", timeout: 5 * 1000 }).catch(() => undefined);
    await expect(comparing).toBeHidden({ timeout: 3 * 60 * 1000 });
    await expect(getNoDifferencesMessage(frame).or(getDifferencesGrid(frame))).toBeVisible({
        timeout: 30 * 1000,
    });
}

export function getNoDifferencesMessage(frame: FrameLocator): Locator {
    return frame.getByText("No schema differences were found.", { exact: true });
}

export function getDifferencesGrid(frame: FrameLocator): Locator {
    return frame.getByRole("grid", { name: "Schema Differences" });
}

/**
 * Difference rows. Each is named "{type}, {name}, {action}, included in script" (or "excluded
 * from script"). Group header rows are named "{group}, {n} differences" and are not matched.
 */
export function getDifferenceRows(frame: FrameLocator, type?: string): Locator {
    const typePattern = type ? escapeRegExp(type) : "[^,]+";
    return getDifferencesGrid(frame).getByRole("row", {
        name: new RegExp(`^${typePattern}, .+, (included in|excluded from) script$`),
    });
}

/** Reads the difference row labels, parsed into their parts. */
export async function getDifferences(
    frame: FrameLocator,
): Promise<{ type: string; name: string; action: string; included: boolean }[]> {
    const labels = await getDifferenceRows(frame).evaluateAll((rows) =>
        rows.map((row) => row.getAttribute("aria-label") ?? ""),
    );
    return labels.map((label) => {
        const parts = label.split(", ");
        return {
            type: parts[0],
            name: parts.slice(1, -2).join(", "),
            action: parts[parts.length - 2],
            included: parts[parts.length - 1] === "included in script",
        };
    });
}

/** The "include or exclude all" checkbox in the differences grid header. */
export function getIncludeAllCheckbox(frame: FrameLocator): Locator {
    return getDifferencesGrid(frame).getByRole("checkbox", {
        name: "Include or exclude all differences",
    });
}

/** Opens the Schema Compare Options drawer from the toolbar. */
export async function openOptions(frame: FrameLocator): Promise<Locator> {
    await getToolbarButton(frame, "Options").click();
    const drawer = frame.getByRole("dialog", { name: "Schema Compare Options" });
    await expect(drawer).toBeVisible();
    return drawer;
}

/** Selects a tab of the Options drawer. */
export async function selectOptionsTab(
    drawer: Locator,
    tab: "General Options" | "Include Object Types",
): Promise<void> {
    const tabLocator = drawer.getByRole("tab", { name: tab, exact: true });
    await tabLocator.click();
    await expect(tabLocator).toHaveAttribute("aria-selected", "true");
}

/** An option checkbox in the currently selected tab of the Options drawer. */
export function getOptionCheckbox(drawer: Locator, label: string): Locator {
    return drawer.getByRole("checkbox", { name: label, exact: true });
}

/** Sets option checkboxes on a tab of the Options drawer. */
export async function setOptions(
    drawer: Locator,
    tab: "General Options" | "Include Object Types",
    labels: string[],
    checked: boolean,
): Promise<void> {
    await selectOptionsTab(drawer, tab);
    for (const label of labels) {
        const checkbox = getOptionCheckbox(drawer, label);
        // The checkboxes are controlled by state that round-trips through the extension, so the
        // new value renders asynchronously; setChecked would give up before it does.
        if ((await checkbox.isChecked()) !== checked) {
            await checkbox.click();
        }
        await expect(checkbox).toBeChecked({ checked });
    }
}

/** Reads which of `labels` are checked on a tab of the Options drawer. */
export async function readOptions(
    drawer: Locator,
    tab: "General Options" | "Include Object Types",
    labels: string[],
): Promise<Record<string, boolean>> {
    await selectOptionsTab(drawer, tab);
    const state: Record<string, boolean> = {};
    for (const label of labels) {
        state[label] = await getOptionCheckbox(drawer, label).isChecked();
    }
    return state;
}

/**
 * Confirms the Options drawer. When options changed the extension asks whether to recompare;
 * this answers Yes and waits for the new comparison.
 */
export async function confirmOptionsAndRecompare(
    page: Page,
    frame: FrameLocator,
    drawer: Locator,
): Promise<void> {
    await drawer.getByRole("button", { name: "OK", exact: true }).click();
    await expect(drawer).toBeHidden();
    const prompt = page
        .getByRole("dialog")
        .filter({ hasText: "Options have changed. Recompare to see the comparison?" });
    await expect(prompt).toBeVisible({ timeout: 30 * 1000 });
    await prompt.getByRole("button", { name: "Yes", exact: true }).click();
    await expect(prompt).toBeHidden();
    await waitForComparison(frame);
}

/** Toggles object types on the Include Object Types tab and reruns the comparison. */
export async function setObjectTypesAndRecompare(
    page: Page,
    frame: FrameLocator,
    objectTypes: string[],
    included: boolean,
): Promise<void> {
    const drawer = await openOptions(frame);
    await setOptions(drawer, "Include Object Types", objectTypes, included);
    await confirmOptionsAndRecompare(page, frame, drawer);
}

/** Clicks Apply, confirms the summary dialog, and waits for the success notification. */
export async function applyChanges(page: Page, frame: FrameLocator): Promise<void> {
    await getToolbarButton(frame, "Apply").click();
    const dialog = frame.getByRole("dialog").filter({ hasText: /Apply changes to/ });
    await expect(dialog).toBeVisible();
    const apply = dialog.getByRole("button", { name: "Apply", exact: true });
    await expect(apply).toBeDisabled();
    await dialog.getByRole("checkbox").check();
    await apply.click();
    await expect(dialog).toBeHidden();
    await expect(
        page
            .getByRole("dialog", { name: /notification/i })
            .filter({ hasText: /Apply schema compare changes:? Succeeded/i })
            .first(),
    ).toBeVisible({ timeout: 3 * 60 * 1000 });
}

/** Saves the comparison to an .scmp file through the simple Save dialog. */
export async function saveScmp(page: Page, frame: FrameLocator, filePath: string): Promise<void> {
    await getToolbarButton(frame, "Save .scmp file").click();
    await acceptSimpleFileDialog(page, filePath);
    await expect.poll(() => fs.existsSync(filePath), { timeout: 60 * 1000 }).toBe(true);
}

/** Opens an .scmp file through the simple Open dialog and waits for the endpoints to load. */
export async function openScmp(page: Page, frame: FrameLocator, filePath: string): Promise<void> {
    await getToolbarButton(frame, "Open .scmp file").click();
    await acceptSimpleFileDialog(page, filePath);
}

/** Closes every editor, including the Schema Compare panel and generated scripts. */
export async function closeAllEditors(page: Page): Promise<void> {
    await new QuickInput(page).runCommand("View: Close All Editors", "View: Close All Editors");
    // Generated scripts are dirty untitled editors, so closing each one prompts to save it.
    const savePrompt = page.getByRole("dialog").filter({ hasText: /Do you want to save/ });
    await expect
        .poll(
            async () => {
                if (await savePrompt.isVisible()) {
                    await savePrompt.getByRole("button", { name: "Don't Save" }).click();
                }
                return page.locator(".editor-group-container .tab").count();
            },
            { timeout: 30 * 1000, message: "Editors stayed open after Close All Editors." },
        )
        .toBe(0);
}

/**
 * Reads the whole active text editor through the clipboard. The rendered view holds only the
 * lines on screen, and deployment scripts are longer than that.
 */
export async function readActiveEditorText(app: VsCodeAppHandle, page: Page): Promise<string> {
    const editor = page.locator(".editor-group-container.active").getByRole("code").first();
    await expect(editor).toBeVisible({ timeout: 60 * 1000 });
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

function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
