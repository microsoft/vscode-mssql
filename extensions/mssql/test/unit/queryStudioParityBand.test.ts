/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * B4 parity band: SET wrapper modes (parse / estimated plan / actual plan)
 * with the finally-restore discipline (doc 04 §12.5–12.6), canonical
 * showplan result detection, and database context switching (USE + escaped
 * identifiers + session context signal).
 */

import { expect } from "chai";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { FakeBackend, FakeScript } from "../../src/services/sqlDataPlane/fakeBackend";
import {
    ExecutionOrchestrator,
    RunEvents,
    isPlanResultSet,
} from "../../src/queryStudio/executionOrchestrator";
import { RowStore } from "../../src/queryStudio/rowStore";
import { ISqlSession } from "../../src/services/sqlDataPlane/api";

const SHOWPLAN_COL = "Microsoft SQL Server 2005 XML Showplan";

class NullEvents implements RunEvents {
    readonly planFlags: boolean[] = [];
    onResultSetStarted(s: { isPlanResult?: boolean }): void {
        this.planFlags.push(s.isPlanResult === true);
    }
    onRowsAppended(): void {}
    onResultSetEnded(): void {}
    onMessages(): void {}
    onPhase(): void {}
}

function harness(scripts: FakeScript[]) {
    const backend = new FakeBackend({ scripts });
    const executed: string[] = [];
    return {
        backend,
        executed,
        async session(): Promise<ISqlSession> {
            const session = await backend.openSession({
                profile: {
                    profileFingerprint: "fp",
                    server: "localhost",
                    authKind: "sql",
                    user: "sa",
                },
                applicationName: "test",
            });
            const original = session.execute.bind(session);
            session.execute = (text, opts, sink) => {
                executed.push(text);
                return original(text, opts, sink);
            };
            return session;
        },
        store(): RowStore {
            return new RowStore(fs.mkdtempSync(path.join(os.tmpdir(), "qs-b4-")));
        },
    };
}

const OK: FakeScript = {
    match: () => true,
    events: [{ type: "complete", status: "succeeded" }],
};

suite("Query Studio parity band (B4)", () => {
    test("isPlanResultSet: canonical column only", () => {
        expect(isPlanResultSet([SHOWPLAN_COL])).to.equal(true);
        expect(isPlanResultSet(["Microsoft SQL Server 2017 XML Showplan"])).to.equal(true);
        expect(isPlanResultSet([SHOWPLAN_COL, "extra"])).to.equal(false);
        expect(isPlanResultSet(["xml_plan"])).to.equal(false);
        expect(isPlanResultSet([])).to.equal(false);
    });

    test("estimatedPlan mode: SHOWPLAN_XML ON before, OFF after (finally), plan sets flagged", async () => {
        const h = harness([
            {
                match: (t) => t.includes("select"),
                events: [
                    {
                        type: "resultSet",
                        columns: [SHOWPLAN_COL],
                        rows: [["<ShowPlanXML/>"]],
                    },
                    { type: "complete", status: "succeeded" },
                ],
            },
            OK,
        ]);
        const events = new NullEvents();
        const orchestrator = new ExecutionOrchestrator(await h.session(), h.store(), events);
        const result = await orchestrator.run("select 1", {
            selectionStartLine: 1,
            stopOnError: false,
            scope: "document",
            mode: "estimatedPlan",
        });
        expect(result.status).to.equal("succeeded");
        expect(h.executed[0]).to.equal("SET SHOWPLAN_XML ON;");
        expect(h.executed[h.executed.length - 1]).to.equal("SET SHOWPLAN_XML OFF;");
        expect(events.planFlags).to.deep.equal([true]);
    });

    test("parseOnly mode: PARSEONLY ON/OFF wrap; failures still restore OFF", async () => {
        const h = harness([
            {
                match: (t) => t.includes("select"),
                events: [
                    { type: "message", kind: "error", text: "Incorrect syntax near 'selec'." },
                    { type: "complete", status: "failed" },
                ],
            },
            OK,
        ]);
        const orchestrator = new ExecutionOrchestrator(
            await h.session(),
            h.store(),
            new NullEvents(),
        );
        const result = await orchestrator.run("select bad syntax", {
            selectionStartLine: 1,
            stopOnError: false,
            scope: "document",
            mode: "parseOnly",
        });
        expect(result.status).to.equal("completedWithErrors");
        expect(h.executed[0]).to.equal("SET PARSEONLY ON;");
        expect(h.executed[h.executed.length - 1]).to.equal("SET PARSEONLY OFF;");
    });

    test("actualPlan mode wraps with STATISTICS XML and flags only the plan result set", async () => {
        const h = harness([
            {
                match: (t) => t.includes("select"),
                events: [
                    { type: "resultSet", columns: ["n"], rows: [[1]] },
                    {
                        type: "resultSet",
                        columns: [SHOWPLAN_COL],
                        rows: [["<ShowPlanXML/>"]],
                    },
                    { type: "complete", status: "succeeded" },
                ],
            },
            OK,
        ]);
        const events = new NullEvents();
        const orchestrator = new ExecutionOrchestrator(await h.session(), h.store(), events);
        await orchestrator.run("select 1", {
            selectionStartLine: 1,
            stopOnError: false,
            scope: "document",
            mode: "actualPlan",
        });
        expect(h.executed[0]).to.equal("SET STATISTICS XML ON;");
        expect(events.planFlags).to.deep.equal([false, true]);
    });

    test("normal mode: no wrapper batches", async () => {
        const h = harness([OK]);
        const orchestrator = new ExecutionOrchestrator(
            await h.session(),
            h.store(),
            new NullEvents(),
        );
        await orchestrator.run("select 1", {
            selectionStartLine: 1,
            stopOnError: false,
            scope: "document",
        });
        expect(h.executed).to.deep.equal(["select 1"]);
    });
});
