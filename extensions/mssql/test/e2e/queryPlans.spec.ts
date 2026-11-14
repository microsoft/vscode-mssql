/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { FrameLocator, Page } from "@playwright/test";
import { test, expect } from "./baseFixtures";
import { useSharedVsCodeLifecycle } from "./utils/testLifecycle";
import { connectActiveEditor, getSeededLaunchConfig } from "./utils/seededConnection";
import {
    executeQueryAndWait,
    getWebviewByTitle,
    openNewQueryEditor,
    setQueryText,
    waitForQueryExecutionToEnd,
    waitForResultGrid,
} from "./utils/testHelpers";
import { testCases } from "./utils/testCases";

/** Editor title actions, named by their command titles in package.nls.json. */
const ESTIMATED_PLAN_BUTTON = "Estimated Plan (MSSQL)";
const ENABLE_ACTUAL_PLAN_BUTTON = "Enable Actual Plan (MSSQL)";
const DISABLE_ACTUAL_PLAN_BUTTON = "Disable Actual Plan (MSSQL)";

/** Column header the grid shows for the showplan XML result set returned with an actual plan. */
const SHOWPLAN_XML_COLUMN = "Showplan XML";

/**
 * Plans generated from live queries in the classic query editor: the Estimated Plan button and
 * the Enable/Disable Actual Plan toggle. Plan-viewer toolbar behaviour is covered against a saved
 * .sqlplan file in executionPlan.spec.ts.
 */
test.describe("MSSQL Extension - Query Plans from the query editor", () => {
    let resultsFrame: FrameLocator;

    const getContext = useSharedVsCodeLifecycle({
        launchOptions: { initialConfig: getSeededLaunchConfig() },
    });

    async function openConnectedEditor(page: Page): Promise<void> {
        await openNewQueryEditor(page);
        await connectActiveEditor(page);
    }

    async function getResultsFrame(page: Page): Promise<FrameLocator> {
        resultsFrame = await getWebviewByTitle(page, "Query Results");
        return resultsFrame;
    }

    function resultTab(name: string | RegExp) {
        return resultsFrame.getByRole("tab", { name });
    }

    /** Reads each plan's "Query N: Query cost (relative to the script): X%" header. */
    async function readQueryCosts(): Promise<number[]> {
        const headers = resultsFrame.getByText(
            /Query \d+:\s+Query cost \(relative to the script\)/,
        );
        const texts = await headers.allInnerTexts();
        return texts.map((text) => Number(/script\):\s+([\d.]+)%/.exec(text)![1]));
    }

    test(
        "Estimated Plan shows a plan per statement with costs relative to the script",
        testCases(5878880),
        async () => {
            const { electronApp, page } = getContext();
            await openConnectedEditor(page);
            await setQueryText(
                electronApp,
                page,
                "select * from sys.objects; select * from sys.objects a cross join sys.objects b",
            );

            await page.getByRole("button", { name: ESTIMATED_PLAN_BUTTON }).click();
            await waitForQueryExecutionToEnd(page);
            await getResultsFrame(page);

            await expect(resultTab("Query Plan (2)")).toHaveAttribute("aria-selected", "true", {
                timeout: 60 * 1000,
            });
            // Costs are filled in once both plans are parsed, so wait for the final split.
            await expect
                .poll(async () => (await readQueryCosts())[1] ?? 0, { timeout: 30 * 1000 })
                .toBeGreaterThan(90);
            const [first, second] = await readQueryCosts();
            // The cross join dominates the script; the manual case expects roughly a 1/99 split.
            expect(first).toBeLessThan(10);
            expect(second).toBeGreaterThan(90);
            expect(first + second).toBeCloseTo(100, 0);
        },
    );

    test(
        "the actual plan toggle swaps between Enable and Disable",
        testCases(5878881),
        async () => {
            const { page } = getContext();
            await openConnectedEditor(page);

            await page.getByRole("button", { name: ENABLE_ACTUAL_PLAN_BUTTON }).click();
            await expect(
                page.getByRole("button", { name: DISABLE_ACTUAL_PLAN_BUTTON }),
            ).toBeVisible();
            await expect(page.getByRole("button", { name: ENABLE_ACTUAL_PLAN_BUTTON })).toHaveCount(
                0,
            );

            await page.getByRole("button", { name: DISABLE_ACTUAL_PLAN_BUTTON }).click();
            await expect(
                page.getByRole("button", { name: ENABLE_ACTUAL_PLAN_BUTTON }),
            ).toBeVisible();
            await expect(
                page.getByRole("button", { name: DISABLE_ACTUAL_PLAN_BUTTON }),
            ).toHaveCount(0);
        },
    );

    test(
        "an actual plan run returns each statement's plan alongside its results and plan XML",
        testCases(5878881),
        async () => {
            const { electronApp, page } = getContext();
            await openConnectedEditor(page);
            await page.getByRole("button", { name: ENABLE_ACTUAL_PLAN_BUTTON }).click();
            await expect(
                page.getByRole("button", { name: DISABLE_ACTUAL_PLAN_BUTTON }),
            ).toBeVisible();

            await setQueryText(
                electronApp,
                page,
                "select * from sys.objects; select * from sys.views;",
            );
            await executeQueryAndWait(page);
            await getResultsFrame(page);

            // Each statement returns its rows plus a showplan XML result set.
            await expect(resultTab("Results (4)")).toBeVisible({ timeout: 60 * 1000 });
            await resultTab("Query Plan (2)").click();
            await expect.poll(readQueryCosts, { timeout: 30 * 1000 }).toHaveLength(2);

            await resultTab("Results (4)").click();
            await resultsFrame.locator('[id="0_3"]').scrollIntoViewIfNeeded();
            for (const gridId of ["0_1", "0_3"]) {
                const xmlGrid = await waitForResultGrid(resultsFrame, gridId);
                await expect(
                    xmlGrid.getByRole("columnheader", { name: SHOWPLAN_XML_COLUMN }),
                ).toBeVisible();
            }

            await page.getByRole("button", { name: DISABLE_ACTUAL_PLAN_BUTTON }).click();
            await expect(
                page.getByRole("button", { name: ENABLE_ACTUAL_PLAN_BUTTON }),
            ).toBeVisible();
            await executeQueryAndWait(page);
            await expect(resultTab("Results (2)")).toBeVisible({ timeout: 60 * 1000 });
            await expect(resultTab("Messages")).toBeVisible();
            await expect(resultTab(/^Query Plan/)).toHaveCount(0);
        },
    );

    test(
        "an actual plan run only shows plans for statements that have one",
        testCases(5878881),
        async () => {
            const { electronApp, page } = getContext();
            await openConnectedEditor(page);
            await page.getByRole("button", { name: ENABLE_ACTUAL_PLAN_BUTTON }).click();
            await expect(
                page.getByRole("button", { name: DISABLE_ACTUAL_PLAN_BUTTON }),
            ).toBeVisible();

            await setQueryText(electronApp, page, "select 2");
            await executeQueryAndWait(page);
            await getResultsFrame(page);
            await expect(resultTab("Results (1)")).toBeVisible({ timeout: 60 * 1000 });
            await expect(resultTab("Messages")).toBeVisible();
            await expect(resultTab(/^Query Plan/)).toHaveCount(0);

            await setQueryText(electronApp, page, "select 2; select * from sys.objects; select 1;");
            await executeQueryAndWait(page);
            // Three result sets plus the showplan XML for the one statement that has a plan.
            await expect(resultTab("Results (4)")).toBeVisible({ timeout: 60 * 1000 });
            await resultTab("Query Plan (1)").click();
            await expect.poll(readQueryCosts, { timeout: 30 * 1000 }).toHaveLength(1);
            await expect(resultsFrame.getByText(/sys\.objects|sysschobjs/).first()).toBeVisible();
        },
    );
});
