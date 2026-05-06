/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import { ColorThemeKind } from "../../../src/sharedInterfaces/webview";
import {
    buildProfilerDetailsGridRows,
    getProfilerDetailsGridColumns,
    getProfilerDetailsGridOptions,
    PROFILER_DETAILS_GRID_CONTAINER_ID,
} from "../../../src/webviews/pages/Profiler/profilerDetailsGridConfig";

suite("ProfilerDetailsGridConfig Tests", () => {
    test("builds SlickGrid rows from profiler properties", () => {
        const rows = buildProfilerDetailsGridRows([
            { label: "EventClass", value: "RPC:Completed" },
            { label: "Duration", value: "42" },
        ]);

        expect(rows).to.deep.equal([
            { id: 0, label: "EventClass", value: "RPC:Completed" },
            { id: 1, label: "Duration", value: "42" },
        ]);
    });

    test("creates the expected property and value columns", () => {
        const columns = getProfilerDetailsGridColumns("Property", "Value");

        expect(columns).to.have.length(2);
        expect(columns[0]).to.include({
            id: "label",
            name: "Property",
            field: "label",
            cssClass: "profiler-details-label-cell",
        });
        expect(columns[1]).to.include({
            id: "value",
            name: "Value",
            field: "value",
            cssClass: "profiler-details-value-cell",
        });
    });

    test("enables cell range selection and copy behavior for the details grid", () => {
        const options = getProfilerDetailsGridOptions(ColorThemeKind.Dark);

        expect(options.enableSorting).to.equal(false);
        expect(options.enableFiltering).to.equal(false);
        expect(options.enablePagination).to.equal(false);
        expect(options.enableColumnPicker).to.equal(false);
        expect(options.enableGridMenu).to.equal(false);
        expect(options.enableHeaderMenu).to.equal(false);
        expect(options.enableAutoTooltip).to.equal(true);
        expect(options.showHeaderRow).to.equal(false);
        expect(options.rowHeight).to.equal(25);
        expect(options.enableColumnReorder).to.equal(false);
        expect(options.selectionOptions?.selectionType).to.equal("cell");
        expect(options.showColumnHeader).to.equal(false);
        expect(options.forceFitColumns).to.equal(true);
        expect(options.headerRowHeight).to.equal(0);
        expect(options.autoResize?.container).to.equal(`#${PROFILER_DETAILS_GRID_CONTAINER_ID}`);
        expect(options.autoResize?.calculateAvailableSizeBy).to.equal("container");
        expect(options.autoResize?.resizeDetection).to.equal("container");
        expect(options.darkMode).to.equal(true);
    });

    test("does not enable dark mode styling for light themes", () => {
        const options = getProfilerDetailsGridOptions(ColorThemeKind.Light);

        expect(options.darkMode).to.equal(false);
    });
});
