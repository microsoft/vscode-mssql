/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Locator } from "@playwright/test";
import { promises as fs } from "fs";
import * as path from "path";
import { test, expect } from "../baseFixtures";
import { useSharedVsCodeLifecycle } from "../utils/testLifecycle";
import {
    executeQueryAndWait,
    openNewQueryEditor,
    setQueryText,
    waitForResultGrid,
} from "../utils/testHelpers";
import { connectActiveEditor, getCell, getResultsFrame } from "./gridActions";
import { MIXED_TYPES_QUERY, MIXED_TYPES_ROW_COUNT } from "./gridFixtures";
import { getGridLaunchConfig } from "./gridLaunchConfig";

for (const preview of [true, false]) {
    test.describe(`MSSQL Extension - ${preview ? "Preview" : "Classic"} Grid Numeric Alignment`, () => {
        let grid: Locator;
        const cssProperty = preview ? "justify-content" : "text-align";
        const rightAlignment = preview ? "flex-end" : "right";

        const getContext = useSharedVsCodeLifecycle({
            launchOptions: {
                initialConfig: getGridLaunchConfig({ "mssql.preview.betaResultsGrid": preview }),
            },
            afterLaunch: async ({ electronApp, page }) => {
                await openNewQueryEditor(page);
                await connectActiveEditor(page);
                await setQueryText(electronApp, page, MIXED_TYPES_QUERY);
                await executeQueryAndWait(page);
                const frame = await getResultsFrame(page);
                grid = preview
                    ? await waitForResultGrid(frame, "0_0", MIXED_TYPES_ROW_COUNT)
                    : frame.locator('[id="gridContainter-0_0"]');
                await expect(getCell(grid, 4, 0)).toHaveText("5");
            },
        });

        async function setRightAlignNumbers(enabled: boolean): Promise<void> {
            // Edit only this isolated test instance's settings, exercising VS Code's normal
            // configuration notification and the existing results' live update.
            const settingsPath = path.join(getContext().userDataDir, "User", "settings.json");
            const settings = JSON.parse(await fs.readFile(settingsPath, "utf8"));
            settings["mssql.resultsGrid.rightAlignNumbers"] = enabled;
            await fs.writeFile(settingsPath, JSON.stringify(settings));
        }

        test("numeric cells remain left-aligned by default", async () => {
            await expect(getCell(grid, 0, 0)).not.toHaveCSS(cssProperty, rightAlignment);
            await expect(getCell(grid, 0, 3)).not.toHaveCSS(cssProperty, rightAlignment);
        });

        test("changing the setting aligns numeric cells without moving text values", async () => {
            try {
                await setRightAlignNumbers(true);
                await expect(getCell(grid, 0, 0)).toHaveCSS(cssProperty, rightAlignment);
                await expect(getCell(grid, 0, 3)).toHaveCSS(cssProperty, rightAlignment);
                // A NULL in a decimal column still follows the column's numeric alignment.
                await expect(getCell(grid, 3, 3)).toHaveCSS(cssProperty, rightAlignment);
                await expect(getCell(grid, 0, 1)).not.toHaveCSS(cssProperty, rightAlignment);
                await expect(getCell(grid, 0, 2)).not.toHaveCSS(cssProperty, rightAlignment);
                await expect(getCell(grid, 0, 3)).toContainText("12.50");
            } finally {
                await setRightAlignNumbers(false);
            }
            await expect(getCell(grid, 0, 0)).not.toHaveCSS(cssProperty, rightAlignment);
            await expect(getCell(grid, 0, 3)).not.toHaveCSS(cssProperty, rightAlignment);
        });
    });
}
