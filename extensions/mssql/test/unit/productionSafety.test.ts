/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Production safety (Karl 2026-07-10): the modify classifier (over-broad by
 * design, but never tripped by strings/comments/identifiers), the accent
 * text-color pick, and the ExecutionHost confirmation gate (pause → confirm
 * → run; decline runs nothing; session suppression lives in the guard).
 */

import { expect } from "chai";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
    accentTextColor,
    parseHexColor,
    relativeLuminance,
} from "../../src/sharedInterfaces/colorContrast";
import { isModifyingSql, stripSqlNonCode } from "../../src/sql/sqlSafetyClassifier";
import { ExecutionHost } from "../../src/queryStudio/executionHost";
import { DocumentSessionBinding } from "../../src/queryStudio/documentSessionBinding";
import {
    IQueryEventSink,
    ISqlSession,
    QueryCompleteSummary,
    QueryHandle,
} from "../../src/services/sqlDataPlane/api";

suite("production safety: SQL modify classifier", () => {
    test("reads never trip it", () => {
        for (const sql of [
            "SELECT TOP 100 * FROM Sales.Orders",
            "select a, b from t where x = 1 order by a",
            "WITH cte AS (SELECT 1 AS a) SELECT * FROM cte",
            "  \n-- just a comment\nSELECT 1",
            "USE WideWorldImporters;\nSELECT 1;",
            "DECLARE @x int; SET @x = 1; SELECT @x;",
            "PRINT 'hello'",
        ]) {
            expect(isModifyingSql(sql), sql).to.equal(false);
        }
    });

    test("strings, comments, and identifiers containing keywords never trip it", () => {
        for (const sql of [
            "SELECT 'DROP TABLE users' AS threat",
            "SELECT 'it''s an UPDATE inside a string'",
            "SELECT [Delete], [Drop Zone] FROM t",
            'SELECT "CREATE" FROM t',
            "-- DELETE FROM t\nSELECT 1",
            "/* UPDATE t SET x=1 /* nested ALTER */ */ SELECT 1",
        ]) {
            expect(isModifyingSql(sql), sql).to.equal(false);
        }
    });

    test("modifications trip it — DML, DDL, EXEC, SELECT INTO, admin", () => {
        for (const sql of [
            "INSERT INTO t VALUES (1)",
            "update t set x = 1",
            "DELETE FROM t WHERE 1=1",
            "TRUNCATE TABLE t",
            "DROP TABLE t",
            "ALTER TABLE t ADD c int",
            "CREATE TABLE t (a int)",
            "MERGE INTO t USING s ON t.id = s.id WHEN MATCHED THEN UPDATE SET x = 1;",
            "EXEC dbo.DoDangerousThings",
            "SELECT * INTO backup_t FROM t",
            "WITH cte AS (SELECT 1 a) DELETE FROM t",
            "SELECT 1\nGO\nDROP DATABASE prod",
            "GRANT SELECT ON t TO public",
            "KILL 208",
            "BACKUP DATABASE x TO DISK='y'",
        ]) {
            expect(isModifyingSql(sql), sql).to.equal(true);
        }
    });

    test("stripSqlNonCode keeps code separation", () => {
        expect(stripSqlNonCode("SELECT 1 -- DROP\nDELETE FROM t")).to.contain("DELETE");
        expect(stripSqlNonCode("SELECT '--not a comment' , x FROM t")).to.contain("FROM t");
    });
});

suite("production safety: accent text color", () => {
    test("hex parsing forms", () => {
        expect(parseHexColor("#fff")).to.deep.equal([255, 255, 255]);
        expect(parseHexColor("B71C1C")).to.deep.equal([183, 28, 28]);
        expect(parseHexColor("#12345678")).to.deep.equal([18, 52, 86]);
        expect(parseHexColor("red")).to.equal(undefined);
    });

    test("dark accents get near-white text; light accents get near-black", () => {
        expect(accentTextColor("#B71C1C")).to.equal("#ffffff"); // production red
        expect(accentTextColor("#1565C0")).to.equal("#ffffff"); // strong blue
        expect(accentTextColor("#FFEB3B")).to.equal("#1e1e1e"); // yellow
        expect(accentTextColor("#F6F6F6")).to.equal("#1e1e1e"); // near-white
        expect(accentTextColor("garbage")).to.equal("#ffffff"); // safe default
    });

    test("luminance sanity", () => {
        expect(relativeLuminance([0, 0, 0])).to.equal(0);
        expect(relativeLuminance([255, 255, 255])).to.be.closeTo(1, 1e-9);
    });
});

function instantHandle(sink: IQueryEventSink): QueryHandle {
    const summary: QueryCompleteSummary = {
        clientQueryId: "q",
        status: "succeeded",
    } as QueryCompleteSummary;
    const completion = (async () => {
        await sink.onComplete(summary);
        return summary;
    })();
    return {
        clientQueryId: "q",
        completion,
        cancel: async () => ({ acknowledged: false }),
        dispose: async () => undefined,
    } as unknown as QueryHandle;
}

async function waitFor(predicate: () => boolean, ms = 3_000): Promise<void> {
    const deadline = Date.now() + ms;
    while (!predicate()) {
        if (Date.now() > deadline) {
            throw new Error("condition not reached in time");
        }
        await new Promise((resolve) => setTimeout(resolve, 10));
    }
}

suite("production safety: execution gate", () => {
    function harness(answers: ("yes" | "yesSession" | "no")[]) {
        const executed: string[] = [];
        const session = {
            state: "open",
            info: {},
            execute(text: string, opts: { tag?: string }, sink: IQueryEventSink): QueryHandle {
                if (!opts.tag?.includes("Probe") && !opts.tag?.includes("tranProbe")) {
                    executed.push(text);
                }
                return instantHandle(sink);
            },
        } as unknown as ISqlSession;
        const binding = {
            activeSession: session,
            setExecuting: () => undefined,
            notifyExecutedBatch: () => undefined,
            probeTransactionState: async () => undefined,
            metadataStatus: undefined,
        } as unknown as DocumentSessionBinding;
        let suppressed = false;
        let confirms = 0;
        const guard = {
            shouldConfirm: (text: string) => !suppressed && isModifyingSql(text),
            confirm: async (): Promise<"yes" | "yesSession" | "no"> => {
                confirms++;
                const answer = answers.shift() ?? "no";
                if (answer === "yesSession") {
                    suppressed = true;
                }
                return answer;
            },
        };
        const spillRoot = fs.mkdtempSync(path.join(os.tmpdir(), "qs-prod-"));
        const host = new ExecutionHost(path.join(spillRoot, "spill"), binding, "test", guard);
        return {
            host,
            executed,
            confirmCount: () => confirms,
        };
    }

    test("SELECT runs without any confirmation", async () => {
        const h = harness([]);
        expect(
            h.host.execute("SELECT 1", { selectionStartLine: 1, scope: "document" }).started,
        ).to.equal(true);
        await waitFor(() => h.executed.length === 1);
        expect(h.confirmCount()).to.equal(0);
    });

    test("a modification pauses; decline runs NOTHING", async () => {
        const h = harness(["no"]);
        const outcome = h.host.execute("DELETE FROM t", {
            selectionStartLine: 1,
            scope: "document",
        });
        expect(outcome.started).to.equal(false);
        expect(outcome.reason).to.include("production");
        await waitFor(() => h.confirmCount() === 1);
        await new Promise((resolve) => setTimeout(resolve, 50));
        expect(h.executed).to.deep.equal([]);
    });

    test("confirm runs the query; the NEXT modification asks again", async () => {
        const h = harness(["yes", "yes"]);
        h.host.execute("DELETE FROM t WHERE id = 1", { selectionStartLine: 1, scope: "document" });
        await waitFor(() => h.executed.length === 1);
        await waitFor(() => h.host.executionState.kind === "succeeded");
        h.host.execute("UPDATE t SET x = 2", { selectionStartLine: 1, scope: "document" });
        await waitFor(() => h.executed.length === 2);
        expect(h.confirmCount()).to.equal(2);
    });

    test("'don't ask again this session' suppresses subsequent confirmations", async () => {
        const h = harness(["yesSession"]);
        h.host.execute("DROP TABLE scratch", { selectionStartLine: 1, scope: "document" });
        await waitFor(() => h.executed.length === 1);
        await waitFor(() => h.host.executionState.kind === "succeeded");
        const second = h.host.execute("DELETE FROM scratch2", {
            selectionStartLine: 1,
            scope: "document",
        });
        expect(second.started).to.equal(true); // no pause this time
        await waitFor(() => h.executed.length === 2);
        expect(h.confirmCount()).to.equal(1);
    });
});
