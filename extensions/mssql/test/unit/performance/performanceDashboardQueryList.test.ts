/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import type { RegressedQuery } from "../../../src/sharedInterfaces/performanceDashboard";
import {
    filterQueryRows,
    availableQueryCategories,
    queryCategories,
    queryCategoryRanking,
    regressedQueryRows,
    toQueryCategory,
} from "../../../src/webviews/pages/PerformanceDashboard/performanceDashboardQueryList";

function regressed(queryId: string, addedImpact: number): RegressedQuery {
    return {
        queryId,
        queryText: `SELECT ${queryId}`,
        readsOnlySystemCatalog: false,
        recentExecutionCount: 10,
        baselineExecutionCount: 40,
        recentAverage: 800,
        baselineAverage: 200,
        addedImpact,
        changePercent: 300,
        newPlanCount: 1,
    };
}

suite("performance dashboard query list", () => {
    test("offers the regressed queries as the last category, which ranks nothing", () => {
        expect(queryCategories[queryCategories.length - 1]).to.equal("regressed");
        expect(toQueryCategory("regressed", queryCategories)).to.equal("regressed");
        expect(queryCategoryRanking).to.not.have.property("regressed");
    });

    test("offers the regressed queries only with their setting", () => {
        expect(availableQueryCategories(true)).to.deep.equal(queryCategories);

        const categories = availableQueryCategories(false);
        expect(categories).to.not.include("regressed");
        // A location or a saved category from when the setting was on does not apply.
        expect(toQueryCategory("regressed", categories)).to.equal(undefined);
        expect(toQueryCategory("cpu", categories)).to.equal("cpu");
    });

    test("compares the added impact of each regressed query with the first", () => {
        const rows = regressedQueryRows([regressed("1", 6000), regressed("2", 1500)]);

        expect(rows.map((row) => row.share)).to.deep.equal([100, 25]);
        expect(rows[0]).to.include({
            queryId: "1",
            value: 6000,
            executions: 10,
            recentAverage: 800,
            baselineAverage: 200,
            changePercent: 300,
            newPlanCount: 1,
        });
    });

    test("has no regressed rows without a read", () => {
        expect(regressedQueryRows(undefined)).to.deep.equal([]);
    });

    test("leaves out a percent change that the baseline cannot give", () => {
        const withoutChange = { ...regressed("1", 6000), changePercent: undefined };

        expect(regressedQueryRows([withoutChange])[0]).to.not.have.property("changePercent");
    });

    test("filters rows by the query ID, the text, and the favorites", () => {
        const rows = regressedQueryRows([regressed("12", 6000), regressed("3", 1500)]);
        const ids = (filtered: readonly { queryId: string }[]) =>
            filtered.map((row) => row.queryId);

        expect(ids(filterQueryRows(rows, ""))).to.deep.equal(["12", "3"]);
        expect(ids(filterQueryRows(rows, " 12 "))).to.deep.equal(["12"]);
        expect(ids(filterQueryRows(rows, "select 3"))).to.deep.equal(["3"]);
        expect(ids(filterQueryRows(rows, "", new Set(["3"])))).to.deep.equal(["3"]);
        expect(ids(filterQueryRows(rows, "12", new Set(["3"])))).to.deep.equal([]);
    });
});
