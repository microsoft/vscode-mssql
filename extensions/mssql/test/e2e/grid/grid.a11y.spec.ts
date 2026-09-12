/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { FrameLocator, Locator } from "@playwright/test";
import { test, expect } from "../baseFixtures";
import { useSharedVsCodeLifecycle } from "../utils/testLifecycle";
import { getGridLaunchConfig } from "./gridLaunchConfig";
import { getCell, stageQuery } from "./gridActions";
import { SELECTION_QUERY, SELECTION_ROW_COUNT } from "./gridFixtures";

test.describe("MSSQL Extension - Preview Grid Accessibility", () => {
    let resultsFrame: FrameLocator;
    let grid: Locator;

    useSharedVsCodeLifecycle({
        launchOptions: { initialConfig: getGridLaunchConfig() },
        afterLaunch: async ({ electronApp, page }) => {
            const staged = await stageQuery(electronApp, page, SELECTION_QUERY, {
                minRows: SELECTION_ROW_COUNT,
            });
            resultsFrame = staged.resultsFrame;
            grid = staged.grid;
        },
    });

    test("the result set is a named region", async () => {
        await expect(grid).toHaveAttribute("role", "region");
        await expect(grid).toHaveAttribute("aria-label", /.+/);
        await expect(grid).toHaveAttribute("tabindex", "0");
    });

    test("data cells expose gridcell semantics", async () => {
        await expect(getCell(grid, 0, 0)).toHaveAttribute("role", "gridcell");
        await expect(getCell(grid, 0, 0)).toHaveText("1");
        await expect(getCell(grid, 0, 1)).toHaveAttribute("role", "gridcell");
    });

    test("the summary footer is a polite status after execution", async () => {
        const footer = resultsFrame.getByTestId("summary-footer");
        await expect(footer).toHaveAttribute("role", "status");
        await expect(footer).toHaveAttribute("aria-live", "polite");
    });
});
