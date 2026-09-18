/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect, FrameLocator, Locator, Page } from "@playwright/test";
import { promises as fs } from "fs";
import * as os from "os";
import * as path from "path";
import type { VsCodeAppHandle } from "./launchVscodeWithMsSqlExt";
import { QuickInput, VsCodeCommand } from "../pageObjects";

/**
 * Status bar text the extension publishes while a query is running.
 * Kept in sync with `executeQueryLabel` in src/constants/locConstants.ts.
 */
const EXECUTING_QUERY_STATUS = "Executing query...";

export async function addDatabaseConnection(
    vsCodePage: Page,
    serverName: string,
    databaseName: string,
    authType: string,
    userName: string,
    password: string,
    savePassword: string,
    profileName: string,
): Promise<void> {
    let iframe: FrameLocator;
    // Navigate to Sql Server Tab
    const sqlServerTabContainer = vsCodePage.locator('[role="tab"][aria-label^="SQL Server"]');
    const isSelected = await sqlServerTabContainer.getAttribute("aria-selected");

    if (isSelected !== "true") {
        const sqlServerTabElement = sqlServerTabContainer.locator("a");
        await sqlServerTabElement.waitFor({ state: "visible", timeout: 30 * 1000 });
        await sqlServerTabElement.click();
    }
    const addConnectionButton = await vsCodePage.locator('div[aria-label="Add Connection"]');
    await expect(addConnectionButton).toBeVisible({ timeout: 10000 });
    await addConnectionButton.click();

    iframe = await getWebviewByTitle(vsCodePage, "Connection Dialog");

    await iframe.getByRole("textbox", { name: "Server name" }).fill(serverName);

    if (databaseName) {
        await iframe.getByRole("textbox", { name: "Database name" }).fill(databaseName);
    }
    await iframe.getByRole("combobox", { name: "Authentication type" }).click();
    // Then select an option from the dropdown list that appears
    await iframe.getByRole("option", { name: authType }).click();

    if (authType === "SQL Login") {
        await iframe.getByRole("textbox", { name: "User name" }).fill(userName);
        await iframe.getByRole("textbox", { name: "Password" }).fill(password);

        await iframe.getByRole("checkbox", { name: "Save Password" }).click();
    }

    if (profileName) {
        await iframe.getByRole("textbox", { name: "Profile name" }).fill(profileName);
    }

    await new Promise((resolve) => setTimeout(resolve, 1 * 1000));

    await iframe.getByRole("checkbox", { name: "Trust server certificate" }).click();
    await iframe.getByRole("button", { name: "Connect", exact: true }).click();
}

export async function openNewQueryEditor(vsCodePage: Page): Promise<void> {
    // Picking the exact row rather than pressing Enter on the top fuzzy match: the palette ranks
    // results, so Enter can run a neighbouring command.
    await new QuickInput(vsCodePage).run(VsCodeCommand.mssqlNewQuery);
}

export async function disconnect(vsCodePage: Page): Promise<void> {
    await vsCodePage.keyboard.press(`${getModifierKey()}+P`);
    await vsCodePage.keyboard.type(">MS SQL: Disconnect");
    // await new Promise(resolve => setTimeout(resolve, 1 * 1000));
    await vsCodePage.keyboard.press("Enter");
}

export async function executeQuery(vsCodePage: Page): Promise<void> {
    const cancelConnectionButton = vsCodePage.locator('[aria-label^="Cancel Connection"]').first();
    if (await cancelConnectionButton.isVisible({ timeout: 2000 }).catch(() => false)) {
        await expect(cancelConnectionButton).toBeHidden({ timeout: 30 * 1000 });
    }

    const executeQueryButton = vsCodePage.locator('[aria-label^="Execute Query"]').first();
    await expect(executeQueryButton).toBeVisible();
    await executeQueryButton.click();
}

export async function enterTextIntoQueryEditor(vsCodePage: Page, text: string): Promise<void> {
    await vsCodePage.click('div[class="view-lines monaco-mouse-cursor-text"]');
    await vsCodePage.keyboard.type(text);
}

export async function waitForCommandPaletteToBeVisible(vsCodePage: Page): Promise<void> {
    const commandPaletteInput = vsCodePage.locator('input[aria-controls="quickInput_list"]');
    await expect(commandPaletteInput).toBeVisible();
}

/**
 * Resolves the webview frame whose inner iframe carries `title`.
 *
 * A plain `frameLocator(".webview")` resolves to exactly one frame under Playwright's strict
 * mode, so it throws as soon as a second webview is mounted — the results panel plus a dialog,
 * for example. The inner iframe lives in a different document, so CSS `:has()` cannot reach it
 * either; the outer frames have to be probed one at a time.
 */
export async function getWebviewByTitle(
    vsCodePage: Page,
    title: string,
    timeout = 30 * 1000,
): Promise<FrameLocator> {
    // VS Code's webview host keeps both active-frame and pending-frame during a reload
    // (src/vs/workbench/contrib/webview/browser/pre/index.html). A title-only frame locator
    // becomes ambiguous while the preview grid switch replaces the webview bundle.
    const innerSelector = `#active-frame[title='${title}']`;
    const outerFrames = vsCodePage.locator(".webview");
    const outerFrameLocators = vsCodePage.frameLocator(".webview");
    let matchedIndex = -1;

    await expect
        .poll(
            async () => {
                const count = await outerFrames.count();
                for (let index = 0; index < count; index++) {
                    // The inner iframe element lives in the outer frame's document, so probe
                    // each outer frame individually instead of resolving it against the page.
                    const innerCount = await outerFrameLocators
                        .nth(index)
                        .locator(`iframe${innerSelector}`)
                        .count();
                    if (innerCount > 0) {
                        matchedIndex = index;
                        return true;
                    }
                }
                return false;
            },
            {
                timeout,
                message: `Timed out waiting for a webview titled "${title}".`,
            },
        )
        .toBe(true);

    return outerFrameLocators.nth(matchedIndex).frameLocator(innerSelector);
}

export function isMac(): boolean {
    return process.platform === "darwin";
}

export function getModifierKey(): string {
    return isMac() ? "Meta" : "Control";
}

/** VS Code's status bar, which publishes connection and query execution state. */
export function getStatusBar(vsCodePage: Page): Locator {
    return vsCodePage.locator('[id="workbench.parts.statusbar"]');
}

/**
 * Writes to the real OS clipboard through Electron's main process.
 *
 * Pasting is the only safe way to get SQL into the editor: `keyboard.type()` lets the language
 * service turn a newline into a suggestion accept, which silently rewrites the query.
 */
export function writeClipboard(app: VsCodeAppHandle, text: string): Promise<void> {
    return app.evaluate(({ clipboard }, value) => clipboard.writeText(value), text);
}

/** Reads the real OS clipboard, so copy assertions check what the user would actually paste. */
export function readClipboard(app: VsCodeAppHandle): Promise<string> {
    return app.evaluate(({ clipboard }) => clipboard.readText());
}

/** Empties the clipboard so a stale value from an earlier test cannot satisfy an assertion. */
export function clearClipboard(app: VsCodeAppHandle): Promise<void> {
    return writeClipboard(app, "");
}

/**
 * The clipboard is the machine's, not the VS Code instance's.
 *
 * Every worker launches its own VS Code but they all write to the same OS clipboard, and the grid
 * project runs two workers over files that each copy and read. One worker clearing or copying
 * between another's copy and read makes the second assert against the first one's data, or
 * against an empty clipboard. Playwright has no cross-worker mutex, so this is a lock file: an
 * exclusive create is atomic, which is what makes it work between processes.
 */
const CLIPBOARD_LOCK_PATH = path.join(os.tmpdir(), "vscode-mssql-e2e-clipboard.lock");

/** Longer than any single clipboard test, so only a worker that died is treated as stale. */
const CLIPBOARD_LOCK_STALE_MS = 90 * 1000;

/** Takes the clipboard lock, waiting for whichever worker holds it. */
export async function acquireClipboardLock(timeout = 30 * 1000): Promise<void> {
    const deadline = Date.now() + timeout;

    for (;;) {
        try {
            // "wx" fails rather than truncating when the file exists, and that failure is the
            // lock: exactly one worker can win the create.
            const handle = await fs.open(CLIPBOARD_LOCK_PATH, "wx");
            try {
                await handle.writeFile(`${process.pid}`);
            } finally {
                await handle.close();
            }
            return;
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
                throw error;
            }
        }

        // A worker killed mid-test leaves the file behind; nothing else would ever clear it.
        try {
            const stats = await fs.stat(CLIPBOARD_LOCK_PATH);
            if (Date.now() - stats.mtimeMs > CLIPBOARD_LOCK_STALE_MS) {
                await fs.rm(CLIPBOARD_LOCK_PATH, { force: true });
                continue;
            }
        } catch {
            // Released between the failed create and the stat; just try again.
        }

        if (Date.now() > deadline) {
            throw new Error("Timed out waiting for the clipboard lock held by another worker.");
        }
        await new Promise((resolve) => setTimeout(resolve, 50));
    }
}

/** Releases the clipboard lock. Safe to call when this worker does not hold it. */
export async function releaseClipboardLock(): Promise<void> {
    await fs.rm(CLIPBOARD_LOCK_PATH, { force: true });
}

/** Runs `body` with the clipboard held exclusively across workers. */
export async function withClipboardLock<T>(body: () => Promise<T>): Promise<T> {
    await acquireClipboardLock();
    try {
        return await body();
    } finally {
        await releaseClipboardLock();
    }
}

/**
 * Replaces the active editor's contents with `sql` in one text input event.
 * Requires the editor determinism settings from GRID_LAUNCH_CONFIG.
 */
export async function setQueryText(
    _app: VsCodeAppHandle,
    vsCodePage: Page,
    sql: string,
): Promise<void> {
    await vsCodePage.click("div.view-lines.monaco-mouse-cursor-text");
    await vsCodePage.keyboard.press(`${getModifierKey()}+A`);
    // Insert the whole SQL string as one textInput event. This avoids Monaco's per-keystroke
    // suggestion acceptance on newlines and keeps the OS clipboard available for concurrent
    // grid clipboard tests running in another Playwright worker.
    await vsCodePage.keyboard.insertText(sql);
}

/** Waits for the status bar to report a live connection to `serverName`. */
export async function waitForConnected(
    vsCodePage: Page,
    serverName: string,
    timeout = 60 * 1000,
): Promise<void> {
    await expect(getStatusBar(vsCodePage)).toContainText(serverName, { timeout });
}

/**
 * Runs the active query and waits for the extension to stop reporting it as running.
 *
 * The status bar is only a coarse gate here, for two reasons found in `src/views/statusView.ts`:
 * `executedQuery` sets "Query executed" and then hides the item 200ms later, so polling for that
 * text is a race by construction; and with the preview grid enabled `setExecutionTime` returns
 * early because the timing moves into the webview footer instead. "Executing query..." is shown
 * for the whole run, so its disappearance is the reliable page-level signal.
 *
 * Callers that need to know the results are actually rendered should follow this with
 * {@link waitForResultGrid}, which gates on the grid's own row count.
 */
export async function executeQueryAndWait(vsCodePage: Page, timeout = 120 * 1000): Promise<void> {
    const statusBar = getStatusBar(vsCodePage);
    const executeQueryButton = vsCodePage.locator('[aria-label^="Execute Query"]').first();
    await expect(executeQueryButton).toBeVisible();
    await executeQueryButton.click();

    // A fast query can finish before this is observable, so entering the state is best-effort.
    await expect(statusBar)
        .toContainText(EXECUTING_QUERY_STATUS, { timeout: 5 * 1000 })
        .catch(() => undefined);
    await expect(statusBar).not.toContainText(EXECUTING_QUERY_STATUS, { timeout });
}

/**
 * Waits for a result grid to be rendered with at least `minRows` displayed rows.
 *
 * `data-row-count` is the grid's own view of what it is showing, so it stays honest through
 * filtering and streaming. Asserting on a cell's text instead would also match the Messages tab.
 */
export async function waitForResultGrid(
    resultsFrame: FrameLocator,
    gridId = "0_0",
    minRows = 1,
    timeout = 60 * 1000,
): Promise<Locator> {
    const grid = resultsFrame.locator(`[data-grid-id="${gridId}"]`);
    await expect(grid).toBeVisible({ timeout });
    await expect
        .poll(async () => Number((await grid.getAttribute("data-row-count")) ?? "0"), {
            timeout,
            message: `Timed out waiting for grid ${gridId} to display at least ${minRows} row(s).`,
        })
        .toBeGreaterThanOrEqual(minRows);
    return grid;
}

/**
 * Thin wrappers over the {@link QuickInput} page object.
 *
 * New specs should construct `new QuickInput(page)` directly; these remain so the existing
 * specs pick up the reliability fixes without being rewritten.
 */
export function closeQuickInput(vsCodePage: Page, timeout = 10 * 1000): Promise<void> {
    return new QuickInput(vsCodePage).close(timeout);
}

export function pickQuickInputItem(
    vsCodePage: Page,
    itemText: string,
    timeout = 30 * 1000,
): Promise<void> {
    return new QuickInput(vsCodePage).pick(itemText, timeout);
}

export function runCommandFromPalette(
    vsCodePage: Page,
    filterText: string,
    rowLabel: string,
    timeout = 30 * 1000,
): Promise<void> {
    return new QuickInput(vsCodePage).runCommand(filterText, rowLabel, timeout);
}
