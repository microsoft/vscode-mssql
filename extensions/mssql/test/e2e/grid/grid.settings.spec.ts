/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { FrameLocator, Locator } from "@playwright/test";
import { test, expect } from "../baseFixtures";
import { useSharedVsCodeLifecycle } from "../utils/testLifecycle";
import { openNewQueryEditor } from "../utils/testHelpers";
import { getGridLaunchConfig } from "./gridLaunchConfig";
import { clickMenuItem, openHeaderContextMenu, stageQuery } from "./gridActions";
import { SELECTION_QUERY, SELECTION_ROW_COUNT } from "./gridFixtures";

test.describe("MSSQL Extension - Preview Grid Settings", () => {
    let resultsFrame: FrameLocator;
    let grid: Locator;

    const getContext = useSharedVsCodeLifecycle({
        launchOptions: {
            initialConfig: getGridLaunchConfig({
                "mssql.resultsGrid.freezeFirstColumnByDefault": true,
                "mssql.resultsGrid.alternatingRowColors": true,
                "mssql.resultsGrid.showGridLines": "none",
                "mssql.resultsGrid.rowPadding": 3,
                "mssql.resultsFontFamily": "Courier New",
                "mssql.resultsFontSize": 16,
            }),
        },
        afterLaunch: async ({ electronApp, page }) => {
            const staged = await stageQuery(electronApp, page, SELECTION_QUERY, {
                minRows: SELECTION_ROW_COUNT,
            });
            resultsFrame = staged.resultsFrame;
            grid = staged.grid;
        },
    });

    test("appearance settings apply to the result container and row layout", async () => {
        const container = resultsFrame.locator('[id="0_0"]');
        await expect(container).toHaveClass(/results-grid--alternating/);
        await expect(container).toHaveClass(/results-grid--gridlines-none/);
        await expect(container).toHaveCSS("font-family", /Courier New/);
        await expect(container).toHaveCSS("font-size", "16px");
        await expect(container).toHaveCSS("--results-row-padding", "3px");
    });

    test("a saved unfreeze choice overrides freeze-first-column on editor return", async () => {
        const { page } = getContext();
        await expect(grid).toHaveAttribute("data-frozen-index", "1");
        await openHeaderContextMenu(grid, "id");
        await clickMenuItem(resultsFrame, "Unfreeze columns");
        await expect(grid).toHaveAttribute("data-frozen-index", "0");

        await openNewQueryEditor(page);
        await page
            .getByRole("tab", { name: /Untitled-1/ })
            .first()
            .click();
        await expect(grid).toHaveAttribute("data-frozen-index", "0");
    });
});
