/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from "node:assert/strict";
import { test } from "node:test";
import {
    inspectQueryStorePlanXml,
    queryStoreInvestigationContext,
    queryStoreReferenceSql,
} from "../../src/diagnostics/querystore/context";

void test("Query Store comparison context freezes one UTC reference and non-overlapping windows", () => {
    const context = queryStoreInvestigationContext(
        "qds.regressedQueries",
        { recentHours: 2, baselineHours: 4, referenceAt: "2026-09-07T12:00:00Z", minExecutions: 7 },
        "2026-09-07T13:00:00Z",
    );
    assert.equal(context.window.referenceAt, "2026-09-07T12:00:00.000Z");
    assert.equal(context.window.baselineEnd, "2026-09-07T10:00:00.000Z");
    assert.equal(context.window.baselineStart, "2026-09-07T06:00:00.000Z");
    assert.equal(context.minimumExecutions, 7);
    assert.match(
        queryStoreReferenceSql({ referenceAt: "2026-09-07T12:00:00Z" }),
        /2026-09-07T12:00:00\.000Z/,
    );
});

void test("Query Store context accepts explicit windows and rejects overlap", () => {
    const context = queryStoreInvestigationContext(
        "qds.regressedQueries",
        {
            referenceAt: "2026-09-07T12:00:00Z",
            startAt: "2026-09-07T10:00:00Z",
            endAt: "2026-09-07T12:00:00Z",
            baselineStartAt: "2026-09-07T06:00:00Z",
            baselineEndAt: "2026-09-07T10:00:00Z",
        },
        "2026-09-07T13:00:00Z",
    );
    assert.equal(context.window.start, "2026-09-07T06:00:00.000Z");
    assert.equal(context.window.end, "2026-09-07T12:00:00.000Z");
    assert.equal(context.window.includesCurrentInterval, true);
    assert.throws(() =>
        queryStoreInvestigationContext(
            "qds.regressedQueries",
            {
                referenceAt: "2026-09-07T12:00:00Z",
                startAt: "2026-09-07T10:00:00Z",
                endAt: "2026-09-07T12:00:00Z",
                baselineStartAt: "2026-09-07T09:00:00Z",
                baselineEndAt: "2026-09-07T11:00:00Z",
            },
            "2026-09-07T13:00:00Z",
        ),
    );
});

void test("Query Store history and all-query contexts retain a bounded default cap", () => {
    assert.equal(
        queryStoreInvestigationContext("qds.workloadHistory", undefined, "2026-09-07T12:00:00Z")
            .rowLimit,
        1000,
    );
    assert.equal(
        queryStoreInvestigationContext("qds.allQueries", undefined, "2026-09-07T12:00:00Z")
            .rowLimit,
        1000,
    );
    assert.equal(
        queryStoreInvestigationContext(
            "qds.topResourceConsumers",
            undefined,
            "2026-09-07T12:00:00Z",
        ).rowLimit,
        50,
    );
});

void test("plan inspection rejects missing, clipped, and incomplete XML", () => {
    assert.equal(inspectQueryStorePlanXml(undefined).reason, "missing");
    assert.equal(inspectQueryStorePlanXml("<ShowPlanXML>", false).reason, "incomplete");
    assert.equal(inspectQueryStorePlanXml("<ShowPlanXML></ShowPlanXML>", true).reason, "truncated");
    assert.equal(inspectQueryStorePlanXml("<Other></Other>").reason, "invalidRoot");
    assert.equal(inspectQueryStorePlanXml("<ShowPlanXML></ShowPlanXML>").complete, true);
});
