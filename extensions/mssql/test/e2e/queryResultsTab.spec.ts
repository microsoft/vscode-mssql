/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { FrameLocator, Locator, Page } from "@playwright/test";
import { test, expect } from "./baseFixtures";
import { useSharedVsCodeLifecycle } from "./utils/testLifecycle";
import { connectActiveEditor, getSeededLaunchConfig } from "./utils/seededConnection";
import {
    executeQueryAndWait,
    getWebviewByTitle,
    openNewQueryEditor,
    setQueryText,
    waitForResultGrid,
} from "./utils/testHelpers";
import { getCell } from "./grid/gridActions";
import { testCases } from "./utils/testCases";

const OPEN_IN_TAB_SETTING = "mssql.openQueryResultsInTabByDefault";
const DO_NOT_SHOW_PROMPT_SETTING = "mssql.openQueryResultsInTabByDefaultDoNotShowPrompt";
const PROMPT_TEXT = /always display query results in a new tab/;

/** Settings that show the "open results in a tab by default" prompt, as for a new user. */
const promptEnabledConfig = () =>
    getSeededLaunchConfig({
        [OPEN_IN_TAB_SETTING]: false,
        [DO_NOT_SHOW_PROMPT_SETTING]: false,
    });

async function runMarkerQuery(page: Page, marker: string): Promise<void> {
    await openNewQueryEditor(page);
    await connectActiveEditor(page);
    // setQueryText inserts through the page; its Electron handle parameter is unused.
    await setQueryText(undefined as never, page, `SELECT '${marker}' AS marker;`);
    await executeQueryAndWait(page);
}

/** The results webview shown in the bottom panel. */
async function getPanelResults(page: Page): Promise<FrameLocator> {
    return getWebviewByTitle(page, "Query Results");
}

function getPrompt(page: Page): Locator {
    return page.getByRole("dialog").filter({ hasText: PROMPT_TEXT });
}

/** Results opened as a document are shown in a second editor group, named after the query. */
function getResultTabs(page: Page): Locator {
    return page.getByRole("tab", { name: /^Untitled-\d+, Editor Group 2$/ });
}

async function openResultsInTabAndExpectPrompt(page: Page): Promise<Locator> {
    await runMarkerQuery(page, "first");
    const panel = await getPanelResults(page);
    await expect(getCell(await waitForResultGrid(panel), 0, 0)).toHaveText("first");

    await panel.getByRole("button", { name: "Open in New Tab" }).click();
    await expect(getResultTabs(page)).toHaveCount(1);
    const tabResults = await getWebviewByTitle(page, "Untitled-1");
    await expect(getCell(await waitForResultGrid(tabResults), 0, 0)).toHaveText("first");

    const prompt = getPrompt(page);
    await expect(prompt).toBeVisible({ timeout: 30 * 1000 });
    await expect(prompt.getByRole("button", { name: "Always show in new tab" })).toBeVisible();
    await expect(prompt.getByRole("button", { name: "Keep in query pane" })).toBeVisible();
    return prompt;
}

/**
 * Opening results in a document tab, and the one-time prompt that offers to make that the
 * default: "Always show in new tab" sends later results straight to a tab, while "Keep in query
 * pane" leaves them in the panel. Each choice runs in its own VS Code, because the prompt is only
 * shown once per profile.
 */
test.describe("MSSQL Extension - Query results in a document tab", () => {
    test.describe("choosing Always show in new tab", () => {
        const getContext = useSharedVsCodeLifecycle({
            launchOptions: { initialConfig: promptEnabledConfig() },
        });

        test(
            "opens later results in a tab instead of the panel",
            testCases(5878891, 5878883, 5878884),
            async () => {
                const { page } = getContext();
                const prompt = await openResultsInTabAndExpectPrompt(page);
                await prompt.getByRole("button", { name: "Always show in new tab" }).click();
                await expect(prompt).toBeHidden();

                await runMarkerQuery(page, "second");
                await expect(getResultTabs(page)).toHaveCount(2, { timeout: 30 * 1000 });
                const tabResults = await getWebviewByTitle(page, "Untitled-2");
                await expect(getCell(await waitForResultGrid(tabResults), 0, 0)).toHaveText(
                    "second",
                );
                await expect(getPrompt(page)).toHaveCount(0);
            },
        );
    });

    test.describe("choosing Keep in query pane", () => {
        const getContext = useSharedVsCodeLifecycle({
            launchOptions: { initialConfig: promptEnabledConfig() },
        });

        test(
            "keeps later results in the panel and does not ask again",
            testCases(5878891, 5878882, 5878884),
            async () => {
                const { page } = getContext();
                const prompt = await openResultsInTabAndExpectPrompt(page);
                await prompt.getByRole("button", { name: "Keep in query pane" }).click();
                await expect(prompt).toBeHidden();

                await runMarkerQuery(page, "second");
                const panel = await getPanelResults(page);
                await expect(getCell(await waitForResultGrid(panel), 0, 0)).toHaveText("second");
                await expect(getResultTabs(page)).toHaveCount(1);

                // Opening this result in a tab still works, without the prompt.
                await panel.getByRole("button", { name: "Open in New Tab" }).click();
                await expect(getResultTabs(page)).toHaveCount(2);
                await expect(getPrompt(page)).toHaveCount(0);
            },
        );
    });
});
