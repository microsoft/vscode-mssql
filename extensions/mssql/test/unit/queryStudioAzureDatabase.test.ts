/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Azure SQL DB database semantics (Karl 2026-07-10): the DB selector must
 * list ALL databases on an Azure server (master-first, STS v1
 * ListDatabaseRequestHandler parity) and fall back to the current session's
 * sys.databases when master is not accessible.
 */

import { expect } from "chai";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { ExecutionHost } from "../../src/queryStudio/executionHost";
import { DocumentSessionBinding } from "../../src/queryStudio/documentSessionBinding";
import {
    IQueryEventSink,
    ISqlSession,
    QueryCompleteSummary,
    QueryHandle,
} from "../../src/services/sqlDataPlane/api";

function columnHandle(sink: IQueryEventSink, values: string[]): QueryHandle {
    const summary: QueryCompleteSummary = {
        clientQueryId: "q",
        status: "succeeded",
    } as QueryCompleteSummary;
    const completion = (async () => {
        await sink.onRowsPage?.({
            resultSetId: "rs0",
            compact: { values: values.map((value) => [value]) },
        } as never);
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

function harness(masterList: string[] | undefined | (() => Promise<string[] | undefined>)) {
    const backgroundQueries: string[] = [];
    const session = {
        state: "open",
        info: {},
        execute(text: string, _opts: { tag?: string }, sink: IQueryEventSink): QueryHandle {
            backgroundQueries.push(text);
            return columnHandle(sink, ["master", "currentdb"]);
        },
    } as unknown as ISqlSession;
    const binding = {
        activeSession: session,
        setExecuting: () => undefined,
        notifyExecutedBatch: () => undefined,
        probeTransactionState: async () => undefined,
        metadataStatus: undefined,
        listDatabasesViaMaster:
            typeof masterList === "function" ? masterList : async () => masterList,
    } as unknown as DocumentSessionBinding;
    const spillRoot = fs.mkdtempSync(path.join(os.tmpdir(), "qs-azdb-"));
    const host = new ExecutionHost(path.join(spillRoot, "spill"), binding, "test");
    return { host, backgroundQueries };
}

suite("query studio: Azure database list (master-first)", () => {
    test("master session list wins when available — no current-session query runs", async () => {
        const h = harness(["master", "ninjadb", "ninjadb-external"]);
        const databases = await h.host.listDatabases();
        expect(databases).to.deep.equal(["master", "ninjadb", "ninjadb-external"]);
        expect(h.backgroundQueries).to.deep.equal([]);
    });

    test("no master access falls back to the current session's sys.databases", async () => {
        const h = harness(undefined);
        const databases = await h.host.listDatabases();
        expect(databases).to.deep.equal(["master", "currentdb"]);
        expect(h.backgroundQueries).to.have.length(1);
        expect(h.backgroundQueries[0]).to.contain("sys.databases");
    });

    test("an empty master list also falls back (never an empty selector)", async () => {
        const h = harness([]);
        const databases = await h.host.listDatabases();
        expect(databases).to.deep.equal(["master", "currentdb"]);
    });

    test("a rejecting master probe falls back instead of failing the request", async () => {
        const h = harness(() => Promise.reject(new Error("18456: login failed for master")));
        const databases = await h.host.listDatabases();
        expect(databases).to.deep.equal(["master", "currentdb"]);
    });
});
