/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import type { IDbColumn, DbCellValue } from "../../../src/sharedInterfaces/queryResult";
import {
    computeColumnWidths,
    HEADER_EXTRA_WIDTH,
    HEADER_TEXT_PADDING,
    CELL_PADDING,
    MIN_COLUMN_WIDTH,
    MAX_COLUMN_WIDTH,
} from "../../../src/webviews/pages/NotebookRenderer/notebookGridWidthUtils";
import { FilterButtonWidth } from "../../../src/webviews/pages/NotebookRenderer/notebookHeaderMenu.plugin";

function makeDbColumn(columnName: string): IDbColumn {
    return {
        columnName,
    } as IDbColumn;
}

function makeCell(displayValue: string, isNull = false): DbCellValue {
    return {
        displayValue,
        isNull,
    } as DbCellValue;
}

suite("NotebookResultGrid column sizing", () => {
    const dummyFont = "12px monospace";
    // Predictable measurement mock: 8px per character
    const charWidth = 8;
    const mockMeasureText = (text: string) => text.length * charWidth;

    // Explicit CSS layout dimensions for a SlickGrid notebook header:
    // 1. SlickGrid header cell padding: 4px left + 4px right = 8px (slickgrid.css: .slick-header-column)
    // 2. Right border: 1px (slickgrid.css: border-right: 1px solid silver)
    // 3. Sort indicator: 8px width + 4px margin-left = 12px (slickgrid.css: .slick-sort-indicator)
    // 4. Sort button: 16px width + 2px left margin + 2px right margin = 20px (table.css: .slick-header-sortbutton)
    // 5. Filter button: 16px width + 4px left margin = 20px (table.css: .slick-header-filterbutton)
    // 6. Subpixel/rounding buffer: 1px
    const EXPLICIT_SORT_BUTTON_WIDTH = 16 + 2 + 2; // 20px
    const EXPLICIT_FILTER_BUTTON_WIDTH = 16 + 4; // 20px
    const EXPLICIT_BUTTONS_TOTAL_WIDTH = EXPLICIT_SORT_BUTTON_WIDTH + EXPLICIT_FILTER_BUTTON_WIDTH; // 40px
    const EXPLICIT_HEADER_CHROME_PADDING = 8 + 1 + 12 + 1; // 22px
    const EXPLICIT_REQUIRED_HEADER_OVERHEAD =
        EXPLICIT_HEADER_CHROME_PADDING + EXPLICIT_BUTTONS_TOTAL_WIDTH; // 62px

    test("FilterButtonWidth accounts for sort button margins and filter button margins", () => {
        // Sort button: 16px width + 2px left margin + 2px right margin = 20px
        // Filter button: 16px width + 4px left margin = 20px
        expect(FilterButtonWidth).to.equal(EXPLICIT_BUTTONS_TOTAL_WIDTH);
    });

    test("HEADER_EXTRA_WIDTH accounts for cell padding, border, sort indicator, and buttons", () => {
        // 8px padding (4px each side) + 1px border + 12px sort indicator + 1px rounding = 22px
        expect(HEADER_TEXT_PADDING).to.equal(EXPLICIT_HEADER_CHROME_PADDING);
        // 22px + 40px buttons = 62px
        expect(HEADER_EXTRA_WIDTH).to.equal(EXPLICIT_REQUIRED_HEADER_OVERHEAD);
    });

    test("sizes column wide enough to avoid header truncation when header is wider than data (issue #23102)", () => {
        // "long header" is 11 chars => 88px measured text width
        // Data "test" is 4 chars => 32px measured text width
        const columns = [makeDbColumn("long header")];
        const rows = [[makeCell("test")]];

        const [width] = computeColumnWidths(columns, rows, dummyFont, mockMeasureText);

        const headerTextWidth = mockMeasureText("long header");
        const expectedHeaderWidth = headerTextWidth + EXPLICIT_REQUIRED_HEADER_OVERHEAD; // 88 + 62 = 150
        expect(width).to.equal(expectedHeaderWidth);
        // Verify it includes sufficient room for both icons, sort indicator, and padding (at least 62px)
        expect(width - headerTextWidth).to.be.at.least(EXPLICIT_REQUIRED_HEADER_OVERHEAD);
    });

    test("regression demonstration: original sizing formula produces deficit and truncates header", () => {
        // The original implementation used: padding = 20 + 38 = 58px for both headers and data
        const originalFilterButtonWidth = 38;
        const originalPadding = 20 + originalFilterButtonWidth; // 58px
        const headerTextWidth = mockMeasureText("long header"); // 88px
        const originalCalculatedWidth = headerTextWidth + originalPadding; // 146px

        // In the rendered layout, 62px of overhead is required.
        // With the original width (146px), the available space for text was only 146 - 62 = 84px < 88px,
        // leaving a 4px deficit that triggered text-overflow: ellipsis truncation.
        const originalDeficit = EXPLICIT_REQUIRED_HEADER_OVERHEAD - originalPadding;
        expect(originalDeficit).to.equal(4);
        expect(originalCalculatedWidth - headerTextWidth).to.be.lessThan(
            EXPLICIT_REQUIRED_HEADER_OVERHEAD,
        );

        // The fix computes 150px, ensuring no deficit:
        const columns = [makeDbColumn("long header")];
        const rows = [[makeCell("test")]];
        const [fixedWidth] = computeColumnWidths(columns, rows, dummyFont, mockMeasureText);
        expect(fixedWidth - headerTextWidth).to.be.at.least(EXPLICIT_REQUIRED_HEADER_OVERHEAD);
    });

    test("preserves cell-content sizing when data is wider than header", () => {
        // "short header" is 12 chars => 96px measured text width (96 + 62 = 158)
        // Data "test test123456789" is 18 chars => 144px measured text width (144 + 60 = 204)
        const columns = [makeDbColumn("short header")];
        const rows = [[makeCell("test test123456789")]];

        const [width] = computeColumnWidths(columns, rows, dummyFont, mockMeasureText);

        const expectedDataWidth = mockMeasureText("test test123456789") + CELL_PADDING; // 144 + 60 = 204
        expect(width).to.equal(expectedDataWidth);
    });

    test("clamps column width to MIN_COLUMN_WIDTH when content is very short", () => {
        const columns = [makeDbColumn("id")];
        const rows = [[makeCell("1")]];

        // "id" is 2 chars => 16px text + 62px = 78px < MIN_COLUMN_WIDTH (80)
        const [width] = computeColumnWidths(columns, rows, dummyFont, mockMeasureText);
        expect(width).to.equal(MIN_COLUMN_WIDTH);
    });

    test("clamps column width to MAX_COLUMN_WIDTH when content is very long", () => {
        const columns = [makeDbColumn("A".repeat(60))]; // 480px text + 62 = 542 > 400
        const rows = [[makeCell("test")]];

        const [width] = computeColumnWidths(columns, rows, dummyFont, mockMeasureText);
        expect(width).to.equal(MAX_COLUMN_WIDTH);
    });

    test("handles empty rows by sizing based on header", () => {
        const columns = [makeDbColumn("ColumnName")]; // 10 chars => 80px + 62 = 142
        const rows: DbCellValue[][] = [];

        const [width] = computeColumnWidths(columns, rows, dummyFont, mockMeasureText);
        expect(width).to.equal(80 + HEADER_EXTRA_WIDTH);
    });

    test("treats null cells as 'NULL' for data width calculation", () => {
        const columns = [makeDbColumn("c")]; // 1 char => 8px + 62 = 70 < MIN_COLUMN_WIDTH
        const rows = [[makeCell("", true)]]; // isNull: true -> "NULL" (4 chars = 32px + 60 = 92)

        const [width] = computeColumnWidths(columns, rows, dummyFont, mockMeasureText);
        const expectedNullDataWidth = mockMeasureText("NULL") + CELL_PADDING;
        expect(width).to.equal(expectedNullDataWidth);
    });

    test("truncates sampled data cells longer than 250 characters", () => {
        const columns = [makeDbColumn("c")];
        const longText = "x".repeat(300);
        const rows = [[makeCell(longText)]];

        let sampledText = "";
        const customMeasure = (text: string) => {
            if (text !== "c") {
                sampledText = text;
            }
            return text.length * charWidth;
        };

        computeColumnWidths(columns, rows, dummyFont, customMeasure);
        expect(sampledText.length).to.equal(253); // 250 chars + "..."
        expect(sampledText.endsWith("...")).to.be.true;
    });
});
