/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Widget -> boundary-output translation for the Hobbes lane. The fixture
 * shapes are captured LIVE from runtime 0.1.0 investigation-snapshot
 * envelopes (table / text / assessment-strip); unknown widget types skip
 * honestly rather than fabricating a rendering.
 */

import { expect } from "chai";
import {
    executedQueriesFromSnapshot,
    translateWidgetToOutput,
} from "../../src/runbookStudio/runtime/hobbesRuntimeAdapter";

suite("hobbesWidgetOutputs", () => {
    test("table widgets become rowset/1 with schema-ordered cells", () => {
        const output = translateWidgetToOutput({
            id: "w1",
            typeId: "table",
            nodeId: "guid-1",
            title: "List sessions",
            dataSource: {
                type: "static",
                data: {
                    schema: [{ name: "session_id" }, { name: "login_name" }],
                    rows: [
                        { session_id: "54", login_name: "NT AUTHORITY\\NETWORK SERVICE" },
                        // Sparse row: missing cells surface as NULL, never shift.
                        { login_name: "REDMOND\\karlb" },
                    ],
                },
            },
        });
        expect(output).to.deep.equal({
            contract: "rowset/1",
            columns: ["session_id", "login_name"],
            rows: [
                ["54", "NT AUTHORITY\\NETWORK SERVICE"],
                [null, "REDMOND\\karlb"],
            ],
        });
    });

    test("text widgets (threshold narrative) become markdown/1", () => {
        const output = translateWidgetToOutput({
            id: "w2",
            typeId: "text",
            dataSource: { data: { text: "**5 <= 100** → branched **pass** (passed)." } },
        });
        expect(output?.contract).to.equal("markdown/1");
        expect(output?.text).to.contain("5 <= 100");
    });

    test("assessment-strip widgets become markdown/1 from the summary", () => {
        const output = translateWidgetToOutput({
            id: "w3",
            typeId: "assessment-strip",
            dataSource: {
                data: { headline: "Assessment", summary: "Observed **5** <= threshold **100**." },
            },
        });
        expect(output?.contract).to.equal("markdown/1");
        expect(output?.text).to.contain("threshold");
    });

    test("chart-typed widgets translate like tables (same schema+rows shape)", () => {
        // Verified live: the runtime emits line-chart widgets for time+measure
        // rowsets; the data shape is identical to table widgets.
        const output = translateWidgetToOutput({
            id: "w-chart",
            typeId: "line-chart",
            dataSource: {
                data: {
                    schema: [{ name: "creation_time" }, { name: "total_elapsed_ms" }],
                    rows: [{ creation_time: "2026-07-18T17:45:04", total_elapsed_ms: "3" }],
                },
            },
        });
        expect(output?.contract).to.equal("rowset/1");
        expect(output?.columns).to.deep.equal(["creation_time", "total_elapsed_ms"]);
        expect(output?.rows?.[0]).to.deep.equal(["2026-07-18T17:45:04", "3"]);
    });

    test("unknown widget types and empty payloads skip honestly", () => {
        expect(
            translateWidgetToOutput({ id: "w4", typeId: "finding-card", dataSource: { data: {} } }),
        ).to.equal(undefined);
        expect(translateWidgetToOutput({ id: "w5", typeId: "table" })).to.equal(undefined);
        expect(
            translateWidgetToOutput({
                id: "w6",
                typeId: "table",
                dataSource: { data: { schema: [], rows: [] } },
            }),
        ).to.equal(undefined);
    });

    test("projects exact runtime-executed SQL only for known regions", () => {
        expect(
            executedQueriesFromSnapshot(
                {
                    runtime: {
                        workflowExecutionView: {
                            regions: [
                                {
                                    id: "collect",
                                    regionReport: {
                                        executedQueryText: "SELECT actual FROM dbo.t;",
                                    },
                                },
                                {
                                    id: "unknown",
                                    regionReport: { executedQueryText: "SELECT ignored;" },
                                },
                            ],
                        },
                    },
                },
                new Set(["collect"]),
            ),
        ).to.deep.equal([{ regionId: "collect", queryText: "SELECT actual FROM dbo.t;" }]);
    });

    test("accepts the canonical report cache without falling back to authored SQL", () => {
        expect(
            executedQueriesFromSnapshot(
                {
                    runtime: {
                        workflowReports: {
                            collect: { executedQueryText: "  SELECT runtime_value;\n" },
                            empty: { executedQueryText: "   " },
                        },
                    },
                },
                new Set(["collect", "empty"]),
            ),
        ).to.deep.equal([{ regionId: "collect", queryText: "  SELECT runtime_value;\n" }]);
        expect(executedQueriesFromSnapshot({}, new Set(["collect"]))).to.deep.equal([]);
    });
});
