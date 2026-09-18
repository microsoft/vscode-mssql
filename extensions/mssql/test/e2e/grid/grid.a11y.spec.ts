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

    const getContext = useSharedVsCodeLifecycle({
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

    test("rows and cells expose their values to the accessibility tree", async () => {
        const row = grid.getByRole("row", { name: /1 10 100 1000/ }).first();
        await expect(row).toBeVisible();
        await expect(row.getByRole("gridcell", { name: "10", exact: true })).toBeVisible();
        await expect(row.getByRole("gridcell", { name: "100", exact: true })).toBeVisible();
    });

    test("Tab enters the grid and reaches its toolbar; Shift+Tab returns", async () => {
        const { page } = getContext();
        const focusIsWithinGrid = () =>
            grid.evaluate((element) => element.contains(element.ownerDocument.activeElement));
        await getCell(grid, 0, 0).click();
        await page.keyboard.press("Tab");
        const toolbar = grid.locator('[data-fluent-result-grid-toolbar="true"]');
        await expect(toolbar.locator("button:focus")).toHaveCount(1);
        await page.keyboard.press("Shift+Tab");
        await expect(toolbar.locator("button:focus")).toHaveCount(0);
        await expect.poll(focusIsWithinGrid).toBe(true);
        await expect(getCell(grid, 0, 0)).toHaveClass(/active/);
        await page.keyboard.press("Shift+Tab");
        await expect.poll(focusIsWithinGrid).toBe(false);
        await page.keyboard.press("Tab");
        await expect.poll(focusIsWithinGrid).toBe(true);
    });

    test("the active keyboard cell uses the VS Code focus border", async () => {
        const { page } = getContext();
        await getCell(grid, 0, 0).click();
        await page.keyboard.press("ArrowDown");
        const activeCell = getCell(grid, 1, 0);
        await expect(activeCell).toHaveClass(/active/);
        await expect(grid).toHaveClass(/focused/);

        const matchesFocusBorder = await activeCell.evaluate((cell) => {
            const probe = cell.ownerDocument.createElement("span");
            probe.style.color = "var(--vscode-focusBorder)";
            cell.appendChild(probe);
            const focusColor = getComputedStyle(probe).color;
            probe.remove();
            return getComputedStyle(cell).outlineColor === focusColor;
        });
        expect(matchesFocusBorder).toBe(true);
    });

    test("the summary footer is a polite status after execution", async () => {
        const footer = resultsFrame.getByTestId("summary-footer");
        await expect(footer).toHaveAttribute("role", "status");
        await expect(footer).toHaveAttribute("aria-live", "polite");
    });
});
