/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as sinon from "sinon";
import * as vscode from "vscode";
import { RetainedRowStore } from "../../src/queryResults/resultStoreLease";
import { ExecutionHost } from "../../src/queryStudio/executionHost";
import { QueryStudioController } from "../../src/queryStudio/queryStudioController";
import { QueryStudioDocumentModel } from "../../src/queryStudio/queryStudioDocumentModel";
import { RowStore } from "../../src/queryStudio/rowStore";
import {
    QsCopySelectionResult,
    QsCopySelectionToClipboardRequest,
    QsResultSetSummary,
} from "../../src/sharedInterfaces/queryStudio";
import { QUERY_STUDIO_COPY_MAX_ROWS_PER_WINDOW } from "../../src/sharedInterfaces/queryStudioGridCopy";
import { stubTelemetry } from "./utils";

suite("Query Studio live copy lifetime", () => {
    const sandbox = sinon.createSandbox();
    const rowCount = QUERY_STUDIO_COPY_MAX_ROWS_PER_WINDOW + 1;
    const summary: QsResultSetSummary = {
        resultSetId: "rs1",
        batchOrdinal: 0,
        columnNames: ["unselected", "value"],
        rowCount,
        complete: true,
    };
    const selection = {
        resultSetId: "rs1",
        selection: [{ fromRow: 0, toRow: rowCount - 1, fromCell: 1, toCell: 1 }],
        includeHeaders: true,
    };
    let directory: string;
    let original: { rows: RowStore; store: RetainedRowStore };
    let replacement: { rows: RowStore; store: RetainedRowStore };
    let active: { rows: RowStore; store: RetainedRowStore };
    let clipboard: sinon.SinonStub;
    let copy: (params: typeof selection) => Promise<QsCopySelectionResult>;

    async function createRun(runId: string) {
        const rows = new RowStore(path.join(directory, runId));
        rows.beginResultSet(
            "rs1",
            summary.columnNames.map((name) => ({ name, displayName: name })),
        );
        await rows.appendPage("rs1", {
            rowOffset: 0,
            rowCount,
            approxBytes: rowCount * 64,
            compact: {
                values: Array.from({ length: rowCount }, (_, i) => ["ignored", `${runId}-${i}`]),
            },
        });
        rows.endResultSet("rs1");
        return {
            rows,
            store: new RetainedRowStore(rows, {
                runId,
                createdEpochMs: Date.now(),
                retainedMemoryBytes: 1024 * 1024,
            }),
        };
    }

    setup(async () => {
        stubTelemetry(sandbox);
        directory = fs.mkdtempSync(path.join(os.tmpdir(), "qs-live-copy-"));
        original = await createRun("original");
        replacement = await createRun("replacement");
        active = original;
        const host = sandbox.createStubInstance(ExecutionHost);
        sandbox.stub(host, "retainedStore").get(() => active.store);
        host.resultsState.returns({
            present: true,
            resultSets: [summary],
            totalRows: rowCount,
            streaming: false,
            messageCount: 0,
            errorCount: 0,
            planCount: 0,
        });
        host.getRows.callsFake((...args) => active.rows.getRows(...args));
        const model = sandbox.createStubInstance(QueryStudioDocumentModel);
        Object.defineProperty(model, "executionHost", { value: host });
        const controller = sandbox.createStubInstance(QueryStudioController);
        Object.defineProperty(controller, "model", { value: model });
        QueryStudioController.prototype["registerHandlers"].call(controller);
        const registration = controller.onRequest
            .getCalls()
            .find((call) => call.args[0].method === QsCopySelectionToClipboardRequest.type.method);
        expect(registration, "copy RPC handler").not.to.equal(undefined);
        copy = registration!.args[1] as typeof copy;
        clipboard = sandbox.stub().resolves();
        sandbox.stub(vscode.env, "clipboard").value({ writeText: clipboard });
    });

    teardown(() => {
        original?.store.releaseLiveOwner("documentClosed");
        replacement?.store.releaseLiveOwner("documentClosed");
        sandbox.restore();
        if (directory) fs.rmSync(directory, { recursive: true, force: true });
    });

    function rerun() {
        active = replacement;
        original.store.releaseLiveOwner("rerun");
    }

    test("copies every selected row from the original run when a rerun happens between windows", async () => {
        const read = original.rows.getRows.bind(original.rows);
        sandbox.stub(original.rows, "getRows").callsFake(async (...args) => {
            const window = await read(...args);
            if (active === original) rerun();
            return window;
        });

        const result = await copy(selection);
        expect(result.outcome).to.equal("copied");
        expect(result.fetchCount).to.be.greaterThan(1);
        expect(clipboard.firstCall.args[0].split(/\r?\n/)).to.deep.equal([
            "value",
            ...Array.from({ length: rowCount }, (_, i) => `original-${i}`),
        ]);
        expect(original.store.state).to.equal("disposed");
        expect(replacement.store.state).to.equal("active");
    });

    for (const failClipboard of [false, true]) {
        test(`retains the original run through a ${failClipboard ? "failed" : "successful"} clipboard write, then releases it`, async () => {
            const error = new Error("clipboard unavailable");
            clipboard.callsFake(async () => {
                rerun();
                expect(original.store.state).to.equal("active");
                expect(original.store.leaseOwners()).to.deep.equal([{ kind: "command" }]);
                if (failClipboard) throw error;
            });
            const result = await copy(selection).catch((reason: unknown) => reason);
            if (failClipboard) {
                expect(result).to.equal(error);
            } else {
                expect(result).to.have.property("outcome", "copied");
            }
            expect(original.store.state).to.equal("disposed");
            expect(replacement.store.state).to.equal("active");
        });
    }
});
