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
import {
    stubExtensionContext,
    stubLogger,
    stubTelemetry,
    stubWebviewConnectionRpc,
    stubWebviewPanel,
} from "./utils";

suite("SQL feature DMV controller", () => {
    let sandbox: sinon.SinonSandbox;
    let controller: SqlDiagnosticsWebviewController;
    let runner: sinon.SinonStubbedInstance<DataPlaneRunner>;
    let handlers: ReturnType<typeof stubWebviewConnectionRpc>["requestHandlers"];

    setup(async () => {
        sandbox = sinon.createSandbox();
        stubTelemetry(sandbox);
        stubLogger(sandbox);
        const rpc = stubWebviewConnectionRpc(sandbox);
        handlers = rpc.requestHandlers;
        sandbox.stub(jsonRpc, "createMessageConnection").returns(rpc.connection);
        sandbox.stub(vscode.window, "createWebviewPanel").returns(stubWebviewPanel(sandbox));
        runner = sandbox.createStubInstance(DataPlaneRunner);
        runner.capabilities.resolves(
            capabilitiesFrom({ engineEditionId: 3, majorVersion: 16, database: "AppDb" }),
        );
        runner.query.resolves({
            columns: [],
            rows: [{ view_server_state: 1, view_database_state: 1 }],
            truncated: false,
        });
        controller = new SqlDiagnosticsWebviewController(
            stubExtensionContext(sandbox),
            runner,
            "Fixture",
            "dmv",
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

    test("failed overview evidence is unavailable instead of a successful empty result", async () => {
        runner.query.rejects(new Error("overview collector timed out"));

        await action("runQuery", { queryId: "dmv.overview" });

        expect(controller.state.result).to.equal(undefined);
        expect(controller.state.errorMessage).to.equal("overview collector timed out");
        expect(controller.state.dmvReadiness?.collectors.overview).to.deep.include({
            status: "failed",
            error: "overview collector timed out",
        });
        expect(controller.state.dmvReadiness?.collectors.workload.status).to.equal("ready");
        expect(controller.state.dmvReadiness?.status).to.equal("partial");
    });

    test("default workload row cap is disclosed in the evidence snapshot", async () => {
        await action("runQuery", { queryId: "dmv.topWorkload" });

        expect(controller.state.result?.snapshot.rowLimit).to.equal(50);
    });
});
