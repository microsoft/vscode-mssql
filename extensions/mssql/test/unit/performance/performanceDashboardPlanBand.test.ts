/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import type { QueryStoreInterval } from "../../../src/sharedInterfaces/performanceDashboard";
import { locConstants as loc } from "../../../src/webviews/common/locConstants";
import {
    historyRows,
    planBand,
    planIdsOf,
} from "../../../src/webviews/pages/PerformanceDashboard/performanceDashboardPlanBand";

/** An hour of the history from 9:00 UTC, with the executions of each plan that ran. */
function hour(index: number, executions: Record<string, number>): QueryStoreInterval {
    const start = Date.UTC(2026, 9, 30, 9 + index);
    return {
        startUtc: new Date(start).toISOString(),
        endUtc: new Date(start + 60 * 60_000).toISOString(),
        executionCount: Object.values(executions).reduce((sum, count) => sum + count, 0),
        metrics: {},
        plans: Object.entries(executions).map(([planId, executionCount]) => ({
            planId,
            executionCount,
            metrics: {},
        })),
    };
}

const colorOf = (planId: string) => `color-${planId}`;

suite("Performance dashboard plan band", () => {
    test("orders an interval's plans by executions", () => {
        const rows = historyRows([
            hour(0, { "12": 30, "15": 2 }),
            hour(1, {}),
            hour(2, { "12": 5, "15": 40 }),
            hour(3, { "15": 9 }),
        ]);

        expect(rows.map((row) => row.plans.map((plan) => plan.planId))).to.deep.equal([
            ["12", "15"],
            [],
            ["15", "12"],
            ["15"],
        ]);
    });

    test("leaves out plans without executions and breaks ties by plan ID", () => {
        const [row] = historyRows([hour(0, { "20": 4, "7": 4, "9": 0 })]);

        expect(row.plans.map((plan) => plan.planId)).to.deep.equal(["7", "20"]);
    });

    test("joins the next hours of the same main plan into one segment", () => {
        const rows = historyRows([
            hour(0, { "12": 30 }),
            hour(1, { "12": 10, "15": 1 }),
            hour(2, { "15": 40 }),
            hour(4, { "15": 3 }),
        ]);

        const band = planBand(rows, ["12", "15"], colorOf);

        expect(
            band?.segments.map((segment) => [
                segment.start.toISOString(),
                segment.end.toISOString(),
                segment.color,
            ]),
        ).to.deep.equal([
            ["2026-10-30T09:00:00.000Z", "2026-10-30T11:00:00.000Z", "color-12"],
            ["2026-10-30T11:00:00.000Z", "2026-10-30T12:00:00.000Z", "color-15"],
            // An hour without runs is a gap, so plan 15 starts again after it.
            ["2026-10-30T13:00:00.000Z", "2026-10-30T14:00:00.000Z", "color-15"],
        ]);
        expect(band?.legend).to.deep.equal([
            { label: loc.performanceDashboard.planLegend("12"), color: "color-12" },
            { label: loc.performanceDashboard.planLegend("15"), color: "color-15" },
        ]);
    });

    test("shows only the plans that ran most in the legend, in plan ID order", () => {
        const rows = historyRows([hour(0, { "15": 3, "12": 1 }), hour(1, { "9": 8 })]);

        const band = planBand(rows, ["9", "12", "15"], colorOf);

        expect(band?.legend.map((item) => item.color)).to.deep.equal(["color-9", "color-15"]);
    });

    test("has no band when the query did not run", () => {
        expect(planBand(historyRows([hour(0, {})]), [], colorOf)).to.be.undefined;
    });

    test("lists the plans of the history by plan ID", () => {
        expect(planIdsOf([hour(0, { "15": 1, "9": 1 }), hour(1, { "100": 1 })])).to.deep.equal([
            "9",
            "15",
            "100",
        ]);
    });
});
