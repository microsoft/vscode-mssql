/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import * as sinon from "sinon";
import * as jsonRpc from "vscode-jsonrpc/node";
import { expect } from "chai";
import { DEFAULT_VALUE, EditCommitError, EditSession } from "sql-feature/edit";
import { SqlExecutionError } from "sql-feature/core";
import { TableEditorWebviewController } from "../../src/tableExplorer/tableEditorWebviewController";
import { ISqlSession } from "../../src/services/sqlDataPlane/api";
import {
    stubExtensionContext,
    stubLogger,
    stubTelemetry,
    stubWebviewConnectionRpc,
    stubWebviewPanel,
} from "./utils";

suite("Table editor durable drafts", () => {
    let sandbox: sinon.SinonSandbox;
    let controller: TableEditorWebviewController;
    let engine: sinon.SinonStubbedInstance<EditSession>;
    let action: (value: unknown) => Promise<unknown>;
    const page = (id: string, name: string) => ({
        rows: [
            {
                values: { Id: id, Name: name },
                cursor: { Id: id },
                hasTruncatedCells: false,
                incompleteColumns: [],
            },
        ],
        pageSize: 200,
        nextCursor: { Id: id },
    });
    setup(async () => {
        sandbox = sinon.createSandbox();
        stubTelemetry(sandbox);
        stubLogger(sandbox);
        const rpc = stubWebviewConnectionRpc(sandbox);
        sandbox.stub(jsonRpc, "createMessageConnection").returns(rpc.connection);
        sandbox.stub(vscode.window, "createWebviewPanel").returns(stubWebviewPanel(sandbox));
        engine = sandbox.createStubInstance(EditSession);
        Object.defineProperty(engine, "key", {
            value: { kind: "primaryKey", columns: ["Id"], canEdit: true, isAmbiguous: false },
        });
        sandbox.stub(engine, "info").get(() => ({
            columns: [
                { name: "Id", typeName: "int", isWritable: false },
                {
                    name: "Name",
                    typeName: "nvarchar",
                    isWritable: true,
                    isNullable: true,
                    hasDefault: true,
                },
            ],
        }));
        engine.readPage.resolves(page("1", "Original"));
        engine.commit.resolves({ applied: 1 });
        sandbox.stub(EditSession, "open").resolves(engine);
        controller = new TableEditorWebviewController(stubExtensionContext(sandbox), {
            session: { close: sandbox.stub().resolves() } as unknown as ISqlSession,
            serverName: "Fixture",
            databaseName: "Db",
            schemaName: "dbo",
            tableName: "Table",
        });
        await new Promise<void>((resolve) => setImmediate(resolve));
        action = rpc.requestHandlers.get("action") as unknown as (
            value: unknown,
        ) => Promise<unknown>;
    });
    teardown(() => {
        controller?.dispose();
        sandbox.restore();
    });
    const send = (type: string, payload: unknown = {}) => action({ type, payload });
    test("failed full-value reads cannot stage the fallback value and can be retried", async () => {
        const rowId = controller.state.rows[0].id;
        engine.readCellValue.rejects(new Error("Fetch failed"));
        await send("openCell", { rowId, column: "Name" });
        expect(controller.state.openCell).to.include({
            status: "error",
            value: null,
            error: "Fetch failed",
        });
        await send("editCell", { rowId, column: "Name", value: "Incomplete" });
        expect(controller.state.staged).to.deep.equal({});
        engine.readCellValue.resolves("Complete");
        await send("openCell", { rowId, column: "Name" });
        expect(controller.state.openCell).to.include({ status: "ready", value: "Complete" });
    });
    test("closing a loading document ignores its late response", async () => {
        const rowId = controller.state.rows[0].id;
        let resolveValue!: (value: string) => void;
        engine.readCellValue.returns(
            new Promise((resolve) => {
                resolveValue = resolve;
            }),
        );
        const opening = send("openCell", { rowId, column: "Name" });
        expect(controller.state.openCell?.status).to.equal("loading");
        await send("closeCell");
        resolveValue("Late value");
        await opening;
        expect(controller.state.openCell).to.equal(undefined);
    });
    test("edits save with their original row after navigating to another page", async () => {
        const rowId = controller.state.rows[0].id;
        await send("editCell", { rowId, column: "Name", value: "Changed" });
        engine.readPage.resolves(page("2", "Other"));
        await send("nextPage");
        await send("save");
        expect(engine.commit.firstCall.args[0]).to.deep.equal([
            {
                rowId,
                kind: "update",
                values: { Name: "Changed" },
                original: { Id: "1", Name: "Original" },
            },
        ]);
    });
    test("refresh preserves row identity and the original concurrency snapshot", async () => {
        const rowId = controller.state.rows[0].id;
        await send("editCell", { rowId, column: "Name", value: "Changed" });
        engine.readPage.resolves(page("1", "Changed elsewhere"));
        await send("refresh");
        expect(controller.state.rows[0].id).to.equal(rowId);
        await send("save");
        expect(engine.commit.firstCall.args[0]).to.deep.equal([
            {
                rowId,
                kind: "update",
                values: { Name: "Changed" },
                original: { Id: "1", Name: "Original" },
            },
        ]);
    });
    test("new rows and values survive paging", async () => {
        await send("addRow");
        const rowId = controller.state.rows.find((row) => row.isNew)!.id;
        expect(controller.state.staged).to.deep.equal({});
        await send("editCell", { rowId, column: "Name", value: "New" });
        engine.readPage.resolves(page("2", "Other"));
        await send("nextPage");
        expect(controller.state.rows.some((row) => row.id === rowId)).to.equal(true);
        await send("save");
        expect(engine.commit.firstCall.args[0]).to.deep.equal([
            { rowId, kind: "insert", values: { Name: "New" } },
        ]);
    });
    test("acknowledged inserts merge server-generated values into the reloaded page", async () => {
        await send("addRow");
        const rowId = controller.state.rows.find((row) => row.isNew)!.id;
        await send("editCell", { rowId, column: "Name", value: "New" });
        engine.commit.resolves({
            applied: 1,
            observations: [{ rowId, kind: "insert", key: { Id: "2" } }],
        });
        engine.readCurrentRow.resolves({
            values: { Id: "2", Name: "Trigger value" },
            cursor: { Id: "2" },
            hasTruncatedCells: false,
            incompleteColumns: [],
        });
        engine.readPage.resolves({
            rows: [
                {
                    values: { Id: "2", Name: "Page value" },
                    cursor: { Id: "2" },
                    hasTruncatedCells: false,
                    incompleteColumns: [],
                },
            ],
            pageSize: 200,
        });

        await send("save");

        const row = controller.state.rows.find((candidate) => candidate.key.Id === "2");
        expect(row).to.include({ id: rowId });
        expect(row?.values).to.deep.equal({ Id: "2", Name: "Trigger value" });
        expect(row?.isNew).to.equal(undefined);
        expect(controller.state.saveState).to.equal("saved");
    });
    test("acknowledged saves retain evidence when the observation is missing", async () => {
        const rowId = controller.state.rows[0].id;
        await send("editCell", { rowId, column: "Name", value: "Changed" });
        engine.commit.resolves({ applied: 1 });

        await send("save");

        expect(controller.state.saveState).to.equal("savedReconciliationFailed");
        expect(controller.state.staged).to.deep.equal({});
        expect(controller.state.submittedSnapshot).to.exist;
        expect(controller.state.reconciliation).to.deep.equal([
            {
                rowId,
                kind: "update",
                status: "notProven",
                detail: "The save was acknowledged, but the server did not return a complete identity observation for this row. Generated values remain unverified.",
            },
        ]);

        await send("editCell", { rowId, column: "Name", value: "Unsafe follow-up" });
        expect(controller.state.staged).to.deep.equal({});

        await send("acceptReconciliation");
        expect(controller.state.saveState).to.equal("saved");
        expect(controller.state.submittedSnapshot).to.equal(undefined);
        await send("editCell", { rowId, column: "Name", value: "New draft" });
        expect(controller.state.staged[rowId].values).to.deep.equal({ Name: "New draft" });
    });
    test("acknowledged saves retain evidence when an observation is incomplete", async () => {
        const rowId = controller.state.rows[0].id;
        await send("editCell", { rowId, column: "Name", value: "Changed" });
        engine.commit.resolves({
            applied: 1,
            observations: [
                {
                    rowId,
                    kind: "update",
                    key: { Id: "1" },
                    incompleteColumns: ["Id"],
                },
            ],
        });

        await send("save");

        expect(controller.state.saveState).to.equal("savedReconciliationFailed");
        expect(controller.state.reconciliation?.[0]).to.deep.equal({
            rowId,
            kind: "update",
            status: "notProven",
            detail: "The save was acknowledged, but the returned row identity was incomplete. Generated values remain unverified.",
            serverKey: { Id: "1" },
        });
    });
    test("acknowledged saves retain evidence when the authoritative reread fails", async () => {
        const rowId = controller.state.rows[0].id;
        await send("editCell", { rowId, column: "Name", value: "Changed" });
        engine.commit.resolves({
            applied: 1,
            observations: [{ rowId, kind: "update", key: { Id: "1" } }],
        });
        engine.readCurrentRow.rejects(new Error("Read unavailable"));

        await send("save");

        expect(controller.state.saveState).to.equal("savedReconciliationFailed");
        expect(controller.state.reconciliation?.[0]).to.deep.equal({
            rowId,
            kind: "update",
            status: "unavailable",
            detail: "The server could not be read during reconciliation. The save outcome remains unknown.",
            serverKey: { Id: "1" },
        });
    });
    test("refresh verifies an acknowledged update before clearing reconciliation evidence", async () => {
        const rowId = controller.state.rows[0].id;
        await send("editCell", { rowId, column: "Name", value: "Changed" });
        engine.commit.resolves({
            applied: 1,
            observations: [{ rowId, kind: "update", key: { Id: "1" } }],
        });
        engine.readCurrentRow.onFirstCall().rejects(new Error("Read unavailable"));
        engine.readCurrentRow.resolves({
            values: { Id: "1", Name: "Changed" },
            cursor: { Id: "1" },
            hasTruncatedCells: false,
            incompleteColumns: [],
        });

        await send("save");
        expect(controller.state.saveState).to.equal("savedReconciliationFailed");
        await send("refresh");

        expect(engine.readCurrentRow).to.have.been.calledWith({ Id: "1" });
        expect(controller.state.saveState).to.equal("saved");
        expect(controller.state.reconciliation).to.equal(undefined);
        expect(controller.state.submittedSnapshot).to.equal(undefined);
    });
    test("refresh does not treat a missing observation as proof of an update", async () => {
        const rowId = controller.state.rows[0].id;
        await send("editCell", { rowId, column: "Name", value: "Changed" });
        engine.commit.resolves({ applied: 1 });
        engine.readCurrentRow.resolves({
            values: { Id: "1", Name: "Changed" },
            cursor: { Id: "1" },
            hasTruncatedCells: false,
            incompleteColumns: [],
        });

        await send("save");
        await send("refresh");

        expect(controller.state.saveState).to.equal("savedReconciliationFailed");
        expect(controller.state.reconciliation?.[0].status).to.equal("notProven");
        expect(controller.state.submittedSnapshot).to.exist;
    });
    test("refresh retains evidence for an insert without a stable identity", async () => {
        await send("addRow");
        const rowId = controller.state.rows.find((row) => row.isNew)!.id;
        await send("editCell", { rowId, column: "Name", value: "New" });
        engine.commit.resolves({ applied: 1 });

        await send("save");
        await send("refresh");

        expect(controller.state.saveState).to.equal("savedReconciliationFailed");
        expect(controller.state.reconciliation?.[0].status).to.equal("notProven");
        expect(controller.state.submittedSnapshot).to.exist;
    });
    test("explicit null is staged as a value rather than created by navigation", async () => {
        const rowId = controller.state.rows[0].id;
        await send("editCell", { rowId, column: "Name", value: null });
        expect(controller.state.staged[rowId].values).to.deep.equal({ Name: null });
    });
    test("explicit default is sent as a semantic value and can be reverted", async () => {
        const rowId = controller.state.rows[0].id;
        await send("setCellDefault", { rowId, column: "Name" });
        expect(controller.state.staged[rowId]).to.deep.equal({
            rowId,
            kind: "update",
            values: {},
            defaultColumns: ["Name"],
        });
        await send("save");
        expect(engine.commit.firstCall.args[0]).to.deep.equal([
            {
                rowId,
                kind: "update",
                values: { Name: DEFAULT_VALUE },
                original: { Id: "1", Name: "Original" },
            },
        ]);
    });
    test("save retains an immutable submitted snapshot while the commit is pending", async () => {
        const rowId = controller.state.rows[0].id;
        await send("setCellDefault", { rowId, column: "Name" });
        let finish!: (value: { applied: number }) => void;
        engine.commit.returns(
            new Promise((resolve) => {
                finish = resolve;
            }),
        );

        const saving = send("save");

        expect(controller.state.submittedSnapshot).to.deep.equal({
            operationId: controller.state.saveOperationId,
            revision: controller.state.submittedRevision,
            edits: [
                {
                    rowId,
                    kind: "update",
                    original: { Id: "1", Name: "Original" },
                    values: { Name: DEFAULT_VALUE },
                },
            ],
        });

        finish({ applied: 1 });
        await saving;
    });
    test("conflicts retain original, server and proposed values", async () => {
        const rowId = controller.state.rows[0].id;
        await send("editCell", { rowId, column: "Name", value: "Proposed" });
        engine.readCurrentRow.resolves({
            values: { Id: "1", Name: "Server" },
            cursor: { Id: "1" },
            hasTruncatedCells: false,
            incompleteColumns: [],
        });
        engine.commit.rejects(
            new EditCommitError("Conflict", {
                rowId,
                kind: "update",
                reason: "changedOrDeleted",
                message: "Conflict",
            }),
        );

        await send("save");

        expect(controller.state.conflicts).to.deep.equal([
            {
                rowId,
                kind: "update",
                serverState: "available",
                message: "The server value is shown alongside the original and proposed values.",
                original: { Id: "1", Name: "Original" },
                proposed: { Name: "Proposed" },
                serverValues: { Id: "1", Name: "Server" },
            },
        ]);
    });
    test("keeping the server value clears a conflict without staging an insert", async () => {
        const rowId = controller.state.rows[0].id;
        await send("editCell", { rowId, column: "Name", value: "Proposed" });
        engine.readCurrentRow.resolves({
            values: { Id: "1", Name: "Server" },
            cursor: { Id: "1" },
            hasTruncatedCells: false,
            incompleteColumns: [],
        });
        engine.commit.rejects(
            new EditCommitError("Conflict", {
                rowId,
                kind: "update",
                reason: "changedOrDeleted",
                message: "Conflict",
            }),
        );

        await send("save");
        await send("keepServer", { rowId });

        expect(controller.state.saveState).to.equal("clean");
        expect(controller.state.staged).to.deep.equal({});
        expect(controller.state.rows.find((row) => row.id === rowId)?.values.Name).to.equal(
            "Server",
        );
    });
    test("reapplying a conflict updates the baseline and never changes the operation kind", async () => {
        const rowId = controller.state.rows[0].id;
        await send("editCell", { rowId, column: "Name", value: "Proposed" });
        engine.readCurrentRow.resolves({
            values: { Id: "1", Name: "Server" },
            cursor: { Id: "1" },
            hasTruncatedCells: false,
            incompleteColumns: [],
        });
        engine.commit.rejects(
            new EditCommitError("Conflict", {
                rowId,
                kind: "update",
                reason: "changedOrDeleted",
                message: "Conflict",
            }),
        );

        await send("save");
        await send("reapplyConflict", { rowId });
        expect(controller.state.saveState).to.equal("pending");

        engine.commit.resetBehavior();
        engine.commit.resolves({
            applied: 1,
            observations: [{ rowId, kind: "update", key: { Id: "1" } }],
        });
        engine.readCurrentRow.resolves({
            values: { Id: "1", Name: "Proposed" },
            cursor: { Id: "1" },
            hasTruncatedCells: false,
            incompleteColumns: [],
        });
        await send("save");

        expect(engine.commit.secondCall.args[0]).to.deep.equal([
            {
                rowId,
                kind: "update",
                values: { Name: "Proposed" },
                original: { Id: "1", Name: "Server" },
            },
        ]);
    });
    test("a concurrent deletion offers keep-server without converting the draft to an insert", async () => {
        const rowId = controller.state.rows[0].id;
        await send("editCell", { rowId, column: "Name", value: "Proposed" });
        engine.readCurrentRow.resolves(undefined);
        engine.commit.rejects(
            new EditCommitError("Conflict", {
                rowId,
                kind: "update",
                reason: "changedOrDeleted",
                message: "Conflict",
            }),
        );

        await send("save");
        expect(controller.state.conflicts?.[0].serverState).to.equal("missing");
        await send("keepServer", { rowId });

        expect(controller.state.staged).to.deep.equal({});
        expect(controller.state.rows.some((row) => row.id === rowId)).to.equal(false);
    });
    test("matching reconciliation evidence does not clear an unknown save", async () => {
        const rowId = controller.state.rows[0].id;
        await send("editCell", { rowId, column: "Name", value: "Changed" });
        engine.commit.rejects(
            new SqlExecutionError("Connection lost", "connectionLost", "unknown"),
        );
        engine.readCurrentRow.resolves({
            values: { Id: "1", Name: "Changed" },
            cursor: { Id: "1" },
            hasTruncatedCells: false,
            incompleteColumns: [],
        });

        await send("save");
        await send("reconcile");

        expect(controller.state.saveState).to.equal("unknown");
        expect(controller.state.staged[rowId].values).to.deep.equal({ Name: "Changed" });
        expect(controller.state.reconciliation).to.deep.equal([
            {
                rowId,
                kind: "update",
                status: "observedMatching",
                detail: "The current row matches the submitted values, but matching values alone do not prove this save was applied.",
                serverKey: { Id: "1" },
                serverValues: { Id: "1", Name: "Changed" },
            },
        ]);
    });
    test("incomplete cells cannot be assigned a default through RPC", async () => {
        const rowId = controller.state.rows[0].id;
        controller.state.rows[0].incompleteColumns = ["Name"];
        await send("setCellDefault", { rowId, column: "Name" });
        expect(controller.state.staged).to.deep.equal({});
    });
    test("submitted save blocks edits, discard and duplicate save until acknowledged", async () => {
        const rowId = controller.state.rows[0].id;
        await send("editCell", { rowId, column: "Name", value: "Changed" });
        let finish!: (value: { applied: number }) => void;
        engine.commit.returns(
            new Promise((resolve) => {
                finish = resolve;
            }),
        );
        const saving = send("save");
        await send("editCell", { rowId, column: "Name", value: "Lost" });
        await send("discardAll");
        await send("addRow");
        await send("save");
        expect(controller.state.staged[rowId].values).to.deep.equal({ Name: "Changed" });
        expect(controller.state.rows).to.have.length(1);
        finish({ applied: 1 });
        await saving;
        expect(controller.state.staged).to.deep.equal({});
    });
    test("failed save keeps off-page drafts available for correction", async () => {
        const rowId = controller.state.rows[0].id;
        await send("editCell", { rowId, column: "Name", value: "Changed" });
        engine.readPage.resolves(page("2", "Other"));
        await send("nextPage");
        engine.commit.rejects(new Error("Constraint rejected"));
        await send("save");
        expect(controller.state.saveState).to.equal("failed");
        expect(controller.state.staged[rowId].values).to.deep.equal({ Name: "Changed" });
    });
    test("restoring a closed dirty editor keeps its staged draft", async () => {
        const rowId = controller.state.rows[0].id;
        await send("editCell", { rowId, column: "Name", value: "Changed" });
        expect((controller as any)._options.showRestorePromptAfterClose).to.equal(true);

        const panel = (vscode.window.createWebviewPanel as sinon.SinonStub).firstCall
            .returnValue as vscode.WebviewPanel;
        const disposeHandler = (panel.onDidDispose as sinon.SinonStub).firstCall
            .args[0] as () => Promise<void>;
        const showInformationMessage = sandbox
            .stub(vscode.window, "showInformationMessage")
            .callsFake((...args: any[]) => Promise.resolve(args[2]));

        await disposeHandler();

        expect(showInformationMessage).to.have.been.calledOnce;
        expect(vscode.window.createWebviewPanel).to.have.been.calledTwice;
        expect(controller.state.staged[rowId].values).to.deep.equal({ Name: "Changed" });
    });
    test("a late page response cannot replace a newer refresh", async () => {
        engine.readPage.resetHistory();
        let finish!: (value: ReturnType<typeof page>) => void;
        engine.readPage.onFirstCall().returns(
            new Promise((resolve) => {
                finish = resolve;
            }),
        );
        engine.readPage.onSecondCall().resolves(page("1", "Fresh"));
        const older = send("nextPage");
        await send("refresh");
        finish(page("2", "Stale"));
        await older;
        expect(controller.state.pageIndex).to.equal(0);
        expect(controller.state.rows[0].values.Name).to.equal("Fresh");
    });
    test("post-save read failure does not restore already acknowledged edits", async () => {
        const rowId = controller.state.rows[0].id;
        await send("editCell", { rowId, column: "Name", value: "Changed" });
        engine.readPage.rejects(new Error("Refresh unavailable"));
        await send("save");
        expect(controller.state.saveState).to.equal("savedReloadFailed");
        expect(controller.state.staged).to.deep.equal({});
        expect(controller.state.loadError).to.equal("Refresh unavailable");

        const readsAfterSave = engine.readPage.callCount;
        await send("editCell", { rowId, column: "Name", value: "New draft" });
        await send("addRow");
        await send("discardAll");
        await send("setFilters", {
            filters: [{ column: "Name", operator: "equals", value: "New draft" }],
        });
        expect(controller.state.staged).to.deep.equal({});
        expect(controller.state.rows).to.have.length(1);
        expect(engine.readPage.callCount).to.equal(readsAfterSave);
    });
});
