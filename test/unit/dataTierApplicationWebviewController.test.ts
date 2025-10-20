/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import * as sinon from "sinon";
import sinonChai from "sinon-chai";
import * as chai from "chai";
import { expect } from "chai";
import * as jsonRpc from "vscode-jsonrpc/node";
import { DataTierApplicationWebviewController } from "../../src/controllers/dataTierApplicationWebviewController";
import ConnectionManager from "../../src/controllers/connectionManager";
import { DacFxService } from "../../src/services/dacFxService";
import {
    CancelDataTierApplicationWebviewNotification,
    ConfirmDeployToExistingWebviewRequest,
    ConnectToServerWebviewRequest,
    DataTierApplicationResult,
    DataTierOperationType,
    DeployDacpacWebviewRequest,
    ExportBacpacWebviewRequest,
    ExtractDacpacWebviewRequest,
    ImportBacpacWebviewRequest,
    ListConnectionsWebviewRequest,
    ListDatabasesWebviewRequest,
    ValidateDatabaseNameWebviewRequest,
    ValidateFilePathWebviewRequest,
} from "../../src/sharedInterfaces/dataTierApplication";
import * as LocConstants from "../../src/constants/locConstants";
import {
    stubTelemetry,
    stubVscodeWrapper,
    stubWebviewConnectionRpc,
    stubWebviewPanel,
} from "./utils";
import VscodeWrapper from "../../src/controllers/vscodeWrapper";
import { Logger } from "../../src/models/logger";
import * as utils from "../../src/utils/utils";
import { DacFxResult } from "vscode-mssql";
import { ListDatabasesRequest } from "../../src/models/contracts/connection";
import SqlToolsServiceClient from "../../src/languageservice/serviceclient";
import { ConnectionStore } from "../../src/models/connectionStore";
import * as fs from "fs";

chai.use(sinonChai);

suite("DataTierApplicationWebviewController", () => {
    let sandbox: sinon.SinonSandbox;
    let mockContext: vscode.ExtensionContext;
    let vscodeWrapperStub: sinon.SinonStubbedInstance<VscodeWrapper>;
    let connectionManagerStub: sinon.SinonStubbedInstance<ConnectionManager>;
    let dacFxServiceStub: sinon.SinonStubbedInstance<DacFxService>;
    let sqlToolsClientStub: sinon.SinonStubbedInstance<SqlToolsServiceClient>;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let requestHandlers: Map<string, (params: any) => Promise<any>>;
    let notificationHandlers: Map<string, () => void>;
    let connectionStub: jsonRpc.MessageConnection;
    let createWebviewPanelStub: sinon.SinonStub;
    let panelStub: vscode.WebviewPanel;
    let controller: DataTierApplicationWebviewController;
    let fsExistsSyncStub: sinon.SinonStub;

    const ownerUri = "test-connection-uri";
    const initialState = {
        operationType: DataTierOperationType.Deploy,
        serverName: "test-server",
    };

    setup(() => {
        sandbox = sinon.createSandbox();
        stubTelemetry(sandbox);

        const loggerStub = sandbox.createStubInstance(Logger);
        sandbox.stub(Logger, "create").returns(loggerStub);

        sandbox.stub(utils, "getNonce").returns("test-nonce");

        const connection = stubWebviewConnectionRpc(sandbox);
        requestHandlers = connection.requestHandlers;
        notificationHandlers = connection.notificationHandlers;
        connectionStub = connection.connection;

        sandbox
            .stub(jsonRpc, "createMessageConnection")
            .returns(connectionStub as unknown as jsonRpc.MessageConnection);

        panelStub = stubWebviewPanel(sandbox);
        createWebviewPanelStub = sandbox
            .stub(vscode.window, "createWebviewPanel")
            .callsFake(() => panelStub);

        mockContext = {
            extensionUri: vscode.Uri.file("/tmp/ext"),
            extensionPath: "/tmp/ext",
            subscriptions: [],
        } as unknown as vscode.ExtensionContext;

        vscodeWrapperStub = stubVscodeWrapper(sandbox);
        connectionManagerStub = sandbox.createStubInstance(ConnectionManager);
        dacFxServiceStub = sandbox.createStubInstance(DacFxService);
        sqlToolsClientStub = sandbox.createStubInstance(SqlToolsServiceClient);

        // Set up connection manager client
        sandbox.stub(connectionManagerStub, "client").get(() => sqlToolsClientStub);

        // Stub fs.existsSync
        fsExistsSyncStub = sandbox.stub(fs, "existsSync");
    });

    teardown(() => {
        sandbox.restore();
    });

    function createController(): DataTierApplicationWebviewController {
        controller = new DataTierApplicationWebviewController(
            mockContext,
            vscodeWrapperStub,
            connectionManagerStub,
            dacFxServiceStub,
            initialState,
            ownerUri,
        );
        return controller;
    }

    suite("Deployment Operations", () => {
        test("deploy DACPAC succeeds for new database", async () => {
            const mockResult: DacFxResult = {
                success: true,
                errorMessage: undefined,
                operationId: "operation-123",
            };

            dacFxServiceStub.deployDacpac.resolves(mockResult);
            createController();

            const requestHandler = requestHandlers.get(DeployDacpacWebviewRequest.type.method);
            expect(requestHandler, "Request handler was not registered").to.be.a("function");

            const params = {
                packageFilePath: "C:\\test\\database.dacpac",
                databaseName: "NewDatabase",
                isNewDatabase: true,
                ownerUri: ownerUri,
            };

            const resolveSpy = sandbox.spy(controller.dialogResult, "resolve");
            const response = (await requestHandler!(params)) as DataTierApplicationResult;

            expect(dacFxServiceStub.deployDacpac).to.have.been.calledOnce;
            expect(dacFxServiceStub.deployDacpac).to.have.been.calledWith(
                params.packageFilePath,
                params.databaseName,
                false, // upgradeExisting = !isNewDatabase
                params.ownerUri,
                0, // TaskExecutionMode.execute
            );
            expect(response).to.deep.equal({
                success: true,
                errorMessage: undefined,
                operationId: "operation-123",
            });
            expect(resolveSpy).to.have.been.calledOnce;
        });

        test("deploy DACPAC succeeds for existing database", async () => {
            const mockResult: DacFxResult = {
                success: true,
                errorMessage: undefined,
                operationId: "operation-456",
            };

            dacFxServiceStub.deployDacpac.resolves(mockResult);
            createController();

            const requestHandler = requestHandlers.get(DeployDacpacWebviewRequest.type.method);
            const params = {
                packageFilePath: "C:\\test\\database.dacpac",
                databaseName: "ExistingDatabase",
                isNewDatabase: false,
                ownerUri: ownerUri,
            };

            const response = await requestHandler!(params);

            expect(dacFxServiceStub.deployDacpac).to.have.been.calledWith(
                params.packageFilePath,
                params.databaseName,
                true, // upgradeExisting = !isNewDatabase
                params.ownerUri,
                0,
            );
            expect(response.success).to.be.true;
        });

        test("deploy DACPAC returns error on failure", async () => {
            const mockResult: DacFxResult = {
                success: false,
                errorMessage: "Deployment failed: Permission denied",
                operationId: "operation-789",
            };

            dacFxServiceStub.deployDacpac.resolves(mockResult);
            createController();

            const requestHandler = requestHandlers.get(DeployDacpacWebviewRequest.type.method);
            const params = {
                packageFilePath: "C:\\test\\database.dacpac",
                databaseName: "TestDatabase",
                isNewDatabase: true,
                ownerUri: ownerUri,
            };

            const resolveSpy = sandbox.spy(controller.dialogResult, "resolve");
            const response = await requestHandler!(params);

            expect(response.success).to.be.false;
            expect(response.errorMessage).to.equal("Deployment failed: Permission denied");
            expect(resolveSpy).to.not.have.been.called;
        });

        test("deploy DACPAC handles exception", async () => {
            dacFxServiceStub.deployDacpac.rejects(new Error("Network timeout"));
            createController();

            const requestHandler = requestHandlers.get(DeployDacpacWebviewRequest.type.method);
            const params = {
                packageFilePath: "C:\\test\\database.dacpac",
                databaseName: "TestDatabase",
                isNewDatabase: true,
                ownerUri: ownerUri,
            };

            const response = await requestHandler!(params);

            expect(response.success).to.be.false;
            expect(response.errorMessage).to.equal("Network timeout");
        });
    });

    suite("Extract Operations", () => {
        test("extract DACPAC succeeds", async () => {
            const mockResult: DacFxResult = {
                success: true,
                errorMessage: undefined,
                operationId: "extract-123",
            };

            dacFxServiceStub.extractDacpac.resolves(mockResult);
            createController();

            const requestHandler = requestHandlers.get(ExtractDacpacWebviewRequest.type.method);
            expect(requestHandler, "Request handler was not registered").to.be.a("function");

            const params = {
                databaseName: "SourceDatabase",
                packageFilePath: "C:\\output\\database.dacpac",
                applicationName: "MyApp",
                applicationVersion: "1.0.0",
                ownerUri: ownerUri,
            };

            const response = await requestHandler!(params);

            expect(dacFxServiceStub.extractDacpac).to.have.been.calledOnce;
            expect(dacFxServiceStub.extractDacpac).to.have.been.calledWith(
                params.databaseName,
                params.packageFilePath,
                params.applicationName,
                params.applicationVersion,
                params.ownerUri,
                0,
            );
            expect(response.success).to.be.true;
        });

        test("extract DACPAC returns error on failure", async () => {
            const mockResult: DacFxResult = {
                success: false,
                errorMessage: "Extraction failed: Database not found",
                operationId: "extract-456",
            };

            dacFxServiceStub.extractDacpac.resolves(mockResult);
            createController();

            const requestHandler = requestHandlers.get(ExtractDacpacWebviewRequest.type.method);
            const params = {
                databaseName: "NonExistentDatabase",
                packageFilePath: "C:\\output\\database.dacpac",
                applicationName: "MyApp",
                applicationVersion: "1.0.0",
                ownerUri: ownerUri,
            };

            const response = await requestHandler!(params);

            expect(response.success).to.be.false;
            expect(response.errorMessage).to.equal("Extraction failed: Database not found");
        });
    });

    suite("Import Operations", () => {
        test("import BACPAC succeeds", async () => {
            const mockResult: DacFxResult = {
                success: true,
                errorMessage: undefined,
                operationId: "import-123",
            };

            dacFxServiceStub.importBacpac.resolves(mockResult);
            createController();

            const requestHandler = requestHandlers.get(ImportBacpacWebviewRequest.type.method);
            expect(requestHandler, "Request handler was not registered").to.be.a("function");

            const params = {
                packageFilePath: "C:\\backup\\database.bacpac",
                databaseName: "RestoredDatabase",
                ownerUri: ownerUri,
            };

            const response = await requestHandler!(params);

            expect(dacFxServiceStub.importBacpac).to.have.been.calledOnce;
            expect(dacFxServiceStub.importBacpac).to.have.been.calledWith(
                params.packageFilePath,
                params.databaseName,
                params.ownerUri,
                0,
            );
            expect(response.success).to.be.true;
        });

        test("import BACPAC returns error on failure", async () => {
            const mockResult: DacFxResult = {
                success: false,
                errorMessage: "Import failed: Corrupted BACPAC file",
                operationId: "import-456",
            };

            dacFxServiceStub.importBacpac.resolves(mockResult);
            createController();

            const requestHandler = requestHandlers.get(ImportBacpacWebviewRequest.type.method);
            const params = {
                packageFilePath: "C:\\backup\\corrupted.bacpac",
                databaseName: "TestDatabase",
                ownerUri: ownerUri,
            };

            const response = await requestHandler!(params);

            expect(response.success).to.be.false;
            expect(response.errorMessage).to.equal("Import failed: Corrupted BACPAC file");
        });
    });

    suite("Export Operations", () => {
        test("export BACPAC succeeds", async () => {
            const mockResult: DacFxResult = {
                success: true,
                errorMessage: undefined,
                operationId: "export-123",
            };

            dacFxServiceStub.exportBacpac.resolves(mockResult);
            createController();

            const requestHandler = requestHandlers.get(ExportBacpacWebviewRequest.type.method);
            expect(requestHandler, "Request handler was not registered").to.be.a("function");

            const params = {
                databaseName: "SourceDatabase",
                packageFilePath: "C:\\backup\\database.bacpac",
                ownerUri: ownerUri,
            };

            const response = await requestHandler!(params);

            expect(dacFxServiceStub.exportBacpac).to.have.been.calledOnce;
            expect(dacFxServiceStub.exportBacpac).to.have.been.calledWith(
                params.databaseName,
                params.packageFilePath,
                params.ownerUri,
                0,
            );
            expect(response.success).to.be.true;
        });

        test("export BACPAC returns error on failure", async () => {
            const mockResult: DacFxResult = {
                success: false,
                errorMessage: "Export failed: Insufficient permissions",
                operationId: "export-456",
            };

            dacFxServiceStub.exportBacpac.resolves(mockResult);
            createController();

            const requestHandler = requestHandlers.get(ExportBacpacWebviewRequest.type.method);
            const params = {
                databaseName: "ProtectedDatabase",
                packageFilePath: "C:\\backup\\database.bacpac",
                ownerUri: ownerUri,
            };

            const response = await requestHandler!(params);

            expect(response.success).to.be.false;
            expect(response.errorMessage).to.equal("Export failed: Insufficient permissions");
        });
    });

    suite("File Path Validation", () => {
        test("validates existing DACPAC file", async () => {
            fsExistsSyncStub.returns(true);
            createController();

            const requestHandler = requestHandlers.get(ValidateFilePathWebviewRequest.type.method);
            expect(requestHandler, "Request handler was not registered").to.be.a("function");

            const response = await requestHandler!({
                filePath: "C:\\test\\database.dacpac",
                shouldExist: true,
            });

            expect(response.isValid).to.be.true;
            expect(response.errorMessage).to.be.undefined;
        });

        test("rejects non-existent file when it should exist", async () => {
            fsExistsSyncStub.returns(false);
            createController();

            const requestHandler = requestHandlers.get(ValidateFilePathWebviewRequest.type.method);
            const response = await requestHandler!({
                filePath: "C:\\test\\missing.dacpac",
                shouldExist: true,
            });

            expect(response.isValid).to.be.false;
            expect(response.errorMessage).to.equal(LocConstants.DataTierApplication.FileNotFound);
        });

        test("rejects empty file path", async () => {
            createController();

            const requestHandler = requestHandlers.get(ValidateFilePathWebviewRequest.type.method);
            const response = await requestHandler!({
                filePath: "",
                shouldExist: true,
            });

            expect(response.isValid).to.be.false;
            expect(response.errorMessage).to.equal(
                LocConstants.DataTierApplication.FilePathRequired,
            );
        });

        test("rejects invalid file extension", async () => {
            fsExistsSyncStub.returns(true);
            createController();

            const requestHandler = requestHandlers.get(ValidateFilePathWebviewRequest.type.method);
            const response = await requestHandler!({
                filePath: "C:\\test\\database.txt",
                shouldExist: true,
            });

            expect(response.isValid).to.be.false;
            expect(response.errorMessage).to.equal(
                LocConstants.DataTierApplication.InvalidFileExtension,
            );
        });

        test("validates output file path when directory exists", async () => {
            // File doesn't exist, but directory does
            fsExistsSyncStub.withArgs("C:\\output\\database.dacpac").returns(false);
            fsExistsSyncStub.withArgs("C:\\output").returns(true);
            createController();

            const requestHandler = requestHandlers.get(ValidateFilePathWebviewRequest.type.method);
            const response = await requestHandler!({
                filePath: "C:\\output\\database.dacpac",
                shouldExist: false,
            });

            expect(response.isValid).to.be.true;
        });

        test("warns when output file already exists", async () => {
            // Both file and directory exist
            fsExistsSyncStub.returns(true);
            createController();

            const requestHandler = requestHandlers.get(ValidateFilePathWebviewRequest.type.method);
            const response = await requestHandler!({
                filePath: "C:\\output\\existing.dacpac",
                shouldExist: false,
            });

            expect(response.isValid).to.be.true;
            expect(response.errorMessage).to.equal(
                LocConstants.DataTierApplication.FileAlreadyExists,
            );
        });

        test("rejects output file path when directory doesn't exist", async () => {
            fsExistsSyncStub.returns(false);
            createController();

            const requestHandler = requestHandlers.get(ValidateFilePathWebviewRequest.type.method);
            const response = await requestHandler!({
                filePath: "C:\\nonexistent\\database.dacpac",
                shouldExist: false,
            });

            expect(response.isValid).to.be.false;
            expect(response.errorMessage).to.equal(
                LocConstants.DataTierApplication.DirectoryNotFound,
            );
        });
    });

    suite("Database Operations", () => {
        test("lists databases successfully", async () => {
            const mockDatabases = {
                databaseNames: ["master", "tempdb", "model", "msdb", "TestDB"],
            };

            sqlToolsClientStub.sendRequest
                .withArgs(ListDatabasesRequest.type, sinon.match.any)
                .resolves(mockDatabases);

            createController();

            const requestHandler = requestHandlers.get(ListDatabasesWebviewRequest.type.method);
            expect(requestHandler, "Request handler was not registered").to.be.a("function");

            const response = await requestHandler!({ ownerUri: ownerUri });

            expect(response.databases).to.deep.equal(mockDatabases.databaseNames);
            expect(sqlToolsClientStub.sendRequest).to.have.been.calledWith(
                ListDatabasesRequest.type,
                { ownerUri: ownerUri },
            );
        });

        test("returns empty array when list databases fails", async () => {
            sqlToolsClientStub.sendRequest
                .withArgs(ListDatabasesRequest.type, sinon.match.any)
                .rejects(new Error("Connection failed"));

            createController();

            const requestHandler = requestHandlers.get(ListDatabasesWebviewRequest.type.method);
            const response = await requestHandler!({ ownerUri: ownerUri });

            expect(response.databases).to.be.an("array").that.is.empty;
        });
    });

    suite("Database Name Validation", () => {
        test("validates non-existent database name for new database", async () => {
            const mockDatabases = {
                databaseNames: ["master", "tempdb", "model", "msdb"],
            };

            sqlToolsClientStub.sendRequest
                .withArgs(ListDatabasesRequest.type, sinon.match.any)
                .resolves(mockDatabases);

            createController();

            const requestHandler = requestHandlers.get(
                ValidateDatabaseNameWebviewRequest.type.method,
            );
            const response = await requestHandler!({
                databaseName: "NewDatabase",
                ownerUri: ownerUri,
                shouldNotExist: true,
            });

            expect(response.isValid).to.be.true;
        });

        test("allows existing database name for new database with warning", async () => {
            const mockDatabases = {
                databaseNames: ["master", "tempdb", "ExistingDB"],
            };

            sqlToolsClientStub.sendRequest
                .withArgs(ListDatabasesRequest.type, sinon.match.any)
                .resolves(mockDatabases);

            createController();

            const requestHandler = requestHandlers.get(
                ValidateDatabaseNameWebviewRequest.type.method,
            );
            const response = await requestHandler!({
                databaseName: "ExistingDB",
                ownerUri: ownerUri,
                shouldNotExist: true,
            });

            expect(response.isValid).to.be.true;
            expect(response.errorMessage).to.equal(
                LocConstants.DataTierApplication.DatabaseAlreadyExists,
            );
        });

        test("validates existing database name for extract/export", async () => {
            const mockDatabases = {
                databaseNames: ["master", "tempdb", "SourceDB"],
            };

            sqlToolsClientStub.sendRequest
                .withArgs(ListDatabasesRequest.type, sinon.match.any)
                .resolves(mockDatabases);

            createController();

            const requestHandler = requestHandlers.get(
                ValidateDatabaseNameWebviewRequest.type.method,
            );
            const response = await requestHandler!({
                databaseName: "SourceDB",
                ownerUri: ownerUri,
                shouldNotExist: false,
            });

            expect(response.isValid).to.be.true;
        });

        test("rejects non-existent database name for extract/export", async () => {
            const mockDatabases = {
                databaseNames: ["master", "tempdb"],
            };

            sqlToolsClientStub.sendRequest
                .withArgs(ListDatabasesRequest.type, sinon.match.any)
                .resolves(mockDatabases);

            createController();

            const requestHandler = requestHandlers.get(
                ValidateDatabaseNameWebviewRequest.type.method,
            );
            const response = await requestHandler!({
                databaseName: "MissingDB",
                ownerUri: ownerUri,
                shouldNotExist: false,
            });

            expect(response.isValid).to.be.false;
            expect(response.errorMessage).to.equal(
                LocConstants.DataTierApplication.DatabaseNotFound,
            );
        });

        test("rejects empty database name", async () => {
            createController();

            const requestHandler = requestHandlers.get(
                ValidateDatabaseNameWebviewRequest.type.method,
            );
            const response = await requestHandler!({
                databaseName: "",
                ownerUri: ownerUri,
                shouldNotExist: true,
            });

            expect(response.isValid).to.be.false;
            expect(response.errorMessage).to.equal(
                LocConstants.DataTierApplication.DatabaseNameRequired,
            );
        });

        test("rejects database name with invalid characters", async () => {
            createController();

            const requestHandler = requestHandlers.get(
                ValidateDatabaseNameWebviewRequest.type.method,
            );
            const response = await requestHandler!({
                databaseName: "Invalid<>Database",
                ownerUri: ownerUri,
                shouldNotExist: true,
            });

            expect(response.isValid).to.be.false;
            expect(response.errorMessage).to.equal(
                LocConstants.DataTierApplication.InvalidDatabaseName,
            );
        });

        test("rejects database name that is too long", async () => {
            createController();

            const requestHandler = requestHandlers.get(
                ValidateDatabaseNameWebviewRequest.type.method,
            );
            const longName = "A".repeat(129); // Exceeds 128 character limit
            const response = await requestHandler!({
                databaseName: longName,
                ownerUri: ownerUri,
                shouldNotExist: true,
            });

            expect(response.isValid).to.be.false;
            expect(response.errorMessage).to.equal(
                LocConstants.DataTierApplication.DatabaseNameTooLong,
            );
        });

        test("validates database name case-insensitively with warning", async () => {
            const mockDatabases = {
                databaseNames: ["ExistingDB"],
            };

            sqlToolsClientStub.sendRequest
                .withArgs(ListDatabasesRequest.type, sinon.match.any)
                .resolves(mockDatabases);

            createController();

            const requestHandler = requestHandlers.get(
                ValidateDatabaseNameWebviewRequest.type.method,
            );
            const response = await requestHandler!({
                databaseName: "existingdb", // Different case
                ownerUri: ownerUri,
                shouldNotExist: true,
            });

            expect(response.isValid).to.be.true;
            expect(response.errorMessage).to.equal(
                LocConstants.DataTierApplication.DatabaseAlreadyExists,
            );
        });

        test("returns validation failed on error", async () => {
            sqlToolsClientStub.sendRequest
                .withArgs(ListDatabasesRequest.type, sinon.match.any)
                .rejects(new Error("Network error"));

            createController();

            const requestHandler = requestHandlers.get(
                ValidateDatabaseNameWebviewRequest.type.method,
            );
            const response = await requestHandler!({
                databaseName: "TestDB",
                ownerUri: ownerUri,
                shouldNotExist: true,
            });

            expect(response.isValid).to.be.false;
            // Now returns actual error message instead of generic one
            expect(response.errorMessage).to.include("Failed to validate database name");
            expect(response.errorMessage).to.include("Network error");
        });
    });

    suite("Cancel Operation", () => {
        test("cancel notification resolves dialog with undefined and disposes panel", async () => {
            createController();

            const cancelHandler = notificationHandlers.get(
                CancelDataTierApplicationWebviewNotification.type.method,
            );
            expect(cancelHandler, "Cancel handler was not registered").to.be.a("function");

            const resultPromise = controller.dialogResult.promise;
            const resolveSpy = sandbox.spy(controller.dialogResult, "resolve");

            (cancelHandler as () => void)();
            const resolvedValue = await resultPromise;

            expect(resolveSpy).to.have.been.calledOnceWithExactly(undefined);
            expect(panelStub.dispose).to.have.been.calledOnce;
            expect(resolvedValue).to.be.undefined;
        });
    });

    suite("Deploy to Existing Database Confirmation", () => {
        test("confirmation dialog shows and returns confirmed=true when user clicks Deploy", async () => {
            createController();

            const confirmHandler = requestHandlers.get(
                ConfirmDeployToExistingWebviewRequest.type.method,
            );
            expect(confirmHandler, "Confirm handler was not registered").to.be.a("function");

            // Mock user clicking "Deploy" button
            vscodeWrapperStub.showWarningMessageAdvanced.resolves(
                LocConstants.DataTierApplication.DeployToExistingConfirm,
            );

            const response = await confirmHandler!(undefined);

            expect(vscodeWrapperStub.showWarningMessageAdvanced).to.have.been.calledOnceWith(
                LocConstants.DataTierApplication.DeployToExistingMessage,
                { modal: true },
                [LocConstants.DataTierApplication.DeployToExistingConfirm],
            );
            expect(response.confirmed).to.be.true;
        });

        test("confirmation dialog returns confirmed=false when user clicks Cancel", async () => {
            createController();

            const confirmHandler = requestHandlers.get(
                ConfirmDeployToExistingWebviewRequest.type.method,
            );
            expect(confirmHandler, "Confirm handler was not registered").to.be.a("function");

            // Mock user clicking Cancel button (VS Code automatically adds this)
            vscodeWrapperStub.showWarningMessageAdvanced.resolves(undefined);

            const response = await confirmHandler!(undefined);

            expect(vscodeWrapperStub.showWarningMessageAdvanced).to.have.been.calledOnceWith(
                LocConstants.DataTierApplication.DeployToExistingMessage,
                { modal: true },
                [LocConstants.DataTierApplication.DeployToExistingConfirm],
            );
            expect(response.confirmed).to.be.false;
        });

        test("confirmation dialog returns confirmed=false when user dismisses dialog (ESC)", async () => {
            createController();

            const confirmHandler = requestHandlers.get(
                ConfirmDeployToExistingWebviewRequest.type.method,
            );
            expect(confirmHandler, "Confirm handler was not registered").to.be.a("function");

            // Mock user dismissing dialog with ESC (returns undefined)
            vscodeWrapperStub.showWarningMessageAdvanced.resolves(undefined);

            const response = await confirmHandler!(undefined);

            expect(vscodeWrapperStub.showWarningMessageAdvanced).to.have.been.calledOnceWith(
                LocConstants.DataTierApplication.DeployToExistingMessage,
                { modal: true },
                [LocConstants.DataTierApplication.DeployToExistingConfirm],
            );
            expect(response.confirmed).to.be.false;
        });
    });

    suite("Controller Initialization", () => {
        test("creates webview panel with correct configuration", () => {
            createController();

            expect(createWebviewPanelStub).to.have.been.calledOnce;
            expect(createWebviewPanelStub).to.have.been.calledWith(
                "mssql-react-webview",
                LocConstants.DataTierApplication.Title,
                sinon.match.any,
                sinon.match.any,
            );
        });

        test("registers all request handlers", () => {
            createController();

            expect(requestHandlers.has(DeployDacpacWebviewRequest.type.method)).to.be.true;
            expect(requestHandlers.has(ExtractDacpacWebviewRequest.type.method)).to.be.true;
            expect(requestHandlers.has(ImportBacpacWebviewRequest.type.method)).to.be.true;
            expect(requestHandlers.has(ExportBacpacWebviewRequest.type.method)).to.be.true;
            expect(requestHandlers.has(ValidateFilePathWebviewRequest.type.method)).to.be.true;
            expect(requestHandlers.has(ListDatabasesWebviewRequest.type.method)).to.be.true;
            expect(requestHandlers.has(ValidateDatabaseNameWebviewRequest.type.method)).to.be.true;
            expect(requestHandlers.has(ListConnectionsWebviewRequest.type.method)).to.be.true;
            expect(requestHandlers.has(ConnectToServerWebviewRequest.type.method)).to.be.true;
            expect(requestHandlers.has(ConfirmDeployToExistingWebviewRequest.type.method)).to.be
                .true;
        });

        test("registers cancel notification handler", () => {
            createController();

            expect(
                notificationHandlers.has(CancelDataTierApplicationWebviewNotification.type.method),
            ).to.be.true;
        });

        test("returns correct owner URI", () => {
            createController();

            expect(controller.ownerUri).to.equal(ownerUri);
        });
    });

    suite("Connection Operations", () => {
        let connectionStoreStub: sinon.SinonStubbedInstance<ConnectionStore>;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let mockConnections: any[];

        setup(() => {
            connectionStoreStub = sandbox.createStubInstance(ConnectionStore);
            sandbox.stub(connectionManagerStub, "connectionStore").get(() => connectionStoreStub);

            // Create mock connection profiles
            mockConnections = [
                {
                    server: "server1.database.windows.net",
                    database: "db1",
                    user: "admin",
                    profileName: "Server 1 - db1",
                    id: "conn1",
                    authenticationType: 2, // SQL Login
                },
                {
                    server: "localhost",
                    database: "master",
                    user: undefined,
                    profileName: "Local Server",
                    id: "conn2",
                    authenticationType: 1, // Integrated
                },
                {
                    server: "server2.database.windows.net",
                    database: undefined,
                    user: "user@domain.com",
                    profileName: "Azure Server",
                    id: "conn3",
                    authenticationType: 3, // Azure MFA
                },
            ];
        });

        test("lists connections successfully", async () => {
            connectionStoreStub.getRecentlyUsedConnections.returns(mockConnections);

            // Mock active connections - conn1 is connected
            const mockActiveConnections = {
                uri1: {
                    credentials: {
                        server: "server1.database.windows.net",
                        database: "db1",
                    },
                },
            };
            sandbox
                .stub(connectionManagerStub, "activeConnections")
                .get(() => mockActiveConnections);

            createController();

            const handler = requestHandlers.get(ListConnectionsWebviewRequest.type.method);
            expect(handler).to.exist;

            const result = await handler!({});

            expect(result).to.exist;
            expect(result.connections).to.have.lengthOf(3);

            // Verify first connection
            const conn1 = result.connections[0];
            expect(conn1.server).to.equal("server1.database.windows.net");
            expect(conn1.database).to.equal("db1");
            expect(conn1.userName).to.equal("admin");
            expect(conn1.authenticationType).to.equal("SQL Login");
            expect(conn1.isConnected).to.be.true;
            expect(conn1.profileId).to.equal("conn1");
            expect(conn1.displayName).to.include("Server 1 - db1");

            // Verify second connection
            const conn2 = result.connections[1];
            expect(conn2.server).to.equal("localhost");
            expect(conn2.authenticationType).to.equal("Integrated");
            expect(conn2.isConnected).to.be.false;

            // Verify third connection
            const conn3 = result.connections[2];
            expect(conn3.server).to.equal("server2.database.windows.net");
            expect(conn3.authenticationType).to.equal("Azure MFA");
            expect(conn3.isConnected).to.be.false;
        });

        test("returns empty array when getRecentlyUsedConnections fails", async () => {
            connectionStoreStub.getRecentlyUsedConnections.throws(
                new Error("Connection store error"),
            );

            createController();

            const handler = requestHandlers.get(ListConnectionsWebviewRequest.type.method);
            expect(handler).to.exist;

            const result = await handler!({});

            expect(result).to.exist;
            expect(result.connections).to.be.an("array").that.is.empty;
        });

        test("builds display name correctly with all fields", async () => {
            connectionStoreStub.getRecentlyUsedConnections.returns([mockConnections[0]]);
            sandbox.stub(connectionManagerStub, "activeConnections").get(() => ({}));

            createController();

            const handler = requestHandlers.get(ListConnectionsWebviewRequest.type.method);
            const result = await handler!({});

            const conn = result.connections[0];
            expect(conn.displayName).to.include("Server 1 - db1");
            expect(conn.displayName).to.include("(db1)");
            expect(conn.displayName).to.include("admin");
        });

        test("builds display name without optional fields", async () => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const minimalConnection: any = {
                server: "testserver",
                database: undefined,
                user: undefined,
                profileName: undefined,
                id: "conn-minimal",
                authenticationType: 1,
            };

            connectionStoreStub.getRecentlyUsedConnections.returns([minimalConnection]);
            sandbox.stub(connectionManagerStub, "activeConnections").get(() => ({}));

            createController();

            const handler = requestHandlers.get(ListConnectionsWebviewRequest.type.method);
            const result = await handler!({});

            const conn = result.connections[0];
            expect(conn.displayName).to.equal("testserver");
        });

        test("connects to server successfully when not already connected", async () => {
            connectionStoreStub.getRecentlyUsedConnections.returns([mockConnections[0]]);
            connectionManagerStub.getUriForConnection.returns("new-owner-uri");
            connectionManagerStub.connect.resolves(true);

            // No active connections initially
            sandbox.stub(connectionManagerStub, "activeConnections").get(() => ({}));

            createController();

            const handler = requestHandlers.get(ConnectToServerWebviewRequest.type.method);
            expect(handler).to.exist;

            const result = await handler!({ profileId: "conn1" });

            expect(result).to.exist;
            expect(result.isConnected).to.be.true;
            expect(result.ownerUri).to.equal("new-owner-uri");
            expect(result.errorMessage).to.be.undefined;

            // Called twice: once to check if connected, once after connecting to get the URI
            expect(connectionManagerStub.getUriForConnection).to.have.been.calledTwice;
            expect(connectionManagerStub.connect).to.have.been.calledOnce;
        });

        test("retrieves ownerUri after successful connection when initially undefined", async () => {
            // This test validates the bug fix where getUriForConnection returns undefined
            // before connection (since connection doesn't exist yet), but after connect()
            // succeeds, we call getUriForConnection again to get the actual URI
            connectionStoreStub.getRecentlyUsedConnections.returns([mockConnections[0]]);

            // First call returns undefined (connection doesn't exist yet)
            // Second call returns the actual URI (after connection is established)
            connectionManagerStub.getUriForConnection
                .onFirstCall()
                .returns(undefined)
                .onSecondCall()
                .returns("generated-owner-uri-123");

            connectionManagerStub.connect.resolves(true);

            // No active connections initially
            sandbox.stub(connectionManagerStub, "activeConnections").get(() => ({}));

            createController();

            const handler = requestHandlers.get(ConnectToServerWebviewRequest.type.method);
            expect(handler).to.exist;

            const result = await handler!({ profileId: "conn1" });

            expect(result).to.exist;
            expect(result.isConnected).to.be.true;
            expect(result.ownerUri).to.equal("generated-owner-uri-123");
            expect(result.errorMessage).to.be.undefined;

            // Verify the sequence of calls
            expect(connectionManagerStub.getUriForConnection).to.have.been.calledTwice;
            expect(connectionManagerStub.connect).to.have.been.calledOnce;
            // connect() should be called with empty string to let it generate the URI
            expect(connectionManagerStub.connect).to.have.been.calledWith("", mockConnections[0]);
        });

        test("returns existing ownerUri when already connected", async () => {
            connectionStoreStub.getRecentlyUsedConnections.returns([mockConnections[0]]);
            connectionManagerStub.getUriForConnection.returns("existing-owner-uri");

            // Mock that connection already exists
            const mockActiveConnections = {
                "existing-owner-uri": {
                    credentials: {
                        server: "server1.database.windows.net",
                        database: "db1",
                    },
                },
            };
            sandbox
                .stub(connectionManagerStub, "activeConnections")
                .get(() => mockActiveConnections);

            createController();

            const handler = requestHandlers.get(ConnectToServerWebviewRequest.type.method);
            const result = await handler!({ profileId: "conn1" });

            expect(result.isConnected).to.be.true;
            expect(result.ownerUri).to.equal("existing-owner-uri");
            expect(result.errorMessage).to.be.undefined;

            // Should not call connect since already connected
            expect(connectionManagerStub.connect).to.not.have.been.called;
        });

        test("returns error when profile not found", async () => {
            connectionStoreStub.getRecentlyUsedConnections.returns(mockConnections);
            sandbox.stub(connectionManagerStub, "activeConnections").get(() => ({}));

            createController();

            const handler = requestHandlers.get(ConnectToServerWebviewRequest.type.method);
            const result = await handler!({ profileId: "non-existent-id" });

            expect(result.isConnected).to.be.false;
            expect(result.ownerUri).to.equal("");
            expect(result.errorMessage).to.equal("Connection profile not found");
        });

        test("returns error when connection fails", async () => {
            connectionStoreStub.getRecentlyUsedConnections.returns([mockConnections[0]]);
            connectionManagerStub.getUriForConnection.returns("new-owner-uri");
            connectionManagerStub.connect.resolves(false); // Connection failed

            sandbox.stub(connectionManagerStub, "activeConnections").get(() => ({}));

            createController();

            const handler = requestHandlers.get(ConnectToServerWebviewRequest.type.method);
            const result = await handler!({ profileId: "conn1" });

            expect(result.isConnected).to.be.false;
            expect(result.ownerUri).to.equal("");
            expect(result.errorMessage).to.equal("Failed to connect to server");
        });

        test("handles connection exception gracefully", async () => {
            connectionStoreStub.getRecentlyUsedConnections.returns([mockConnections[0]]);
            connectionManagerStub.getUriForConnection.returns("new-owner-uri");
            connectionManagerStub.connect.rejects(new Error("Network timeout"));

            sandbox.stub(connectionManagerStub, "activeConnections").get(() => ({}));

            createController();

            const handler = requestHandlers.get(ConnectToServerWebviewRequest.type.method);
            const result = await handler!({ profileId: "conn1" });

            expect(result.isConnected).to.be.false;
            expect(result.ownerUri).to.equal("");
            expect(result.errorMessage).to.include("Connection failed");
            expect(result.errorMessage).to.include("Network timeout");
        });

        test("identifies connected server by matching server and database", async () => {
            connectionStoreStub.getRecentlyUsedConnections.returns(mockConnections);

            // Mock active connection with matching server and database
            const mockActiveConnections = {
                uri1: {
                    credentials: {
                        server: "localhost",
                        database: "master",
                    },
                },
            };
            sandbox
                .stub(connectionManagerStub, "activeConnections")
                .get(() => mockActiveConnections);

            createController();

            const handler = requestHandlers.get(ListConnectionsWebviewRequest.type.method);
            const result = await handler!({});

            // Find localhost connection
            const localhostConn = result.connections.find((c) => c.server === "localhost");
            expect(localhostConn).to.exist;
            expect(localhostConn!.isConnected).to.be.true;
        });

        test("identifies connected server when database is undefined in both", async () => {
            const connectionWithoutDb = {
                ...mockConnections[2],
                database: undefined,
            };
            connectionStoreStub.getRecentlyUsedConnections.returns([connectionWithoutDb]);

            // Mock active connection without database
            const mockActiveConnections = {
                uri1: {
                    credentials: {
                        server: "server2.database.windows.net",
                        database: undefined,
                    },
                },
            };
            sandbox
                .stub(connectionManagerStub, "activeConnections")
                .get(() => mockActiveConnections);

            createController();

            const handler = requestHandlers.get(ListConnectionsWebviewRequest.type.method);
            const result = await handler!({});

            expect(result.connections[0].isConnected).to.be.true;
        });

        test("generates profileId from server and database when id is missing", async () => {
            const connectionWithoutId: (typeof mockConnections)[0] = {
                ...mockConnections[0],
                id: undefined,
            };
            connectionStoreStub.getRecentlyUsedConnections.returns([connectionWithoutId]);
            sandbox.stub(connectionManagerStub, "activeConnections").get(() => ({}));

            createController();

            const handler = requestHandlers.get(ListConnectionsWebviewRequest.type.method);
            const result = await handler!({});

            expect(result.connections[0].profileId).to.equal("server1.database.windows.net_db1");
        });

        test("matches connection by server and database when both provided", async () => {
            connectionStoreStub.getRecentlyUsedConnections.returns(mockConnections);
            sandbox.stub(connectionManagerStub, "activeConnections").get(() => ({}));

            createController();

            const handler = requestHandlers.get(ListConnectionsWebviewRequest.type.method);
            const result = await handler!({});

            // Find the connection that matches server1.database.windows.net and db1
            const matchingConnection = result.connections.find(
                (conn) => conn.server === "server1.database.windows.net" && conn.database === "db1",
            );

            expect(matchingConnection).to.exist;
            expect(matchingConnection!.profileId).to.equal("conn1");
        });

        test("matches connection by server only when database is not specified", async () => {
            connectionStoreStub.getRecentlyUsedConnections.returns(mockConnections);
            sandbox.stub(connectionManagerStub, "activeConnections").get(() => ({}));

            createController();

            const handler = requestHandlers.get(ListConnectionsWebviewRequest.type.method);
            const result = await handler!({});

            // Find the connection that matches localhost (conn2 has master database)
            const matchingConnection = result.connections.find(
                (conn) => conn.server === "localhost" && conn.database === "master",
            );

            expect(matchingConnection).to.exist;
            expect(matchingConnection!.profileId).to.equal("conn2");
        });

        test("finds connection when database is undefined in profile", async () => {
            // This tests the scenario where a server-level connection exists
            // (database is undefined in the connection profile)
            connectionStoreStub.getRecentlyUsedConnections.returns(mockConnections);
            sandbox.stub(connectionManagerStub, "activeConnections").get(() => ({}));

            createController();

            const handler = requestHandlers.get(ListConnectionsWebviewRequest.type.method);
            const result = await handler!({});

            // conn3 has undefined database - should still be findable by server
            const matchingConnection = result.connections.find(
                (conn) => conn.server === "server2.database.windows.net",
            );

            expect(matchingConnection).to.exist;
            expect(matchingConnection!.profileId).to.equal("conn3");
            expect(matchingConnection!.database).to.be.undefined;
        });

        test("connection matching is case-sensitive for server names", async () => {
            connectionStoreStub.getRecentlyUsedConnections.returns(mockConnections);
            sandbox.stub(connectionManagerStub, "activeConnections").get(() => ({}));

            createController();

            const handler = requestHandlers.get(ListConnectionsWebviewRequest.type.method);
            const result = await handler!({});

            // Case must match exactly
            const matchingConnection = result.connections.find(
                (conn) => conn.server === "LOCALHOST", // Different case
            );

            expect(matchingConnection).to.be.undefined;

            // Correct case should work
            const correctMatch = result.connections.find((conn) => conn.server === "localhost");
            expect(correctMatch).to.exist;
        });
    });

    suite("Database Operations with Empty OwnerUri", () => {
        test("returns empty array when ownerUri is empty for list databases", async () => {
            createController();

            const handler = requestHandlers.get(ListDatabasesWebviewRequest.type.method);
            expect(handler).to.exist;

            const result = await handler!({ ownerUri: "" });

            expect(result).to.exist;
            expect(result.databases).to.be.an("array").that.is.empty;
        });

        test("returns empty array when ownerUri is whitespace for list databases", async () => {
            createController();

            const handler = requestHandlers.get(ListDatabasesWebviewRequest.type.method);
            const result = await handler!({ ownerUri: "   " });

            expect(result.databases).to.be.an("array").that.is.empty;
        });

        test("returns validation error when ownerUri is empty for database name validation", async () => {
            createController();

            const handler = requestHandlers.get(ValidateDatabaseNameWebviewRequest.type.method);
            expect(handler).to.exist;

            const result = await handler!({
                databaseName: "TestDB",
                ownerUri: "",
                shouldNotExist: true,
            });

            expect(result).to.exist;
            expect(result.isValid).to.be.false;
            expect(result.errorMessage).to.include("No active connection");
        });

        test("returns validation error when ownerUri is whitespace for database name validation", async () => {
            createController();

            const handler = requestHandlers.get(ValidateDatabaseNameWebviewRequest.type.method);
            const result = await handler!({
                databaseName: "TestDB",
                ownerUri: "   ",
                shouldNotExist: true,
            });

            expect(result.isValid).to.be.false;
            expect(result.errorMessage).to.include("No active connection");
        });
    });
});
