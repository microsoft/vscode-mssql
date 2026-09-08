/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import * as sinon from "sinon";
import * as jsonRpc from "vscode-jsonrpc/node";
import { expect } from "chai";
import { capabilitiesFrom } from "sql-feature/core";
import { SqlDiagnosticsWebviewController } from "../../src/sqlDiagnostics/sqlDiagnosticsWebviewController";
import { DataPlaneRunner } from "../../src/sqlDiagnostics/dataPlaneRunner";
import { SqlFeatures } from "../../src/constants/locConstants";
import {
    stubExtensionContext,
    stubLogger,
    stubTelemetry,
    stubWebviewConnectionRpc,
    stubWebviewPanel,
} from "./utils";

suite("SQL feature Query Store controller", () => {
    let sandbox: sinon.SinonSandbox;
    let controller: SqlDiagnosticsWebviewController;
    let runner: sinon.SinonStubbedInstance<DataPlaneRunner>;
    let handlers: ReturnType<typeof stubWebviewConnectionRpc>["requestHandlers"];
    let review: sinon.SinonStub;
    let maintenanceReview: sinon.SinonStub;

    const collectingState = {
        actual_state: 2,
        desired_state: 2,
        can_read_history: 1,
        can_configure: 1,
        readonly_reason: 0,
        query_capture_mode_desc: "AUTO",
        size_based_cleanup_mode_desc: "AUTO",
        wait_stats_capture_mode_desc: "ON",
        current_storage_size_mb: 8,
        max_storage_size_mb: 1024,
        interval_length_minutes: 15,
        flush_interval_seconds: 900,
        stale_query_threshold_days: 30,
    };

    setup(async () => {
        sandbox = sinon.createSandbox();
        stubTelemetry(sandbox);
        stubLogger(sandbox);
        const rpc = stubWebviewConnectionRpc(sandbox);
        handlers = rpc.requestHandlers;
        sandbox.stub(jsonRpc, "createMessageConnection").returns(rpc.connection);
        sandbox.stub(vscode.window, "createWebviewPanel").returns(stubWebviewPanel(sandbox));
        review = sandbox.stub(vscode.window, "showInformationMessage").resolves(undefined);
        maintenanceReview = sandbox.stub(vscode.window, "showWarningMessage").resolves(undefined);
        runner = sandbox.createStubInstance(DataPlaneRunner);
        runner.capabilities.resolves(
            capabilitiesFrom({ engineEditionId: 3, majorVersion: 16, database: "AppDb" }),
        );
        runner.query.resolves({ columns: [], rows: [collectingState], truncated: false });
        controller = new SqlDiagnosticsWebviewController(
            stubExtensionContext(sandbox),
            runner,
            "Fixture",
            "querystore",
            async () => {},
        );
        await new Promise<void>((resolve) => setImmediate(resolve));
        runner.query.resetHistory();
    });

    teardown(() => {
        controller?.dispose();
        sandbox.restore();
    });

    function action(type: string, payload: Record<string, unknown>): Promise<unknown> {
        const handler = handlers.get("action") as unknown as (value: unknown) => Promise<unknown>;
        return handler({ type, payload });
    }

    test("canceling settings review does not execute the reviewed change", async () => {
        await action("setQueryStore", { enabled: true });

        expect(runner.query).not.to.have.been.calledWith(
            sinon.match.string,
            sinon.match({ tag: "sqlDiag.setQueryStore" }),
        );
        expect(controller.state.errorMessage).to.equal(undefined);
    });

    test("settings drift between review and apply blocks the mutation", async () => {
        review.resolves(SqlFeatures.apply);
        const stateQuery = runner.query.withArgs(
            sinon.match.string,
            sinon.match({ tag: "sqlDiag.queryStoreState" }),
        );
        stateQuery.onSecondCall().resolves({
            columns: [],
            rows: [{ ...collectingState, desired_state: 1 }],
            truncated: false,
        });

        await action("setQueryStore", { enabled: true });

        expect(runner.query).not.to.have.been.calledWith(
            sinon.match.string,
            sinon.match({ tag: "sqlDiag.setQueryStore" }),
        );
        expect(controller.state.errorMessage).to.equal(SqlFeatures.queryStoreStateChanged);
    });

    test("disable records a verified outcome only after actual state is off", async () => {
        maintenanceReview.resolves(SqlFeatures.apply);
        const stateQuery = runner.query.withArgs(
            sinon.match.string,
            sinon.match({ tag: "sqlDiag.queryStoreState" }),
        );
        stateQuery.onThirdCall().resolves({
            columns: [],
            rows: [{ ...collectingState, actual_state: 0, desired_state: 0 }],
            truncated: false,
        });

        await action("queryStoreMaintenance", { action: "disable" });

        expect(runner.query).to.have.been.calledWith(
            sinon.match.string,
            sinon.match({ tag: "sqlDiag.queryStore.disable" }),
        );
        expect(controller.state.queryStoreMaintenance).to.deep.equal({
            action: "disable",
            outcome: "verified",
        });
        expect(controller.state.errorMessage).to.equal(undefined);
    });

    test("flush records an accepted but unverified outcome", async () => {
        maintenanceReview.resolves(SqlFeatures.apply);

        await action("queryStoreMaintenance", { action: "flush" });

        expect(runner.query).to.have.been.calledWith(
            sinon.match.string,
            sinon.match({ tag: "sqlDiag.queryStore.flush" }),
        );
        expect(controller.state.queryStoreMaintenance).to.deep.equal({
            action: "flush",
            outcome: "acceptedUnverified",
        });
        expect(controller.state.errorMessage).to.equal(undefined);
    });
});
