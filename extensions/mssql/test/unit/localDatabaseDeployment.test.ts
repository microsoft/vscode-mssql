/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as chai from "chai";
import * as sinon from "sinon";
import sinonChai from "sinon-chai";
import * as vscode from "vscode";
import { promises as fs } from "node:fs";
import * as path from "node:path";
import type { SimpleExecuteResult, DacFxResult } from "vscode-mssql";
import { KnownFreeLimitExhaustionBehavior } from "@azure/arm-sql";
import MainController from "../../src/controllers/mainController";
import ConnectionManager, { ConnectionInfo } from "../../src/controllers/connectionManager";
import { ConnectionProfile } from "../../src/models/connectionProfile";
import { ConnectionUI } from "../../src/views/connectionUI";
import { TreeNodeInfo } from "../../src/objectExplorer/nodes/treeNodeInfo";
import SqlToolsServiceClient from "../../src/languageservice/serviceclient";
import { DacFxService } from "../../src/services/dacFxService";
import {
    SqlTasksService,
    taskCreatedEmitter,
    taskProgressEmitter,
    TaskStatus,
    TaskInfo,
} from "../../src/services/sqlTasksService";
import { LocalDatabaseDeploymentService } from "../../src/deployment/localDatabaseDeployment";
import { LocalDatabaseCompatibilityService } from "../../src/deployment/localDatabaseCompatibility";
import { DeploymentWebviewController } from "../../src/deployment/deploymentWebviewController";
import { VsCodeAzureHelper } from "../../src/connectionconfig/azureHelpers";
import * as cloud from "../../src/azure/providerSettings";
import * as entra from "../../src/azure/vscodeEntraMfaUtils";
import { AuthenticationType } from "../../src/sharedInterfaces/connectionDialog";
import {
    AzureSqlDatabaseState,
    LocalDatabaseDeploymentRequest,
    LocalDatabaseDeploymentProgress,
} from "../../src/sharedInterfaces/azureSqlDatabase";
import { DeploymentType, DeploymentWebviewState } from "../../src/sharedInterfaces/deployment";
import { ApiStatus } from "../../src/sharedInterfaces/webview";
import { TaskExecutionMode } from "../../src/enums";
import * as Constants from "../../src/constants/constants";
import { LocalToCloud } from "../../src/constants/locConstants";
import { stubLogger, stubTelemetry } from "./utils";
import { TelemetryActions, TelemetryViews } from "../../src/sharedInterfaces/telemetry";
import { mockSubscriptions } from "./azureHelperStubs";
import {
    BackgroundTasksService,
    BackgroundTaskState,
} from "../../src/backgroundTasks/backgroundTasksService";

chai.use(sinonChai);
const { expect } = chai;

function rows(values: string[][]): SimpleExecuteResult {
    return {
        rowCount: values.length,
        columnInfo: [],
        rows: values.map((row) => row.map((displayValue) => ({ displayValue, isNull: false }))),
    };
}

suite("Local database Azure SQL deployment", () => {
    let sandbox: sinon.SinonSandbox;
    let controller: sinon.SinonStubbedInstance<DeploymentWebviewController>;
    let main: sinon.SinonStubbedInstance<MainController>;
    let manager: sinon.SinonStubbedInstance<ConnectionManager>;
    let client: sinon.SinonStubbedInstance<SqlToolsServiceClient>;
    let dacFx: sinon.SinonStubbedInstance<DacFxService>;
    let compatibility: sinon.SinonStubbedInstance<LocalDatabaseCompatibilityService>;
    let connectionUI: sinon.SinonStubbedInstance<ConnectionUI>;
    let output: vscode.OutputChannel;
    let state: AzureSqlDatabaseState;
    let service: LocalDatabaseDeploymentService;
    let request: LocalDatabaseDeploymentRequest;
    let directories: string[];
    let sourceCounts: string[][];
    let targetCounts: string[][];
    let targetHasObjects: boolean;
    let usedBytes: string;
    let connected: Set<string>;
    let createDatabase: sinon.SinonStub;
    let validateTarget: sinon.SinonStub;
    let progress: LocalDatabaseDeploymentProgress[];
    let objects: string[];
    let providerSettings: sinon.SinonStub;
    let telemetry: ReturnType<typeof stubTelemetry>;
    let backgroundTasks: BackgroundTasksService;
    const success: DacFxResult = { success: true, errorMessage: "", operationId: "operation" };

    setup(() => {
        sandbox = sinon.createSandbox();
        telemetry = stubTelemetry(sandbox);
        directories = [];
        objects = ["[dbo].[Inventory]"];
        progress = [];
        sourceCounts = [["[dbo].[Inventory]", "3"]];
        targetCounts = [["[dbo].[Inventory]", "3"]];
        targetHasObjects = false;
        usedBytes = "1024";
        connected = new Set(["selected-source"]);
        request = {
            deploymentId: "deployment-one",
            validationId: "validation-one",
            sourceId: "source-id",
            deploymentContent: "schemaOnly",
            target: {
                subscriptionId: "subscription",
                resourceGroup: "group",
                serverName: "server",
                databaseName: "CloudInventory",
            },
            tags: { project: "inventory" },
        };
        const credential = {
            getToken: sandbox
                .stub()
                .resolves({ token: "arm-token", expiresOnTimestamp: Date.now() + 3_600_000 }),
        };
        state = new AzureSqlDatabaseState({
            loadState: ApiStatus.Loaded,
            formState: {
                accountId: "account",
                tenantId: "tenant",
                ...request.target,
                authenticationType: AuthenticationType.SqlLogin,
                userName: "admin",
                password: "test-password",
                savePassword: true,
                freeLimitBehavior: KnownFreeLimitExhaustionBehavior.AutoPause,
                profileName: "Cloud inventory",
                groupId: "",
                dataSource: "",
                collation: "",
                maintenanceConfig: "",
                enableAlwaysEncrypted: false,
                maxVcores: "2",
            },
            subscriptions: [
                { ...mockSubscriptions[0], subscriptionId: "subscription", credential },
            ],
        });
        const controllerState = new DeploymentWebviewState();
        controllerState.deploymentType = DeploymentType.AzureSqlDatabase;
        controllerState.deploymentTypeState = state;
        controller = sandbox.createStubInstance(DeploymentWebviewController);
        sandbox.stub(controller, "state").value(controllerState);
        controller.validateDeploymentForm.resolves([]);
        main = sandbox.createStubInstance(MainController);
        controller.mainController = main;
        backgroundTasks = new BackgroundTasksService(() => {});
        main.backgroundTasksService = backgroundTasks;
        manager = sandbox.createStubInstance(ConnectionManager);
        sandbox.stub(main, "connectionManager").get(() => manager);
        dacFx = sandbox.createStubInstance(DacFxService);
        main.dacFxService = dacFx;
        const tasks = sandbox.createStubInstance(SqlTasksService);
        tasks.suppressTaskUI.callsFake(() => new vscode.Disposable(() => {}));
        main.sqlTasksService = tasks;
        connectionUI = sandbox.createStubInstance(ConnectionUI);
        sandbox.stub(manager, "connectionUI").get(() => connectionUI);
        connectionUI.saveProfile.callsFake(async (profile) => profile);
        const node = sandbox.createStubInstance(TreeNodeInfo);
        sandbox.stub(node, "sessionId").get(() => "object-explorer-session");
        main.createObjectExplorerSession.resolves(node);
        const source = new ConnectionInfo();
        source.credentials = Object.assign(new ConnectionProfile(), {
            id: "source-id",
            server: "localhost,1433",
            database: "Inventory",
        });
        sandbox.stub(manager, "activeConnections").get(() => ({ "selected-source": source }));
        manager.isConnected.callsFake((uri) => connected.has(uri));
        manager.connect.callsFake(async (uri) => {
            connected.add(uri);
            return true;
        });
        manager.disconnect.callsFake(async (uri) => {
            connected.delete(uri);
            return true;
        });
        client = sandbox.createStubInstance(SqlToolsServiceClient);
        client.sendRequest.callsFake(async (_type, params) => {
            const { queryString, ownerUri } = params as { queryString: string; ownerUri: string };
            if (queryString.includes("used_bytes")) return rows([[usedBytes]]);
            if (queryString.includes("has_user_objects"))
                return rows([[targetHasObjects ? "1" : "0"]]);
            if (queryString.includes("tables_cursor"))
                return rows(ownerUri.includes("-source:") ? sourceCounts : targetCounts);
            if (queryString.includes("QUOTENAME")) return rows(objects.map((name) => [name]));
            throw new Error(`Unexpected verification query: ${queryString}`);
        });
        compatibility = sandbox.createStubInstance(LocalDatabaseCompatibilityService);
        compatibility.copyValidatedPackage.callsFake(async (validation, destination) => {
            directories.push(path.dirname(destination));
            await fs.writeFile(destination, "exact validated DACPAC");
            return {
                ...validation,
                database: "Inventory",
                target: "AzureSqlDatabase",
                status: "passed",
                diagnostics: [],
                schemaObjects: objects,
                objectsValidated: objects.length,
                snapshotCreatedAt: new Date().toISOString(),
            };
        });
        dacFx.deployDacpac.resolves(success);
        dacFx.importBacpac.resolves(success);
        dacFx.exportBacpac.callsFake(async (_database, packagePath) => {
            await fs.writeFile(packagePath, "exported schema and rows");
            return success;
        });
        validateTarget = sandbox.stub(VsCodeAzureHelper, "validateNewAzureSqlDatabase").resolves({
            location: "westus",
            fullyQualifiedDomainName: "server.database.windows.net",
        });
        createDatabase = sandbox
            .stub(VsCodeAzureHelper, "createAzureSqlDatabase")
            .resolves({ location: "westus" });
        const settings = cloud.getCloudProviderSettings();
        providerSettings = sandbox.stub(cloud, "getCloudProviderSettings").returns(settings);
        output = {
            name: "Deployment test",
            appendLine: sandbox.stub(),
            append: sandbox.stub(),
            replace: sandbox.stub(),
            clear: sandbox.stub(),
            show: () => {},
            hide: sandbox.stub(),
            dispose: sandbox.stub(),
        };
        service = new LocalDatabaseDeploymentService(
            controller,
            compatibility,
            client,
            output,
            stubLogger(sandbox),
        );
    });

    teardown(async () => {
        await service.cancel(request.deploymentId);
        service.dispose();
        for (const directory of directories) {
            await fs.rm(directory, { recursive: true, force: true });
        }
        sandbox.restore();
    });

    const deploy = () => service.deploy(request, (value) => progress.push(value));
    const withData = () => {
        request.deploymentContent = "schemaAndData";
    };

    for (const deploymentContent of ["schemaOnly", "schemaAndData"] as const) {
        test(`continues ${deploymentContent} in Background Tasks when the wizard closes before package capture`, async () => {
            request.deploymentContent = deploymentContent;
            let release: () => void;
            let validating: () => void;
            const gate = new Promise<void>((resolve) => {
                release = resolve;
            });
            const started = new Promise<void>((resolve) => {
                validating = resolve;
            });
            controller.validateDeploymentForm.callsFake(async () => {
                validating();
                await gate;
                return [];
            });
            const showOutput = sandbox.spy(output, "show");
            const deployment = deploy();
            await started;
            const task = backgroundTasks.tasks.find(
                (task) => task.displayText === LocalToCloud.deployingDatabase("CloudInventory"),
            )!;
            try {
                expect(task).to.include({
                    state: BackgroundTaskState.InProgress,
                    canCancel: true,
                    message: LocalToCloud.deploymentStages.validatingSettings,
                });
                service.dispose();
                expect(compatibility.dispose).not.to.have.been.called;
                expect(compatibility.copyValidatedPackage).not.to.have.been.called;
            } finally {
                release();
            }
            const progressBeforeClose = [...progress];
            expect(await deployment).to.include({
                status: "succeeded",
                database: "CloudInventory",
            });
            expect(progress).to.deep.equal(progressBeforeClose);
            expect(compatibility.dispose).to.have.been.called;
            expect(main.createObjectExplorerSession).to.have.been.called;
            expect(backgroundTasks.tasks.find((entry) => entry.id === task.id)).to.include({
                state: BackgroundTaskState.Succeeded,
                canCancel: false,
                message: LocalToCloud.deploymentSucceeded,
            });
            expect(
                backgroundTasks.getTaskLog(task.id)?.entries.map((entry) => entry.message),
            ).to.include.members([
                LocalToCloud.deploymentStages[
                    deploymentContent === "schemaOnly" ? "publishingSchema" : "importingData"
                ],
                LocalToCloud.deploymentStages.verifying,
                LocalToCloud.deploymentStages.savingConnection,
            ]);
            await backgroundTasks.openTask(task.id);
            expect(showOutput).to.have.been.calledWith(true);
            for (const directory of directories) {
                expect(
                    await fs.stat(directory).then(
                        () => true,
                        () => false,
                    ),
                ).to.equal(false);
            }
        });
    }

    test("cleans up compatibility immediately when the wizard closes without a deployment", () => {
        service.dispose();
        expect(compatibility.dispose).to.have.been.called;
    });

    test("copies the deployed connection without a password or application name", async () => {
        await deploy();
        const details = {
            options: { server: "server.database.windows.net", database: "CloudInventory" },
        };
        manager.createConnectionDetails.returns(details);
        manager.getConnectionString.resolves(
            "Server=server.database.windows.net;Database=CloudInventory;",
        );
        const write = sandbox.stub().resolves();
        sandbox.stub(vscode.env, "clipboard").value({ writeText: write });
        await service.performAction(request.deploymentId, "copyConnectionString");
        expect(manager.getConnectionString).to.have.been.calledWith(details, false, false);
        expect(manager.createConnectionDetails.firstCall.args[0]).to.include({
            server: "server.database.windows.net",
            database: "CloudInventory",
        });
        expect(write).to.have.been.calledWith(
            "Server=server.database.windows.net;Database=CloudInventory;",
        );
        expect(telemetry.sendActionEvent).to.have.been.calledWith(
            TelemetryViews.LocalToCloudDeployment,
            TelemetryActions.LocalToCloudPostDeploymentAction,
            sinon.match({
                additionalProps: { action: "copyConnectionString", status: "succeeded" },
            }),
        );
    });

    test("opens the captured database in the configured cloud portal", async () => {
        const settings = cloud.getCloudProviderSettings();
        providerSettings.returns({
            ...settings,
            portalEndpoint: "https://portal.azure.us/",
        });
        request.target.databaseName = state.formState.databaseName = "Cloud Inventory";
        await deploy();
        state.formState.databaseName = "OtherDatabase";
        const open = sandbox.stub(vscode.env, "openExternal").resolves(true);
        await service.performAction(request.deploymentId, "openPortal");
        expect(open.firstCall.args[0]).to.include({
            scheme: "https",
            authority: "portal.azure.us",
        });
        expect(open.firstCall.args[0].fragment).to.equal(
            "resource/subscriptions/subscription/resourceGroups/group/providers/Microsoft.Sql/servers/server/databases/Cloud Inventory",
        );
        expect(telemetry.sendActionEvent).to.have.been.calledWith(
            TelemetryViews.LocalToCloudDeployment,
            TelemetryActions.LocalToCloudPostDeploymentAction,
            sinon.match({ additionalProps: { action: "openPortal", status: "succeeded" } }),
        );
    });

    test("surfaces portal and clipboard failures instead of reporting success", async () => {
        await deploy();
        sandbox.stub(vscode.env, "openExternal").resolves(false);
        let error: unknown;
        try {
            await service.performAction(request.deploymentId, "openPortal");
        } catch (value) {
            error = value;
        }
        expect(error).to.be.instanceOf(Error);
        expect((error as Error).message).to.equal(LocalToCloud.deploymentPortalFailed);
        manager.getConnectionString.rejects(new Error("Connection string unavailable"));
        try {
            await service.performAction(request.deploymentId, "copyConnectionString");
        } catch (value) {
            error = value;
        }
        expect((error as Error).message).to.equal("Connection string unavailable");
        for (const action of ["openPortal", "copyConnectionString"]) {
            expect(telemetry.sendErrorEvent).to.have.been.calledWith(
                TelemetryViews.LocalToCloudDeployment,
                TelemetryActions.LocalToCloudPostDeploymentAction,
                sinon.match({
                    errorType: "PostDeploymentActionFailed",
                    includeErrorMessage: false,
                    additionalProps: { action, status: "error" },
                }),
            );
        }
    });

    test("does not allow success actions for failed or unknown deployments", async () => {
        dacFx.deployDacpac.resolves({ ...success, success: false });
        await deploy();
        const open = sandbox.stub(vscode.env, "openExternal").resolves(true);
        for (const id of [request.deploymentId, "unknown"]) {
            let error: unknown;
            try {
                await service.performAction(id, "openPortal");
            } catch (value) {
                error = value;
            }
            expect(error).to.be.instanceOf(Error);
            expect((error as Error).message).to.equal(LocalToCloud.invalidDeployment);
        }
        expect(open).not.to.have.been.called;
    });

    test("returns deployment script settings from the captured destination without credentials", async () => {
        state.formState.collation = "Latin1_General_100_CI_AS";
        state.formState.maxVcores = "4";
        state.formState.maintenanceConfig = "/maintenance/config";
        state.formState.enableAlwaysEncrypted = true;
        const result = await deploy();
        expect(result.scriptSettings).to.deep.equal({
            databaseName: "CloudInventory",
            serverName: "server",
            resourceGroup: "group",
            serverResourceId:
                "/subscriptions/subscription/resourceGroups/group/providers/Microsoft.Sql/servers/server",
            location: "westus",
            collation: "Latin1_General_100_CI_AS",
            maxVcores: "4",
            freeLimitBehavior: KnownFreeLimitExhaustionBehavior.AutoPause,
            maintenanceConfig: "/maintenance/config",
            enableAlwaysEncrypted: true,
            tags: { project: "inventory" },
        });
        expect(JSON.stringify(result)).not.to.include("test-password");
    });

    test("publishes the exact validated DACPAC, verifies schema, then saves and connects the profile", async () => {
        dacFx.deployDacpac.callsFake(async (packagePath) => {
            expect(await fs.readFile(packagePath, "utf8")).to.equal("exact validated DACPAC");
            expect(connectionUI.saveProfile).not.to.have.been.called;
            return success;
        });
        const result = await deploy();
        expect(result).to.include({
            status: "succeeded",
            database: "CloudInventory",
            server: "server.database.windows.net",
            sourceDatabase: "Inventory",
            objectsDeployed: 1,
        });
        expect(dacFx.deployDacpac).to.have.been.calledWith(
            sinon.match.string,
            "CloudInventory",
            true,
            sinon.match(/^mssql-local-to-cloud-target:/),
            TaskExecutionMode.execute,
        );
        expect(dacFx.exportBacpac).not.to.have.been.called;
        expect(dacFx.importBacpac).not.to.have.been.called;
        expect(connectionUI.saveProfile).to.have.been.calledWith(
            sinon.match({
                server: result.server,
                database: result.database,
                user: "admin",
                savePassword: true,
            }),
        );
        expect(createDatabase).to.have.been.calledWith(
            sinon.match.any,
            "group",
            "server",
            "CloudInventory",
            sinon.match({ useFreeLimit: true, tags: request.tags }),
            sinon.match({ requireNew: true }),
        );
        expect(progress.map((item) => item.stage)).to.deep.equal([
            "authenticating",
            "validatingSettings",
            "creatingDatabase",
            "connecting",
            "publishingSchema",
            "verifying",
            "savingConnection",
        ]);
        expect(connected).to.deep.equal(new Set(["selected-source"]));
        expect(
            await fs.stat(directories[0]).then(
                () => true,
                () => false,
            ),
        ).to.equal(false);
    });

    test("exports and imports a BACPAC without publishing schema first, and verifies rows", async () => {
        withData();
        usedBytes = String(32 * 1024 ** 3);
        const result = await deploy();
        expect(result.status).to.equal("succeeded");
        expect(dacFx.exportBacpac).to.have.been.calledWith(
            "Inventory",
            sinon.match(/database\.bacpac$/),
            sinon.match(/^mssql-local-to-cloud-source:/),
            TaskExecutionMode.execute,
        );
        expect(dacFx.importBacpac).to.have.been.calledWith(
            sinon.match(/database\.bacpac$/),
            "CloudInventory",
            sinon.match(/^mssql-local-to-cloud-target:/),
            TaskExecutionMode.execute,
        );
        expect(dacFx.deployDacpac).not.to.have.been.called;
        expect(progress.map((item) => item.stage)).to.include.members([
            "exportingData",
            "importingData",
            "verifying",
        ]);
        expect(connected).to.deep.equal(new Set(["selected-source"]));
        expect(
            await fs.stat(directories[0]).then(
                () => true,
                () => false,
            ),
        ).to.equal(false);
    });

    test("allows a table and a user-defined type with the same qualified name", async () => {
        withData();
        objects.push("[dbo].[Inventory]");
        expect(await deploy()).to.include({ status: "succeeded", objectsDeployed: 2 });
    });

    test("rejects an existing Azure database before exporting or creating resources", async () => {
        withData();
        validateTarget.rejects(new Error(LocalToCloud.targetDatabaseExists));
        const result = await deploy();
        expect(result).to.include({
            status: "error",
            resourcesMayRemain: false,
            errorMessage: LocalToCloud.targetDatabaseExists,
        });
        expect(createDatabase).not.to.have.been.called;
        expect(dacFx.exportBacpac).not.to.have.been.called;
    });

    test("rejects oversized sources before provisioning", async () => {
        withData();
        usedBytes = String(33 * 1024 ** 3);
        expect(await deploy()).to.include({
            status: "error",
            errorMessage: LocalToCloud.sourceTooLarge,
        });
        expect(createDatabase).not.to.have.been.called;
        expect(dacFx.exportBacpac).not.to.have.been.called;
    });

    test("rejects source row changes during export before creating Azure resources", async () => {
        withData();
        dacFx.exportBacpac.callsFake(async (_database, packagePath) => {
            await fs.writeFile(packagePath, "package");
            sourceCounts = [["[dbo].[Inventory]", "4"]];
            return success;
        });
        expect(await deploy()).to.include({
            status: "error",
            errorMessage: LocalToCloud.sourceChanged,
        });
        expect(createDatabase).not.to.have.been.called;
        expect(dacFx.importBacpac).not.to.have.been.called;
    });

    test("never imports into a nonempty target and preserves created resources on failure", async () => {
        withData();
        targetHasObjects = true;
        expect(await deploy()).to.include({
            status: "error",
            resourcesMayRemain: true,
            errorMessage: LocalToCloud.targetDatabaseExists,
        });
        expect(dacFx.importBacpac).not.to.have.been.called;
        expect(connectionUI.saveProfile).not.to.have.been.called;
    });

    test("does not report success or save a profile when target row counts differ", async () => {
        withData();
        targetCounts = [["[dbo].[Inventory]", "2"]];
        expect(await deploy()).to.include({
            status: "error",
            resourcesMayRemain: true,
            errorMessage: LocalToCloud.deploymentVerificationFailed,
        });

        expect(connectionUI.saveProfile).not.to.have.been.called;
        expect(main.createObjectExplorerSession).not.to.have.been.called;
    });

    test("rejects malformed row-count metadata instead of reporting a successful migration", async () => {
        withData();
        sourceCounts = [["[dbo].[Inventory]"]];
        targetCounts = [["[dbo].[Inventory]"]];
        expect(await deploy()).to.include({
            status: "error",
            errorMessage: LocalToCloud.deploymentQueryFailed,
        });
        expect(createDatabase).not.to.have.been.called;
    });

    test("returns the same operation for repeated start requests without creating twice", async () => {
        const first = deploy();
        expect(deploy()).to.equal(first);
        const result = await first;
        const events = telemetry.sendActionEvent.getCalls().map((call) => call.args);
        const tasks = backgroundTasks.tasks;
        expect(await deploy()).to.equal(result);
        expect(telemetry.sendActionEvent.getCalls().map((call) => call.args)).to.deep.equal(events);
        expect(backgroundTasks.tasks).to.deep.equal(tasks);
        expect(createDatabase.getCalls().map((call) => call.args[3])).to.deep.equal([
            "CloudInventory",
        ]);
    });

    test("records the selected mode, measured stages and final verified result for both deployment modes", async () => {
        for (const deploymentContent of ["schemaOnly", "schemaAndData"] as const) {
            request = { ...request, deploymentId: deploymentContent, deploymentContent };
            const result = await deploy();
            expect(result.status).to.equal("succeeded");
            expect(telemetry.sendActionEvent).to.have.been.calledWith(
                TelemetryViews.LocalToCloudDeployment,
                TelemetryActions.StartLocalToCloudDeployment,
                { additionalProps: { deploymentContent } },
            );
            expect(telemetry.sendActionEvent).to.have.been.calledWith(
                TelemetryViews.LocalToCloudDeployment,
                TelemetryActions.LocalToCloudDeploymentStage,
                sinon.match({
                    additionalProps: {
                        deploymentContent,
                        stage:
                            deploymentContent === "schemaOnly"
                                ? "publishingSchema"
                                : "importingData",
                        status: "succeeded",
                    },
                    additionalMeasurements: { durationInMs: sinon.match.number },
                }),
            );
            expect(telemetry.sendActionEvent).to.have.been.calledWith(
                TelemetryViews.LocalToCloudDeployment,
                TelemetryActions.FinishLocalToCloudDeployment,
                sinon.match({
                    additionalProps: {
                        deploymentContent,
                        status: "succeeded",
                        stage: "savingConnection",
                        resourcesMayRemain: "true",
                    },
                    additionalMeasurements: {
                        durationInMs: sinon.match.number,
                        completedStageCount: deploymentContent === "schemaOnly" ? 7 : 8,
                        objectsDeployed: 1,
                    },
                }),
            );
        }
    });

    test("reports the failing stage without recording customer data or raw errors", async () => {
        const privateMessage =
            "private-user-data CloudInventory server.database.windows.net subscription test-password";
        dacFx.deployDacpac.rejects(new Error(privateMessage));
        const result = await deploy();
        expect(result.status).to.equal("error");
        expect(
            backgroundTasks.tasks.find((task) => task.state === BackgroundTaskState.Failed),
        ).to.include({ message: result.errorMessage });
        expect(telemetry.sendErrorEvent).to.have.been.calledWith(
            TelemetryViews.LocalToCloudDeployment,
            TelemetryActions.FinishLocalToCloudDeployment,
            sinon.match({
                errorType: "LocalToCloudDeploymentFailed",
                includeErrorMessage: false,
                additionalProps: {
                    deploymentContent: "schemaOnly",
                    status: "error",
                    stage: "publishingSchema",
                    resourcesMayRemain: "true",
                },
                additionalMeasurements: {
                    durationInMs: sinon.match.number,
                    completedStageCount: 4,
                },
            }),
        );
        for (const event of [telemetry.sendActionEvent, telemetry.sendErrorEvent].flatMap((stub) =>
            stub.getCalls(),
        )) {
            const payload = event.args[2];
            expect(payload).not.to.have.property("error");
            expect(Object.keys(payload.additionalProps)).to.satisfy((keys: string[]) =>
                keys.every((key) =>
                    ["deploymentContent", "stage", "status", "resourcesMayRemain"].includes(key),
                ),
            );
            expect(Object.values(payload.additionalMeasurements ?? {})).to.satisfy(
                (values: unknown[]) =>
                    values.every(
                        (value) =>
                            typeof value === "number" && Number.isFinite(value) && value >= 0,
                    ),
            );
            const text = JSON.stringify(payload);
            for (const value of [
                "private-user-data",
                "CloudInventory",
                "server.database.windows.net",
                "subscription",
                "test-password",
                "source-id",
                "[dbo].[Inventory]",
                ...directories,
            ]) {
                expect(text).not.to.include(value);
            }
        }
    });

    test("records cleanup failures as errors rather than successful deployments", async () => {
        sandbox
            .stub(fs, "rm")
            .callThrough()
            .onFirstCall()
            .rejects(new Error("private cleanup path"));
        expect((await deploy()).status).to.equal("error");
        expect(
            backgroundTasks.tasks.find((task) => task.state === BackgroundTaskState.Failed),
        ).to.include({ message: LocalToCloud.deploymentCleanupFailed });
        expect(telemetry.sendErrorEvent).to.have.been.calledWith(
            TelemetryViews.LocalToCloudDeployment,
            TelemetryActions.FinishLocalToCloudDeployment,
            sinon.match({ additionalProps: { status: "error", stage: "cleanup" } }),
        );
        expect(telemetry.sendActionEvent).not.to.have.been.calledWith(
            TelemetryViews.LocalToCloudDeployment,
            TelemetryActions.FinishLocalToCloudDeployment,
            sinon.match({ additionalProps: { status: "succeeded" } }),
        );
    });

    test("prevents another wizard from deploying to the same Azure resource concurrently", async () => {
        let release: () => void;
        let creating: () => void;
        const gate = new Promise<void>((resolve) => {
            release = resolve;
        });
        const started = new Promise<void>((resolve) => {
            creating = resolve;
        });
        createDatabase.callsFake(async () => {
            creating();
            await gate;
            return { location: "westus" };
        });
        const first = deploy();
        await started;
        const other = new LocalDatabaseDeploymentService(
            controller,
            compatibility,
            client,
            output,
            stubLogger(sandbox),
        );
        try {
            expect(
                await other.deploy({ ...request, deploymentId: "competing-deployment" }, () => {}),
            ).to.include({
                status: "error",
                resourcesMayRemain: false,
                errorMessage: LocalToCloud.invalidDeployment,
            });
        } finally {
            release();
            await first;
            other.dispose();
        }
    });

    test("uses a settings snapshot and refuses a stale reviewed destination", async () => {
        request.target.databaseName = "unexpected-target";
        expect(await deploy()).to.include({
            status: "error",
            errorMessage: LocalToCloud.invalidAzureSettings,
        });
        expect(createDatabase).not.to.have.been.called;
        request = {
            ...request,
            deploymentId: "snapshot-deployment",
            target: { ...request.target, databaseName: "CloudInventory" },
        };
        controller.validateDeploymentForm.callsFake(async () => {
            state.formState.databaseName = "ChangedElsewhere";
            return [];
        });
        expect(await deploy()).to.include({ status: "succeeded", database: "CloudInventory" });
        expect(createDatabase).to.have.been.calledWith(
            sinon.match.any,
            "group",
            "server",
            "CloudInventory",
        );
    });

    test("keeps Entra account identity when saving the connected profile", async () => {
        state.formState.authenticationType = AuthenticationType.AzureMFA;
        state.formState.userName = "";
        state.formState.password = "";
        sandbox.stub(entra, "acquireTokenFromVscodeAccountForResource").resolves({
            account: { id: "account", label: "SQL account" },
            tenantId: "tenant",
            session: {
                id: "session",
                account: { id: "account", label: "SQL account" },
                accessToken: "sql-token",
                scopes: [],
            },
            token: {
                key: "account",
                token: "sql-token",
                tokenType: "Bearer",
                expiresOn: Date.now() / 1000 + 3600,
            },
        });
        expect(await deploy()).to.include({ status: "succeeded" });
        expect(connectionUI.saveProfile).to.have.been.calledWith(
            sinon.match({
                authenticationType: AuthenticationType.AzureMFA,
                user: "SQL account",
                accountId: "account",
                tenantId: "tenant",
                azureAccountToken: "sql-token",
                password: "",
            }),
        );
    });

    test("does not claim saved-and-connected success if Object Explorer cannot connect", async () => {
        main.createObjectExplorerSession.resolves(undefined);
        expect(await deploy()).to.include({
            status: "error",
            errorMessage: LocalToCloud.deploymentProfileFailed,
            resourcesMayRemain: true,
        });
        expect(output.appendLine).not.to.have.been.calledWith(LocalToCloud.deploymentSucceeded);
    });

    test("surfaces package-task errors in the deployment log even when STS returns an empty error", async () => {
        dacFx.deployDacpac.callsFake(async () => {
            const task = {
                taskId: "publish-task",
                serverName: "server.database.windows.net",
                databaseName: "CloudInventory",
                operationName: Constants.operationIdDeployDacpac,
            } as TaskInfo;
            taskCreatedEmitter.fire(task);
            taskProgressEmitter.fire({
                taskId: task.taskId,
                status: TaskStatus.Failed,
                message: "The schema could not be published.",
            });
            return { ...success, success: false };
        });
        expect(await deploy()).to.include({
            status: "error",
            errorMessage: "The schema could not be published.",
        });
        expect(output.appendLine).to.have.been.calledWith("The schema could not be published.");
        expect(connectionUI.saveProfile).not.to.have.been.called;
    });

    test("cancels the in-flight import from Background Tasks after closing the wizard and leaves Azure intact", async () => {
        withData();
        let finishImport: (value: DacFxResult) => void;
        let started: () => void;
        const importing = new Promise<void>((resolve) => {
            started = resolve;
        });
        dacFx.importBacpac.callsFake(
            () =>
                new Promise<DacFxResult>((resolve) => {
                    finishImport = resolve;
                    taskCreatedEmitter.fire({
                        taskId: "import-task",
                        serverName: "server.database.windows.net,1433",
                        databaseName: "CloudInventory",
                        operationName: Constants.operationIdImportBacpac,
                    } as TaskInfo);
                    started();
                }),
        );
        client.sendRequest
            .withArgs(sinon.match({ method: "tasks/canceltask" }), { taskId: "import-task" })
            .callsFake(async () => {
                finishImport({ ...success, success: false });
                return true;
            });
        const deployment = deploy();
        await importing;
        service.dispose();
        const task = backgroundTasks.tasks.find(
            (task) => task.state === BackgroundTaskState.InProgress,
        )!;
        await backgroundTasks.cancelTask(task.id);
        expect(await deployment).to.include({ status: "cancelled", resourcesMayRemain: true });
        expect(backgroundTasks.tasks.find((entry) => entry.id === task.id)).to.include({
            state: BackgroundTaskState.Canceled,
            canCancel: false,
            message: LocalToCloud.deploymentCancelled,
        });
        expect(connectionUI.saveProfile).not.to.have.been.called;
        expect(connected).to.deep.equal(new Set(["selected-source"]));
        expect(telemetry.sendActionEvent).to.have.been.calledWith(
            TelemetryViews.LocalToCloudDeployment,
            TelemetryActions.FinishLocalToCloudDeployment,
            sinon.match({
                additionalProps: {
                    deploymentContent: "schemaAndData",
                    status: "cancelled",
                    stage: "importingData",
                    resourcesMayRemain: "true",
                },
            }),
        );
        expect(telemetry.sendErrorEvent).not.to.have.been.called;
    });
});
