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
import { RowStore } from "../../src/queryStudio/rowStore";
import { RetainedRowStore } from "../../src/queryResults/resultStoreLease";
import * as access from "../../src/queryResults/queryResultAccessService";
import { PinnedResultsController } from "../../src/queryResults/pinnedResultsController";
import {
    PinnedQueryResultsDocument,
    openPinnedResultsDocument,
    registerPinnedResultsEditor,
} from "../../src/queryResults/pinnedResultsDocumentProvider";
import { QsResultSetSummary } from "../../src/sharedInterfaces/queryStudio";
import { configResultsOpenAfterSave } from "../../src/constants/constants";
import { stubTelemetry } from "./utils";

suite("queryResults pinned operation lifetime", () => {
    const sandbox = sinon.createSandbox();
    let directory: string;
    let service: access.QueryResultAccessService;
    let document: PinnedQueryResultsDocument;
    let store: RetainedRowStore;
    let snapshotId: string;
    let controller: sinon.SinonStubbedInstance<PinnedResultsController>;
    const summary: QsResultSetSummary = {
        resultSetId: "rs1",
        batchOrdinal: 0,
        columnNames: ["value"],
        rowCount: 2,
        complete: true,
    };
    const largeValue = "x".repeat(40_000);
    const subscriptions: vscode.Disposable[] = [];

    setup(async () => {
        stubTelemetry(sandbox);
        directory = fs.mkdtempSync(path.join(os.tmpdir(), "qs-pinned-review-"));
        const rows = new RowStore(path.join(directory, "spill"));
        rows.beginResultSet("rs1", [{ name: "value", displayName: "value" }]);
        await rows.appendPage("rs1", {
            rowOffset: 0,
            rowCount: 2,
            approxBytes: 80_000,
            compact: { values: [[largeValue], ["last row"]] },
        });
        rows.endResultSet("rs1");
        store = new RetainedRowStore(rows, {
            runId: "review",
            createdEpochMs: Date.now(),
            retainedMemoryBytes: 1024 * 1024,
        });
        service = new access.QueryResultAccessService();
        sandbox.stub(access, "getQueryResultAccessService").returns(service);
        service.registerLiveSource({
            sourceId: "source",
            sourceKind: "queryStudio",
            sourceTitle: () => "review",
            sourceUriDigest: () => "digest",
            state: () => ({
                streaming: false,
                runId: "review",
                resultSets: [{ ...summary, corrupt: false }],
            }),
            currentStore: () => store,
            messagesSnapshot: () => [],
            queryText: () => undefined,
            runRecordId: () => undefined,
            tuning: () => ({}),
        });
        const lease = await service.createSnapshot({
            sourceId: "source",
            owner: { kind: "pinnedDocument" },
            reason: "review",
            scope: { kind: "allCompleteResultSets" },
        });
        snapshotId = lease.snapshotId;
        document = new PinnedQueryResultsDocument(
            vscode.Uri.parse("mssql-query-results-snapshot:/review"),
            snapshotId,
            lease,
        );
        store.releaseLiveOwner("documentClosed");
        controller = sandbox.createStubInstance(PinnedResultsController);
        Object.defineProperty(controller, "document", { value: document });
        (controller["summaryFor"] as sinon.SinonStub).callsFake((id: string) =>
            id === "rs1" ? summary : undefined,
        );
        PinnedResultsController.prototype["registerHandlers"].call(controller);
    });

    teardown(() => {
        document?.dispose();
        service?.dispose();
        subscriptions.splice(0).forEach((disposable) => disposable.dispose());
        sandbox.restore();
        if (directory) fs.rmSync(directory, { recursive: true, force: true });
    });

    function handler(method: string): (params: unknown) => Promise<any> {
        const call = controller.onRequest.getCalls().find((call) => call.args[0].method === method);
        expect(call, `missing ${method}`).not.to.equal(undefined);
        return call!.args[1] as (params: unknown) => Promise<any>;
    }

    test("closing a pin during Save As retains all rows through export, then releases them", async () => {
        const target = vscode.Uri.file(path.join(directory, "pinned.csv"));
        sandbox.stub(vscode.window, "showSaveDialog").callsFake(async () => {
            document.dispose();
            expect(store.state).to.equal("active");
            expect(service.status().leasesByOwnerKind.export).to.equal(1);
            return target;
        });
        sandbox.stub(vscode.window, "showInformationMessage").resolves(undefined);
        sandbox.stub(vscode.workspace, "getConfiguration").returns({
            get: (key: string, fallback: unknown) =>
                key === configResultsOpenAfterSave ? false : fallback,
        } as vscode.WorkspaceConfiguration);
        const result = await handler("qs/saveResult")({ resultSetId: "rs1", format: "csv" });
        expect(result.saved).to.equal(true);
        expect(fs.readFileSync(target.fsPath, "utf8"))
            .to.contain(largeValue)
            .and.contain("last row");
        expect(store.state).to.equal("disposed");
    });

    test("host copy preserves full LOB values if the panel closes during clipboard writing", async () => {
        const clipboard = sandbox.stub().callsFake(async () => {
            document.dispose();
            expect(store.state).to.equal("active");
            expect(service.status().leasesByOwnerKind.command).to.equal(1);
        });
        sandbox.stub(vscode.env, "clipboard").value({ writeText: clipboard });
        const copied = await handler("qs/copySelectionToClipboard")({
            resultSetId: "rs1",
            selection: [{ fromRow: 0, toRow: 1, fromCell: 0, toCell: 0 }],
            includeHeaders: true,
        });
        expect(copied.outcome).to.equal("copied");
        expect(clipboard.firstCall.args[0]).to.contain(largeValue).and.contain("last row");
        expect(store.state).to.equal("disposed");
        clipboard.resolves();
        await handler("qs/writeClipboard")({ text: "fallback" });
        expect(clipboard.lastCall.args[0]).to.equal("fallback");
    });

    for (const stage of ["panel", "controller"] as const) {
        test(`failed ${stage} initialization releases its acquired snapshot lease`, async () => {
            registerPinnedResultsEditor({
                subscriptions,
                extensionPath: directory,
                extensionUri: vscode.Uri.file(directory),
            } as vscode.ExtensionContext);
            const create = sandbox.stub(vscode.window, "createWebviewPanel");
            const disposed = sandbox.stub();
            if (stage === "panel") {
                create.throws(new Error("panel failed"));
            } else {
                create.returns({
                    webview: { options: {} },
                    onDidDispose: () => ({ dispose() {} }),
                    dispose: disposed,
                } as unknown as vscode.WebviewPanel);
                sandbox
                    .stub(PinnedResultsController.prototype, "_getHtmlTemplate" as never)
                    .throws(new Error("render failed"));
            }
            expect(await openPinnedResultsDocument(snapshotId)).to.equal(false);
            expect(service.status().leasesByOwnerKind.pinnedDocument).to.equal(1);
            if (stage === "controller") sinon.assert.calledOnce(disposed);
            document.dispose();
            expect(store.state).to.equal("disposed");
        });
    }
});
