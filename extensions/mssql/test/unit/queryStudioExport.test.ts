/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import * as sinon from "sinon";
import * as vscode from "vscode";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { saveQueryStudioResult } from "../../src/queryStudio/resultExport";
import { RowStore } from "../../src/queryStudio/rowStore";
import { RetainedRowStore } from "../../src/queryResults/resultStoreLease";
import { packBitmap } from "../../src/services/sqlDataPlane/api";
import { QsResultSetSummary } from "../../src/sharedInterfaces/queryStudio";
import { msgSaveResultsWhileLoading } from "../../src/constants/locConstants";
import { configResultsOpenAfterSave } from "../../src/constants/constants";

suite("Query Studio export safety", () => {
    const sandbox = sinon.createSandbox();
    teardown(() => sandbox.restore());

    test("missing rows fail export instead of reporting a truncated file as successful", async () => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "qs-export-missing-"));
        sandbox
            .stub(vscode.window, "showSaveDialog")
            .resolves(vscode.Uri.file(path.join(tempDir, "missing.csv")));
        const success = sandbox.stub(vscode.window, "showInformationMessage").resolves(undefined);
        const failure = sandbox.stub(vscode.window, "showErrorMessage").resolves(undefined);
        const createStream = sandbox.spy(fs, "createWriteStream");
        try {
            const outcome = await saveQueryStudioResult({
                summary: summary(true),
                format: "csv",
                getRows: async () => ({
                    resultSetId: "b0r0s0",
                    start: 0,
                    rowCount: 0,
                    columns: [],
                    values: [],
                }),
            });
            expect(outcome.saved).to.equal(false);
            sinon.assert.calledOnce(failure);
            sinon.assert.notCalled(success);
            expect(createStream.returnValues[0].closed).to.equal(true);
            expect(fs.readdirSync(tempDir)).to.deep.equal([]);
        } finally {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });

    function summary(complete: boolean): QsResultSetSummary {
        return {
            resultSetId: "b0r0s0",
            batchOrdinal: 0,
            columnNames: ["value"],
            rowCount: 1,
            complete,
        };
    }

    test("refuses a streaming result before the Save dialog can turn a partial selection stale", async () => {
        const prompt = sandbox.stub(vscode.window, "showSaveDialog").resolves(undefined);
        const warning = sandbox.stub(vscode.window, "showWarningMessage").resolves(undefined);
        const getRows = sandbox.stub().rejects(new Error("Must not read incomplete results"));
        const outcome = await saveQueryStudioResult({
            summary: summary(false),
            isExecuting: true,
            format: "csv",
            selection: [{ fromRow: 0, toRow: 0, fromCell: 0, toCell: 0 }],
            getRows,
        });
        expect(outcome).to.deep.equal({ saved: false, error: msgSaveResultsWhileLoading });
        sinon.assert.calledWith(warning, msgSaveResultsWhileLoading);
        sinon.assert.notCalled(prompt);
        sinon.assert.notCalled(getRows);
    });

    for (const { complete, isExecuting, label } of [
        { complete: true, isExecuting: true, label: "completed set while later batches run" },
        { complete: false, isExecuting: false, label: "partial set after execution has stopped" },
    ]) {
        test(`allows Save As for a ${label}`, async () => {
            const prompt = sandbox.stub(vscode.window, "showSaveDialog").resolves(undefined);
            const outcome = await saveQueryStudioResult({
                summary: summary(complete),
                isExecuting,
                format: "json",
                getRows: sandbox.stub().rejects(new Error("Save was canceled")),
            });
            expect(outcome).to.deep.equal({ saved: false, canceled: true });
            sinon.assert.calledOnce(prompt);
        });
    }

    test("retains the original rows if their live owner reruns during Save As", async () => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "qs-export-"));
        const rowStore = new RowStore(path.join(tempDir, "rows"));
        const store = new RetainedRowStore(rowStore, {
            runId: "original-run",
            createdEpochMs: Date.now(),
            retainedMemoryBytes: 1024 * 1024,
        });
        rowStore.beginResultSet("b0r0s0", [{ name: "value", displayName: "value" }]);
        await rowStore.appendPage("b0r0s0", {
            rowOffset: 0,
            rowCount: 1,
            approxBytes: 20,
            compact: { values: [["original"]], nullBitmap: packBitmap([false]) },
        });
        rowStore.endResultSet("b0r0s0");
        const destination = vscode.Uri.file(path.join(tempDir, "original.csv"));
        sandbox.stub(vscode.window, "showSaveDialog").callsFake(async () => {
            store.releaseLiveOwner("rerun");
            expect(store.state).to.equal("active");
            return destination;
        });
        sandbox.stub(vscode.window, "showInformationMessage").resolves(undefined);
        sandbox.stub(vscode.workspace, "getConfiguration").returns({
            get: sandbox
                .stub()
                .callsFake((key: string, fallback: unknown) =>
                    key === configResultsOpenAfterSave ? false : fallback,
                ),
        } as unknown as vscode.WorkspaceConfiguration);
        try {
            const outcome = await saveQueryStudioResult({
                summary: summary(true),
                format: "csv",
                store,
                getRows: (resultSetId, start, count) =>
                    store.getWindow({
                        resultSetId,
                        rowStart: start,
                        rowCount: count,
                        reason: "export",
                    }),
            });
            expect(outcome.saved).to.equal(true);
            expect(fs.readFileSync(destination.fsPath, "utf8")).to.contain("original");
            expect(store.state).to.equal("disposed");
        } finally {
            store.releaseLiveOwner("documentClosed");
            rowStore.dispose();
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });
});
