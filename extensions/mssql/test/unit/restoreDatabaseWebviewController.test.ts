/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as chai from "chai";
import { expect } from "chai";
import * as sinon from "sinon";
import sinonChai from "sinon-chai";
import * as vscode from "vscode";
import * as jsonRpc from "vscode-jsonrpc/node";
import { IServerInfo } from "vscode-mssql";
import ConnectionManager from "../../src/controllers/connectionManager";
import { RestoreDatabaseWebviewController } from "../../src/controllers/restoreDatabaseWebviewController";
import { DatabaseEngineEdition } from "../../src/databaseProjects/common/enums";
import { ConnectionProfile } from "../../src/models/connectionProfile";
import { ObjectManagementService } from "../../src/services/objectManagementService";
import { FileBrowserService } from "../../src/services/fileBrowserService";
import { AzureBlobService } from "../../src/services/azureBlobService";
import { RestoreDatabaseViewModel } from "../../src/sharedInterfaces/restore";
import { ApiStatus } from "../../src/sharedInterfaces/webview";
import { TelemetryActions, TelemetryViews } from "../../src/sharedInterfaces/telemetry";
import * as LocConstants from "../../src/constants/locConstants";
import { stubLogger, stubTelemetry, stubWebviewConnectionRpc, stubWebviewPanel } from "./utils";

chai.use(sinonChai);

class TestRestoreDatabaseWebviewController extends RestoreDatabaseWebviewController {
    protected override start(): void {
        // Tests explicitly await initialization instead of starting it in the constructor.
    }

    public initialize(): Promise<void> {
        return this.initializeDialog();
    }
}

suite("RestoreDatabaseWebviewController", () => {
    let sandbox: sinon.SinonSandbox;
    let service: sinon.SinonStubbedInstance<ObjectManagementService>;
    let connectionManager: sinon.SinonStubbedInstance<ConnectionManager>;
    let profile: ConnectionProfile;
    let controller: TestRestoreDatabaseWebviewController;
    let sendErrorEvent: sinon.SinonStub;

    setup(() => {
        sandbox = sinon.createSandbox();
        ({ sendErrorEvent } = stubTelemetry(sandbox));
        stubLogger(sandbox);
        sandbox
            .stub(jsonRpc, "createMessageConnection")
            .returns(stubWebviewConnectionRpc(sandbox).connection);
        sandbox.stub(vscode.window, "createWebviewPanel").returns(stubWebviewPanel(sandbox));
        service = sandbox.createStubInstance(ObjectManagementService);
        connectionManager = sandbox.createStubInstance(ConnectionManager);
        profile = new ConnectionProfile();
        profile.server = "localhost,1433";
        profile.database = "TestDb";
        const context = {
            extensionUri: vscode.Uri.file("C:\\test-extension"),
            extensionPath: "C:\\test-extension",
            subscriptions: [],
        } as vscode.ExtensionContext;
        controller = new TestRestoreDatabaseWebviewController(
            context,
            service,
            connectionManager,
            sandbox.createStubInstance(FileBrowserService),
            sandbox.createStubInstance(AzureBlobService),
            profile,
            "ownerUri",
        );
    });

    teardown(() => {
        sandbox.restore();
    });

    function viewModel(): RestoreDatabaseViewModel {
        return controller.state.viewModel.model as RestoreDatabaseViewModel;
    }

    function serverInfo(engineEditionId: DatabaseEngineEdition): IServerInfo {
        return {
            engineEditionId,
            serverMajorVersion: 16,
            serverMinorVersion: 0,
            serverReleaseVersion: 0,
            serverVersion: "16.0.0",
            serverLevel: "",
            serverEdition: "",
            isCloud: false,
            azureVersion: 0,
            osVersion: "",
        };
    }

    for (const server of ["localhost,1433", "127.0.0.1,1434", "sql-alias"]) {
        test(`rejects Azure SQL Database engine at ${server} before requesting restore configuration`, async () => {
            profile.server = server;
            connectionManager.getServerInfo.returns(serverInfo(DatabaseEngineEdition.SqlDatabase));

            await controller.initialize();

            expect(viewModel().loadState).to.equal(ApiStatus.Error);
            expect(viewModel().errorMessage).to.equal(
                LocConstants.RestoreDatabase.azureSqlDbNotSupported,
            );
            expect(service.getRestoreConfigInfo).not.to.have.been.called;
            expect(connectionManager.listDatabases).not.to.have.been.called;
            expect(service.getRestorePlan).not.to.have.been.called;
        });
    }

    test("retains Azure hostname detection when server metadata is unavailable", async () => {
        profile.server = "test.database.windows.net";

        await controller.initialize();

        expect(viewModel().loadState).to.equal(ApiStatus.Error);
        expect(viewModel().errorMessage).to.equal(
            LocConstants.RestoreDatabase.azureSqlDbNotSupported,
        );
        expect(service.getRestoreConfigInfo).not.to.have.been.called;
    });

    for (const edition of [
        DatabaseEngineEdition.Standard,
        DatabaseEngineEdition.Enterprise,
        DatabaseEngineEdition.SqlManagedInstance,
    ]) {
        test(`continues restore initialization for engine edition ${edition}`, async () => {
            profile.server = "test.database.windows.net";
            connectionManager.getServerInfo.returns(serverInfo(edition));
            service.getRestoreConfigInfo.resolves({
                configInfo: {
                    defaultBackupFolder: "C:\\Backups",
                    dataFileFolder: "C:\\Data",
                    logFileFolder: "C:\\Logs",
                    sourceDatabaseNamesWithBackupSets: ["TestDb"],
                },
                errorMessage: "",
            });
            connectionManager.listDatabases.resolves(["TestDb"]);
            const detail = {
                currentValue: "TestDb",
                defaultValue: "TestDb",
                isReadOnly: false,
                isVisible: true,
                errorMessage: "",
            };
            service.getRestorePlan.resolves({
                sessionId: "restore-session",
                canRestore: true,
                errorMessage: "",
                backupSetsToRestore: [],
                dbFiles: [],
                databaseNamesFromBackupSets: ["TestDb"],
                planDetails: {
                    sourceDatabaseName: { ...detail, name: "sourceDatabaseName" },
                    targetDatabaseName: { ...detail, name: "targetDatabaseName" },
                },
            });

            await controller.initialize();

            expect(service.getRestoreConfigInfo).to.have.been.calledWith("ownerUri");
            expect(viewModel().loadState).to.equal(ApiStatus.Loaded);
            expect(controller.state.formState.targetDatabaseName).to.equal("TestDb");
        });
    }

    test("shows rejected restore configuration requests as an error", async () => {
        service.getRestoreConfigInfo.rejects(new Error("Restore configuration unavailable"));

        await controller.initialize();

        expect(viewModel().loadState).to.equal(ApiStatus.Error);
        expect(viewModel().errorMessage).to.equal("Restore configuration unavailable");
    });

    test("shows service-returned configuration errors instead of remaining in loading state", async () => {
        service.getRestoreConfigInfo.resolves({
            configInfo: undefined,
            errorMessage: "Restore is unavailable for this database",
        });

        await controller.initialize();

        expect(viewModel().loadState).to.equal(ApiStatus.Error);
        expect(viewModel().errorMessage).to.equal("Restore is unavailable for this database");
        expect(connectionManager.listDatabases).not.to.have.been.called;
        expect(sendErrorEvent).to.have.been.calledWith(
            TelemetryViews.Restore,
            TelemetryActions.InitializeRestore,
            sinon.match({
                error: sinon.match.instanceOf(Error),
                includeErrorMessage: false,
            }),
        );
    });
});
