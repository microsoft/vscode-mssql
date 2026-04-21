/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import {
    getProfilerColumnDefaultWidth,
    getProfilerColumnWidth,
    PROFILER_HEADER_BUTTONS_WIDTH_PX,
    PROFILER_HEADER_EXTRA_WIDTH_PX,
    PROFILER_HEADER_TEXT_PADDING_PX,
} from "../../../src/webviews/pages/Profiler/profilerGridWidthUtils";

suite("ProfilerGridWidthUtils Tests", () => {
    test("calculates a default width that includes header text and both header buttons", () => {
        const measuredTextWidth = 72;

        const defaultWidth = getProfilerColumnDefaultWidth("ApplicationName", {
            measureText: () => measuredTextWidth,
        });

        expect(defaultWidth).to.equal(
            Math.ceil(
                measuredTextWidth +
                    PROFILER_HEADER_TEXT_PADDING_PX +
                    PROFILER_HEADER_BUTTONS_WIDTH_PX +
                    PROFILER_HEADER_EXTRA_WIDTH_PX,
            ),
        );
    });

    test("uses the calculated minimum when the configured width is too small", () => {
        const measuredTextWidth = 96;

        const width = getProfilerColumnWidth("ApplicationName", 80, {
            measureText: () => measuredTextWidth,
        });

        expect(width).to.equal(
            Math.ceil(
                measuredTextWidth +
                    PROFILER_HEADER_TEXT_PADDING_PX +
                    PROFILER_HEADER_BUTTONS_WIDTH_PX +
                    PROFILER_HEADER_EXTRA_WIDTH_PX,
            ),
        );
    });

    test("preserves larger configured widths", () => {
        const width = getProfilerColumnWidth("EventClass", 180, {
            measureText: () => 60,
        });

        expect(width).to.equal(180);
    });

    test("omits header button space for columns without header buttons", () => {
        const measuredTextWidth = 48;

        const defaultWidth = getProfilerColumnDefaultWidth("CPU", {
            hasHeaderButtons: false,
            measureText: () => measuredTextWidth,
        });

        expect(defaultWidth).to.equal(
            Math.ceil(
                measuredTextWidth +
                    PROFILER_HEADER_TEXT_PADDING_PX +
                    PROFILER_HEADER_EXTRA_WIDTH_PX,
            ),
        );
    });
});
