/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { DocumentSessionBinding } from "../../src/queryStudio/documentSessionBinding";
import { ExecutionHost } from "../../src/queryStudio/executionHost";
import { FakeBackend } from "../../src/services/sqlDataPlane/fakeBackend";

async function waitFor(predicate: () => boolean, ms = 4_000): Promise<void> {
    const deadline = Date.now() + ms;
    while (!predicate()) {
        if (Date.now() > deadline) {
            throw new Error("condition not reached in time");
        }
        await new Promise((resolve) => setTimeout(resolve, 10));
    }
}

suite("Query Studio execution host aggregates", () => {
    test("maintains result/message counters incrementally and resets them per run", async () => {
        const backend = new FakeBackend({
            scripts: [
                {
                    match: "first",
                    events: [
                        {
                            type: "resultSet",
                            columns: ["a", "b"],
                            rows: [
                                [1, 2],
                                [3, 4],
                            ],
                        },
                        { type: "message", kind: "error", text: "expected error" },
                        {
                            type: "resultSet",
                            columns: ["Microsoft SQL Server 2022 XML Showplan"],
                            rows: [["<plan />"]],
                            isPlanResult: true,
                        },
                        { type: "complete", status: "completedWithErrors" },
                    ],
                },
                {
                    match: "second",
                    events: [
                        { type: "resultSet", columns: ["only"], rows: [[1]] },
                        { type: "message", kind: "info", text: "done" },
                        { type: "complete", status: "succeeded" },
                    ],
                },
            ],
        });
        const session = await backend.openSession({
            profile: {
                profileFingerprint: "fp",
                server: "server",
                authKind: "sql",
                user: "user",
            },
            applicationName: "execution-host-aggregate-test",
        });
        const binding = {
            activeSession: session,
            setExecuting: () => undefined,
            notifyExecutedBatch: () => undefined,
            probeTransactionState: async () => undefined,
            metadataStatus: undefined,
        } as unknown as DocumentSessionBinding;
        const spillRoot = fs.mkdtempSync(path.join(os.tmpdir(), "qs-host-aggregates-"));
        const host = new ExecutionHost(path.join(spillRoot, "spill"), binding, "test-uri");

        try {
            expect(
                host.execute("first", { selectionStartLine: 1, scope: "document" }).started,
            ).to.equal(true);
            await waitFor(() => host.executionState.kind === "completedWithErrors");

            expect(host.resultsState()).to.deep.include({
                totalRows: 3,
                errorCount: 1,
                planCount: 1,
            });
            expect(host.resultsState().resultSets).to.have.length(2);
            expect(host.resultColumnCount).to.equal(3);

            expect(
                host.execute("second", { selectionStartLine: 1, scope: "document" }).started,
            ).to.equal(true);
            await waitFor(() => host.executionState.kind === "succeeded");

            expect(host.resultsState()).to.deep.include({
                totalRows: 1,
                errorCount: 0,
                planCount: 0,
            });
            expect(host.resultsState().resultSets).to.have.length(1);
            expect(host.resultColumnCount).to.equal(1);
        } finally {
            host.dispose();
            await session.dispose();
            fs.rmSync(spillRoot, { recursive: true, force: true });
        }
    });
});
