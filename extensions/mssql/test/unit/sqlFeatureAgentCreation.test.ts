/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import * as sinon from "sinon";
import * as jsonRpc from "vscode-jsonrpc/node";
import { expect } from "chai";
import { capabilitiesFrom, SqlExecutionError } from "sql-feature/core";
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

suite("SQL feature Agent creation review", () => {
    let sandbox: sinon.SinonSandbox;
    let controller: SqlDiagnosticsWebviewController;
    let runner: sinon.SinonStubbedInstance<DataPlaneRunner>;
    let handlers: ReturnType<typeof stubWebviewConnectionRpc>["requestHandlers"];
    let review: sinon.SinonStub;
    let actionReview: sinon.SinonStub;
    const id = "01234567-89ab-cdef-0123-456789abcdef";
    const request = {
        name: "Test job",
        description: "",
        enabled: false,
        schedule: {
            name: "Test schedule",
            kind: "daily" as const,
            startDate: "2028-01-01",
            startTime: "00:00",
            every: 2,
        },
        steps: [
            {
                name: "Step",
                command: " SELECT 1;\n",
                database: "master",
                retryAttempts: 3,
                retryIntervalMinutes: 5,
            },
        ],
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
        actionReview = sandbox.stub(vscode.window, "showWarningMessage").resolves(undefined);
        runner = sandbox.createStubInstance(DataPlaneRunner);
        runner.capabilities.resolves(
            capabilitiesFrom({ engineEditionId: 3, majorVersion: 16, database: "master" }),
        );
        runner.query.resolves({ columns: [], rows: [], truncated: false });
        runner.query
            .withArgs(sinon.match.string, sinon.match({ tag: "agent.actionPreflight" }))
            .resolves({
                columns: [],
                rows: [{ job_id: id, name: "Renamed job", version_number: 1, is_admin: 1 }],
                truncated: false,
            });
        controller = new SqlDiagnosticsWebviewController(
            stubExtensionContext(sandbox),
            runner,
            "Fixture",
            "agent",
            async () => {},
        );
        await new Promise<void>((resolve) => setImmediate(resolve));
        runner.query.resetHistory();
    });
    teardown(() => {
        controller?.dispose();
        sandbox.restore();
    });
    async function create(): Promise<unknown> {
        const handler = handlers.get("action") as unknown as (action: unknown) => Promise<unknown>;
        return handler({ type: "createJob", payload: { request } });
    }
    test("canceling review executes no SQL and leaves creation available", async () => {
        await create();
        expect(runner.query).not.to.have.been.called;
        expect(controller.state.jobCreation).to.deep.equal({ busy: false, error: undefined });
        expect(review).to.have.been.calledWith(
            SqlFeatures.reviewJob(request.name),
            sinon.match({ detail: sinon.match.string }),
        );
    });
    test("creation rejects a missing step database before review", async () => {
        const handler = handlers.get("action") as unknown as (action: unknown) => Promise<unknown>;
        await handler({
            type: "createJob",
            payload: {
                request: {
                    ...request,
                    steps: [{ ...request.steps[0], database: "" }],
                },
            },
        });

        expect(review).not.to.have.been.called;
        expect(runner.query).not.to.have.been.called;
        expect(controller.state.errorMessage).to.equal(SqlFeatures.jobDatabaseRequired);
    });
    test("generating SQL opens the reviewed script without executing it", async () => {
        review.resolves(SqlFeatures.generateSql);
        const document = { uri: vscode.Uri.parse("untitled:job.sql") } as vscode.TextDocument;
        const open = sandbox.stub(vscode.workspace, "openTextDocument").resolves(document);
        sandbox.stub(vscode.window, "showTextDocument").resolves();
        await create();
        expect(runner.query).not.to.have.been.called;
        expect(open).to.have.been.calledWith(
            sinon.match({ language: "sql", content: sinon.match(" SELECT 1;\n") }),
        );
        expect(controller.state.jobCreation?.createdJobId).to.equal(undefined);
    });
    test("acknowledged creation retains the server job ID", async () => {
        review.resolves(SqlFeatures.apply);
        runner.query
            .withArgs(sinon.match.string, sinon.match({ tag: "agent.createJob" }))
            .resolves({ columns: [], rows: [{ job_id: id }], truncated: false });
        await create();
        expect(runner.query).to.have.been.calledWith(
            sinon
                .match("@retry_attempts = 3")
                .and(sinon.match("@retry_interval = 5"))
                .and(sinon.match("sp_add_jobschedule"))
                .and(sinon.match("@freq_interval = 2")),
            sinon.match({ tag: "agent.createJob" }),
        );
        expect(controller.state.jobCreation).to.deep.equal({
            busy: false,
            createdJobId: id,
            error: undefined,
        });
    });
    test("unknown execution outcome preserves a visible error without claiming creation", async () => {
        review.resolves(SqlFeatures.apply);
        runner.query.rejects(
            new SqlExecutionError(
                "Connection lost; check jobs before retrying",
                "connectionLost",
                "unknown",
            ),
        );
        await create();
        expect(controller.state.jobCreation?.busy).to.equal(false);
        expect(controller.state.jobCreation?.error).to.contain("check jobs before retrying");
        expect(controller.state.jobCreation?.createdJobId).to.equal(undefined);
    });
    test("a second submission while review is open cannot create another operation", async () => {
        let finish!: (value: undefined) => void;
        review.returns(
            new Promise<undefined>((resolve) => {
                finish = resolve;
            }),
        );
        const first = create();
        await create();
        expect(controller.state.jobCreation?.busy).to.equal(true);
        finish(undefined);
        await first;
        expect(runner.query).not.to.have.been.called;
        expect(controller.state.jobCreation?.busy).to.equal(false);
    });
    test("service-monitoring failure does not hide readable jobs or imply Agent is stopped", async () => {
        runner.query
            .withArgs(sinon.match.string, sinon.match({ tag: "agent.access" }))
            .resolves({ columns: [], rows: [{ is_user: 1 }], truncated: false });
        runner.query
            .withArgs(sinon.match.string, sinon.match({ tag: "agent.serviceReadiness" }))
            .rejects(new Error("Service monitoring permission denied"));
        const handler = handlers.get("action") as unknown as (action: unknown) => Promise<unknown>;
        await handler({ type: "recheckAgent", payload: {} });
        expect(controller.state.agentReadiness).to.include({
            supported: true,
            service: "unknown",
            visibility: "owned",
        });
        expect(controller.state.agentReadiness?.serviceError).to.equal(
            "Service monitoring permission denied",
        );
        expect(controller.state.agentReadiness?.jobsError).to.equal(undefined);
        expect(controller.state.agentReadinessBusy).to.equal(false);
    });
    test("job visibility failure is not presented as an empty successful list", async () => {
        runner.query
            .withArgs(sinon.match.string, sinon.match({ tag: "agent.jobs" }))
            .rejects(new Error("The SELECT permission was denied."));

        const handler = handlers.get("action") as unknown as (action: unknown) => Promise<unknown>;
        await handler({ type: "recheckAgent", payload: {} });

        expect(controller.state.jobOptions).to.deep.equal([]);
        expect(controller.state.agentReadiness?.jobsError).to.contain("permission");
    });
    test("starting a job requires review and reports acceptance rather than execution success", async () => {
        controller.state.jobOptions = [{ id, name: "Renamed job" }];
        actionReview.resolves(SqlFeatures.apply);
        const handler = handlers.get("action") as unknown as (action: unknown) => Promise<unknown>;
        await handler({ type: "jobAction", payload: { jobId: id, action: "start" } });
        expect(actionReview).to.have.been.calledWith(
            SqlFeatures.reviewJobAction(SqlFeatures.agentActions.start, "Renamed job"),
        );
        expect(runner.query).to.have.been.calledWith(
            sinon.match("sp_start_job").and(sinon.match(id)),
            sinon.match({ tag: "agent.start" }),
        );
        expect(review).to.have.been.calledWith(
            SqlFeatures.agentActionAccepted(SqlFeatures.agentActions.start, "Renamed job"),
        );
        expect(controller.state.jobActionBusy).to.equal(false);
    });
    test("canceling a delete review preserves the job without executing SQL", async () => {
        controller.state.jobOptions = [{ id, name: "Job" }];
        const handler = handlers.get("action") as unknown as (action: unknown) => Promise<unknown>;
        await handler({ type: "jobAction", payload: { jobId: id, action: "delete" } });
        expect(runner.query).not.to.have.been.calledWith(
            sinon.match.string,
            sinon.match({ tag: "agent.delete" }),
        );
        expect(controller.state.jobActionBusy).to.equal(false);
    });
    test("uncertain job action outcome remains an error instead of an accepted request", async () => {
        controller.state.jobOptions = [{ id, name: "Job" }];
        actionReview.resolves(SqlFeatures.apply);
        runner.query.rejects(
            new SqlExecutionError("Check job status before retrying", "connectionLost", "unknown"),
        );
        const handler = handlers.get("action") as unknown as (action: unknown) => Promise<unknown>;
        await handler({ type: "jobAction", payload: { jobId: id, action: "start" } });
        expect(review).not.to.have.been.called;
        expect(controller.state.errorMessage).to.equal("Check job status before retrying");
        expect(controller.state.jobActionBusy).to.equal(false);
    });
    test("definition changes during review prevent mutation", async () => {
        controller.state.jobOptions = [{ id, name: "Job" }];
        actionReview.resolves(SqlFeatures.apply);
        const preflight = runner.query.withArgs(
            sinon.match.string,
            sinon.match({ tag: "agent.actionPreflight" }),
        );
        preflight.onFirstCall().resolves({
            columns: [],
            rows: [{ job_id: id, name: "Job", version_number: 1, is_admin: 1 }],
            truncated: false,
        });
        preflight.onSecondCall().resolves({
            columns: [],
            rows: [{ job_id: id, name: "Job", version_number: 2, is_admin: 1 }],
            truncated: false,
        });
        const handler = handlers.get("action") as unknown as (action: unknown) => Promise<unknown>;
        await handler({ type: "jobAction", payload: { jobId: id, action: "enable" } });
        expect(runner.query).not.to.have.been.calledWith(
            sinon.match.string,
            sinon.match({ tag: "agent.enable" }),
        );
        expect(controller.state.errorMessage).to.equal(SqlFeatures.jobChangedDuringReview);
    });
    test("unestablished per-job permission offers a script without applying", async () => {
        controller.state.jobOptions = [{ id, name: "Job" }];
        actionReview.resolves(SqlFeatures.apply);
        runner.query
            .withArgs(sinon.match.string, sinon.match({ tag: "agent.actionPreflight" }))
            .resolves({
                columns: [],
                rows: [
                    {
                        job_id: id,
                        name: "Job",
                        is_reader: 1,
                        is_owner: 0,
                        is_local: 1,
                        can_delete: 1,
                    },
                ],
                truncated: false,
            });
        const handler = handlers.get("action") as unknown as (action: unknown) => Promise<unknown>;
        await handler({ type: "jobAction", payload: { jobId: id, action: "delete" } });
        expect(actionReview).to.have.been.calledWith(
            SqlFeatures.reviewJobAction(SqlFeatures.agentActions.delete, "Job"),
            sinon.match.object,
            SqlFeatures.generateSql,
        );
        expect(runner.query).not.to.have.been.calledWith(
            sinon.match.string,
            sinon.match({ tag: "agent.delete" }),
        );
    });
});
