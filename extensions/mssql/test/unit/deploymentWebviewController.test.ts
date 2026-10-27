/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as chai from "chai";
import * as sinon from "sinon";
import sinonChai from "sinon-chai";
import { DeploymentWebviewController } from "../../src/deployment/deploymentWebviewController";
import * as localContainers from "../../src/deployment/localContainersHelpers";
import { DeploymentWebviewState } from "../../src/sharedInterfaces/deployment";
import { LocalContainersState } from "../../src/sharedInterfaces/localContainers";
import { stubTelemetry } from "./utils";
import * as vscode from "vscode";
import { previewService } from "../../src/previews/previewService";
import MainController from "../../src/controllers/mainController";
import ConnectionManager from "../../src/controllers/connectionManager";
import { ConnectionStore } from "../../src/models/connectionStore";
import SqlToolsServiceClient from "../../src/languageservice/serviceclient";
import * as azureSql from "../../src/deployment/azureSqlHelpers";
import * as logger from "../../src/models/logger";
import { AzureSqlDatabaseRequests } from "../../src/sharedInterfaces/azureSqlDatabase";
import { TelemetryActions, TelemetryViews } from "../../src/sharedInterfaces/telemetry";
import { LocalDatabaseDeploymentService } from "../../src/deployment/localDatabaseDeployment";
import { LocalDatabaseCompatibilityService } from "../../src/deployment/localDatabaseCompatibility";
import { LocalToCloud } from "../../src/constants/locConstants";

chai.use(sinonChai);
const { expect } = chai;

suite("Deployment dialog closing", () => {
    let sandbox: sinon.SinonSandbox;
    let controller: sinon.SinonStubbedInstance<DeploymentWebviewController>;
    let closePanel: sinon.SinonStub;
    let close: (state: DeploymentWebviewState, payload: {}) => Promise<DeploymentWebviewState>;
    let telemetry: ReturnType<typeof stubTelemetry>;

    setup(() => {
        sandbox = sinon.createSandbox();
        telemetry = stubTelemetry(sandbox);
        controller = sandbox.createStubInstance(DeploymentWebviewController);
        closePanel = sandbox.stub();
        sandbox.stub(controller, "panel").get(() => ({ dispose: closePanel }));
        DeploymentWebviewController.prototype["registerRpcHandlers"].call(controller);
        close = controller.registerReducer.getCalls().find((call) => call.args[0] === "dispose")!
            .args[1] as typeof close;
    });

    function registerLocalWizardHandlers() {
        sandbox.stub(previewService, "azureSqlContainersEnabled").get(() => true);
        sandbox.stub(azureSql, "registerAzureSqlRpcHandlers");
        const client = sandbox.createStubInstance(SqlToolsServiceClient);
        sandbox.stub(SqlToolsServiceClient, "instance").get(() => client);
        const output: vscode.LogOutputChannel = {
            name: "test",
            append: sandbox.stub(),
            appendLine: sandbox.stub(),
            replace: sandbox.stub(),
            clear: sandbox.stub(),
            show: () => {},
            hide: sandbox.stub(),
            dispose: sandbox.stub(),
            logLevel: vscode.LogLevel.Info,
            onDidChangeLogLevel: sandbox.stub(),
            trace: sandbox.stub(),
            debug: sandbox.stub(),
            info: sandbox.stub(),
            warn: sandbox.stub(),
            error: sandbox.stub(),
        };
        sandbox.stub(logger, "getMssqlOutputChannel").returns(output);
        const controller = sandbox.createStubInstance(DeploymentWebviewController);
        const disposables: vscode.Disposable[] = [];
        controller["registerDisposable"] = (disposable) => {
            disposables.push(disposable);
        };
        const main = sandbox.createStubInstance(MainController);
        const manager = sandbox.createStubInstance(ConnectionManager);
        const store = sandbox.createStubInstance(ConnectionStore);
        store.readAllConnections.resolves([]);
        sandbox.stub(manager, "connectionStore").get(() => store);
        sandbox.stub(manager, "activeConnections").get(() => ({}));
        sandbox.stub(main, "connectionManager").get(() => manager);
        controller.mainController = main;
        DeploymentWebviewController.prototype["registerRpcHandlers"].call(controller);
        return { controller, disposables };
    }

    test("records opening once across source refreshes and closing when the panel is disposed", async () => {
        const { controller, disposables } = registerLocalWizardHandlers();
        const handler = controller.onRequest
            .getCalls()
            .find(
                (call) =>
                    call.args[0].method === AzureSqlDatabaseRequests.GetLocalDatabaseSources.method,
            )!.args[1];
        const token: vscode.CancellationToken = {
            isCancellationRequested: false,
            onCancellationRequested: sandbox.stub(),
        };
        await handler(undefined, token);
        expect(telemetry.sendActionEvent).to.have.been.calledWith(
            TelemetryViews.LocalToCloudDeployment,
            TelemetryActions.Open,
        );
        const opened = telemetry.sendActionEvent.getCalls().map((call) => call.args);
        await handler(undefined, token);
        expect(telemetry.sendActionEvent.getCalls().map((call) => call.args)).to.deep.equal(opened);
        for (const disposable of disposables) {
            disposable.dispose();
        }
        expect(telemetry.sendActionEvent).to.have.been.calledWith(
            TelemetryViews.LocalToCloudDeployment,
            TelemetryActions.Close,
            sinon.match({ additionalMeasurements: { durationInMs: sinon.match.number } }),
        );
    });

    test("stale compatibility cleanup cannot invalidate a running deployment", async () => {
        const { controller } = registerLocalWizardHandlers();
        let running = true;
        sandbox.stub(LocalDatabaseDeploymentService.prototype, "isRunning").get(() => running);
        const cancel = sandbox
            .stub(LocalDatabaseCompatibilityService.prototype, "cancel")
            .resolves();
        const clear = sandbox.stub(LocalDatabaseCompatibilityService.prototype, "clear").resolves();
        const validate = sandbox.stub(LocalDatabaseCompatibilityService.prototype, "validate");
        const token: vscode.CancellationToken = {
            isCancellationRequested: false,
            onCancellationRequested: sandbox.stub(),
        };
        const handler = (method: string) =>
            controller.onRequest.getCalls().find((call) => call.args[0].method === method)!.args[1];
        await handler(AzureSqlDatabaseRequests.CancelLocalDatabaseCompatibility.method)(
            { validationId: "validation" },
            token,
        );
        await handler(AzureSqlDatabaseRequests.ClearLocalDatabaseCompatibility.method)(
            undefined,
            token,
        );
        expect(cancel).not.to.have.been.called;
        expect(clear).not.to.have.been.called;
        expect(() =>
            handler(AzureSqlDatabaseRequests.ValidateLocalDatabaseCompatibility.method)(
                { validationId: "validation" },
                token,
            ),
        ).to.throw(LocalToCloud.invalidDeployment);
        expect(validate).not.to.have.been.called;
        running = false;
        await handler(AzureSqlDatabaseRequests.CancelLocalDatabaseCompatibility.method)(
            { validationId: "validation" },
            token,
        );
        await handler(AzureSqlDatabaseRequests.ClearLocalDatabaseCompatibility.method)(
            undefined,
            token,
        );
        expect(cancel).to.have.been.calledWith("validation");
        expect(clear).to.have.been.called;
    });

    teardown(() => sandbox.restore());

    test("Finish closes the Azure container dialog without legacy Docker state", async () => {
        const telemetry = sandbox.spy(localContainers, "sendLocalContainersCloseEventTelemetry");
        const state = new DeploymentWebviewState();

        expect(await close(state, {})).to.equal(state);

        expect(telemetry).not.to.have.been.called;
        expect(closePanel).to.have.been.called;
        expect(controller.dispose).to.have.been.called;
    });

    test("closing initialized local containers still sends close telemetry", async () => {
        const telemetry = sandbox.spy(localContainers, "sendLocalContainersCloseEventTelemetry");
        const state = new DeploymentWebviewState();
        state.deploymentTypeState = new LocalContainersState();

        await close(state, {});

        expect(telemetry).to.have.been.calledWith(state.deploymentTypeState);
        expect(closePanel).to.have.been.called;
        expect(controller.dispose).to.have.been.called;
    });

    test("telemetry failure does not prevent the dialog from closing", async () => {
        const error = new Error("Telemetry failed");
        sandbox.stub(localContainers, "sendLocalContainersCloseEventTelemetry").throws(error);
        const state = new DeploymentWebviewState();
        state.deploymentTypeState = new LocalContainersState();
        let reportedError: unknown;

        try {
            await close(state, {});
        } catch (caught) {
            reportedError = caught;
        }

        expect(reportedError).to.equal(error);
        expect(closePanel).to.have.been.called;
        expect(controller.dispose).to.have.been.called;
    });
});
