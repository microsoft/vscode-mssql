/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import { locConstants as loc } from "../../../src/webviews/common/locConstants";
import {
    dateTimeFormat,
    timeFormat,
} from "../../../src/webviews/pages/PerformanceDashboard/performanceDashboardFormat";
import { centeredSeriesPoints } from "../../../src/webviews/pages/PerformanceDashboard/performanceDashboardSeries";

suite("Performance dashboard series", () => {
    test("moves each point to the middle of its bucket and names the bucket", () => {
        const start = Date.UTC(2026, 9, 30, 9);
        const hourMs = 60 * 60_000;

        const points = centeredSeriesPoints(
            [
                { x: new Date(start), y: 4 },
                { x: new Date(start + hourMs), y: 0 },
            ],
            60,
        );

        expect(points.map((point) => point.x.getTime())).to.deep.equal([
            start + hourMs / 2,
            start + hourMs * 1.5,
        ]);
        expect(points.map((point) => point.y)).to.deep.equal([4, 0]);
        expect(points[0].xLabel).to.equal(
            loc.performanceDashboard.timeIntervalRange(
                dateTimeFormat.format(new Date(start)),
                timeFormat.format(new Date(start + hourMs)),
            ),
        );
    });
});
