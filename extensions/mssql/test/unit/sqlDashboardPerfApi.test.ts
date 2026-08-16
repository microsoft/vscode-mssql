/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import { parseDashboardPerfArgs } from "../../src/dashboard/dashboardPerfApi";

suite("SQL Dashboard performance API", () => {
    test("maps allowlisted aliases to deterministic routes", () => {
        expect(
            parseDashboardPerfArgs(
                { scenario: "queryVolume5000", route: "performance" },
                "FixtureDb",
            ),
        ).to.deep.equal({
            scenario: "queryVolume5000",
            route: { kind: "databasePerformance", database: "FixtureDb" },
        });
        expect(
            parseDashboardPerfArgs({ route: "query-regressed" }, "FixtureDb").route,
        ).to.deep.equal({ kind: "queryDetail", database: "FixtureDb", queryId: "42" });
    });

    test("rejects arbitrary scenario and route input", () => {
        expect(() => parseDashboardPerfArgs({ scenario: "../../secret" }, "FixtureDb")).to.throw(
            TypeError,
        );
        expect(() => parseDashboardPerfArgs({ route: "query-1234" }, "FixtureDb")).to.throw(
            TypeError,
        );
        expect(() => parseDashboardPerfArgs("performance", "FixtureDb")).to.throw(TypeError);
    });
});
