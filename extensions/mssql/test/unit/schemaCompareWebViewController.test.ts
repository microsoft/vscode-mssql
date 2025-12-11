/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as sinon from "sinon";
import sinonChai from "sinon-chai";
import { expect } from "chai";
import * as chai from "chai";
import * as vscode from "vscode";
import * as mssql from "vscode-mssql";

chai.use(sinonChai);

import { SchemaCompareWebViewController } from "../../src/schemaCompare/schemaCompareWebViewController";
import { TreeNodeInfo } from "../../src/objectExplorer/nodes/treeNodeInfo";
import ConnectionManager, { ConnectionInfo } from "../../src/controllers/connectionManager";
import {
    ExtractTarget,
    SchemaCompareWebViewState,
    SchemaDifferenceType,
    SchemaUpdateAction,
    TaskExecutionMode,
} from "../../src/sharedInterfaces/schemaCompare";
import * as scUtils from "../../src/schemaCompare/schemaCompareUtils";
import VscodeWrapper from "../../src/controllers/vscodeWrapper";
import { IconUtils } from "../../src/utils/iconUtils";
import * as Utils from "../../src/models/utils";
import { IConnectionProfile } from "../../src/models/interfaces";
import { AzureAuthType } from "../../src/models/contracts/azure";
import { SchemaCompareService } from "../../src/services/schemaCompareService";

suite("SchemaCompareWebViewController Tests", () => {
    let controller: SchemaCompareWebViewController;
    let sandbox: sinon.SinonSandbox;
    let mockContext: vscode.ExtensionContext;
    let treeNode: TreeNodeInfo;
    let mockConnectionInfo: ConnectionInfo;
    let mockServerConnInfo: mssql.IConnectionInfo;
    let mockInitialState: SchemaCompareWebViewState;
    let schemaCompareService: mssql.ISchemaCompareService;
    let connectionManagerStub: sinon.SinonStubbedInstance<ConnectionManager>;
    let vscodeWrapperStub: sinon.SinonStubbedInstance<VscodeWrapper>;
    let connectionChangedEmitter: vscode.EventEmitter<void>;
    const schemaCompareWebViewTitle = "Schema Compare";
    const operationId = "AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE";
    let generateOperationIdStub: sinon.SinonStub<[], string>;

    const differences = [
        {
            children: [],
            differenceType: 0,
            included: true,
            name: "Table",
            parent: null,
            sourceObjectType: "Microsoft.Data.Tools.Schema.Sql.SchemaModel.SqlTable",
            sourceScript:
                "CREATE TABLE [dbo].[Customers] (\r\n [CustomerID] INT NOT NULL,\r\n [CustomerName] NVARCHAR (100) NOT NULL,\r\n [Email] NVARCHAR (100) NOT NULL,\r\n [Phone] NVARCHAR (20) NULL,\r\n PRIMARY KEY CLUSTERED ([CustomerID] ASC)\r\n);\r\nGO",
            sourceValue: ["dbo", "CUstomers"],
            targetObjectType: null,
            targetScript: null,
            targetValue: null,
            updateAction: 2,
        },
        {
            children: [],
            differenceType: 0,
            included: true,
            name: "Table",
            parent: null,
            sourceObjectType: "Microsoft.Data.Tools.Schema.Sql.SchemaModel.SqlTable",
            sourceScript:
                "CREATE TABLE [dbo].[Orders] (\r\n [OrderID] INT NOT NULL,\r\n [CustomerID] INT NULL,\r\n [OrderDate] DATE NOT NULL,\r\n [TotalAmount] DECIMAL (10, 2) NOT NULL,\r\n PRIMARY KEY CLUSTERED ([OrderID] ASC),\r\n FOREIGN KEY ([CustomerID]) REFERENCES [dbo].[Customers] ([CustomerID])\r\n);\r\nGO",
            sourceValue: ["dbo", "Customers"],
            targetObjectType: null,
            targetScript: null,
            targetValue: null,
            updateAction: 2,
        },
        {
            children: [],
            differenceType: 0,
            included: true,
            name: "Table",
            parent: null,
            sourceObjectType: "Microsoft.Data.Tools.Schema.Sql.SchemaModel.SqlTable",
            sourceScript:
                "CREATE TABLE [dbo].[Products] (\r\n [ProductID] INT NOT NULL,\r\n [ProductName] NVARCHAR (100) NOT NULL,\r\n [Price] DECIMAL (10, 2) NOT NULL,\r\n [StockQuantity] INT NOT NULL,\r\n PRIMARY KEY CLUSTERED ([ProductID] ASC)\r\n);\r\nGO",
            sourceValue: ["dbo", "Products"],
            targetObjectType: null,
            targetScript: null,
            targetValue: null,
            updateAction: 2,
        },
    ];

    const deploymentOptions: mssql.DeploymentOptions = {
        excludeObjectTypes: {
            value: ["ServerTriggers", "Routes", "LinkedServerLogins", "Endpoints", "ErrorMessages"],
            description: "",
            displayName: "",
        },
        booleanOptionsDictionary: {
            allowDropBlockingAssemblies: {
                value: true,
                description:
                    "This property is used by SqlClr deployment to cause any blocking assemblies to be dropped as part of the deployment plan. By default, any blocking/referencing assemblies will block an assembly update if the referencing assembly needs to be dropped.",
                displayName: "Allow drop blocking assemblies",
            },
            allowExternalLanguagePaths: {
                value: false,
                description:
                    "Allows file paths, if available, to be used to generate external language statements.",
                displayName: "Use file paths for external language",
            },
            allowExternalLibraryPaths: {
                value: false,
                description:
                    "Allows file paths, if available, to be used to generate external library statements.",
                displayName: "Use file paths for external libraries",
            },
        },
        objectTypesDictionary: {
            aggregates: "Aggregates",
            applicationRoles: "Application Roles",
            assemblies: "Assemblies",
        },
    };

    const deploymentOptionsResultMock: mssql.SchemaCompareOptionsResult = {
        success: true,
        errorMessage: "",
        defaultDeploymentOptions: deploymentOptions,
    };

    const databaseSourceEndpointInfo: mssql.SchemaCompareEndpointInfo = {
        endpointType: 0,
        serverDisplayName: "localhost,1433 (sa)",
        serverName: "localhost,1433",
        ownerUri: "localhost,1433_undefined_sa_undefined",
        packageFilePath: "",
        connectionName: "",
        projectFilePath: "",
        targetScripts: [],
        dataSchemaProvider: "",
        extractTarget: 5,
        databaseName: "",
        connectionDetails: undefined,
    };

    const sourceEndpointInfo = {
        endpointType: 2,
        packageFilePath: "",
        serverDisplayName: "",
        serverName: "",
        databaseName: "",
        ownerUri: "",
        connectionDetails: undefined,
        projectFilePath: "/TestSqlProject/TestProject/TestProject.sqlproj",
        targetScripts: ["/TestSqlProject/TestProject/Address.sql"],
        extractTarget: 5,
        dataSchemaProvider: "",
    };

    const targetEndpointInfo = {
        endpointType: 0,
        packageFilePath: "",
        serverDisplayName: "localhost,1433 (sa)",
        serverName: "localhost,1433",
        databaseName: "master",
        ownerUri:
            "connection:providerName:MSSQL|server:localhost,1433|trustServerCertificate:true|user:sa|groupId:C777F06B-202E-4480-B475-FA416154D458",
        connectionDetails: {
            options: {},
        },
        connectionName: "",
        projectFilePath: "",
        targetScripts: [],
        extractTarget: 5,
        dataSchemaProvider: "",
    };

    setup(() => {
        sandbox = sinon.createSandbox();

        mockInitialState = {
            isSqlProjectExtensionInstalled: false,
            isIncludeExcludeAllOperationInProgress: false,
            isComparisonInProgress: false,
            activeServers: {},
            databases: [],
            defaultDeploymentOptionsResult: deploymentOptionsResultMock,
            intermediaryOptionsResult: undefined,
            endpointsSwitched: false,
            auxiliaryEndpointInfo: undefined,
            sourceEndpointInfo: databaseSourceEndpointInfo,
            targetEndpointInfo: undefined,
            scmpSourceExcludes: [],
            scmpTargetExcludes: [],
            originalSourceExcludes: new Map<string, mssql.DiffEntry>(),
            originalTargetExcludes: new Map<string, mssql.DiffEntry>(),
            sourceTargetSwitched: false,
            schemaCompareResult: {
                operationId: operationId,
                areEqual: false,
                differences: differences,
                success: true,
                errorMessage: "",
            },
            generateScriptResultStatus: undefined,
            publishDatabaseChangesResultStatus: undefined,
            schemaComparePublishProjectResult: undefined,
            schemaCompareIncludeExcludeResult: undefined,
            schemaCompareOpenScmpResult: undefined,
            saveScmpResultStatus: undefined,
            cancelResultStatus: undefined,
            waitingForNewConnection: false,
            pendingConnectionEndpointType: null,
        };

        mockContext = {
            extensionUri: vscode.Uri.parse("file://test"),
            extensionPath: "path",
        } as unknown as vscode.ExtensionContext;

        IconUtils.initialize(mockContext.extensionUri);

        let context: mssql.TreeNodeContextValue = {
            type: "",
            subType: "",
            filterable: false,
            hasFilters: false,
        };

        let connInfo: IConnectionProfile = {
            applicationName: "vscode-msssql",
            authenticationType: "SqlLogin",
            azureAccountToken: undefined,
            connectTimeout: 15,
            password: "",
            server: "localhost,1433",
            trustServerCertificate: true,
            user: "sa",
            database: undefined,
            email: "sa@microsoft.com",
            accountId: "",
            tenantId: "",
            port: 1433,
            expiresOn: undefined,
            encrypt: true,
            hostNameInCertificate: undefined,
            persistSecurityInfo: undefined,
            columnEncryptionSetting: undefined,
            secureEnclaves: undefined,
            attestationProtocol: undefined,
            enclaveAttestationUrl: undefined,
            commandTimeout: undefined,
            connectRetryCount: undefined,
            connectRetryInterval: undefined,
            workstationId: undefined,
            applicationIntent: undefined,
            currentLanguage: "en-us",
            pooling: undefined,
            maxPoolSize: undefined,
            minPoolSize: undefined,
            loadBalanceTimeout: undefined,
            replication: undefined,
            attachDbFilename: undefined,
            failoverPartner: undefined,
            multiSubnetFailover: undefined,
            multipleActiveResultSets: undefined,
            packetSize: undefined,
            typeSystemVersion: undefined,
            connectionString: "",
            profileName: "",
            id: "",
            groupId: "",
            savePassword: false,
            emptyPasswordInput: false,
            azureAuthType: AzureAuthType.AuthCodeGrant,
            accountStore: undefined,
            isValidProfile: function (): boolean {
                throw new Error("Function not implemented.");
            },
            isAzureActiveDirectory: function (): boolean {
                throw new Error("Function not implemented.");
            },
            containerName: undefined,
        };

        treeNode = new TreeNodeInfo(
            "localhost,1433, <default> (sa)",
            context,
            vscode.TreeItemCollapsibleState.None,
            "localhost,1433",
            null,
            "Server",
            "localhost,1433_NULL_sa_SqlLogin_trustServerCertificate:true_applicationName:vscode-mssql",
            connInfo,
            undefined,
            null,
            undefined,
        );

        schemaCompareService = sandbox.createStubInstance(SchemaCompareService);

        connectionManagerStub = sandbox.createStubInstance(ConnectionManager);
        connectionChangedEmitter = new vscode.EventEmitter<void>();
        Object.defineProperty(connectionManagerStub, "onConnectionsChanged", {
            value: connectionChangedEmitter.event,
        });
        connectionManagerStub.getUriForConnection.returns("localhost,1433_undefined_sa_undefined");

        mockServerConnInfo = {
            server: "server1",
            profileName: "profile1",
        } as unknown as mssql.IConnectionInfo;

        mockConnectionInfo = {
            credentials: mockServerConnInfo,
        } as unknown as ConnectionInfo;

        sandbox.stub(connectionManagerStub, "activeConnections").get(() => ({
            conn_uri: mockConnectionInfo,
        }));

        connectionManagerStub.listDatabases.resolves(["db1", "db2"]);

        vscodeWrapperStub = sandbox.createStubInstance(VscodeWrapper);

        generateOperationIdStub = sandbox.stub(scUtils, "generateOperationId").returns(operationId);

        controller = new SchemaCompareWebViewController(
            mockContext,
            vscodeWrapperStub,
            treeNode,
            undefined,
            false,
            schemaCompareService,
            connectionManagerStub,
            deploymentOptionsResultMock,
            schemaCompareWebViewTitle,
        );
    });

    teardown(() => {
        generateOperationIdStub?.restore();

        connectionChangedEmitter?.dispose();
        sandbox.restore();
    });

    test("controller - initialize title - is 'Schema Compare'", () => {
        expect(controller.panel.title, "Webview Title should match").to.equal(
            schemaCompareWebViewTitle,
        );
    });

    test("start - resolves targetContext and calls launch with correct target", async () => {
        const mockTarget: mssql.SchemaCompareEndpointInfo = {
            endpointType: 1,
            serverName: "targetServer",
            databaseName: "targetDb",
            packageFilePath: "",
            serverDisplayName: "",
            ownerUri: "",
            connectionDetails: undefined,
            connectionName: "",
            projectFilePath: "",
            targetScripts: [],
            dataSchemaProvider: "",
            extractTarget: 5,
        };
        controller = new SchemaCompareWebViewController(
            mockContext,
            vscodeWrapperStub,
            undefined,
            mockTarget,
            false,
            schemaCompareService,
            connectionManagerStub,
            deploymentOptionsResultMock,
            schemaCompareWebViewTitle,
        );

        const launchStub = sinon.stub(controller, "launch").resolves();

        await controller.start(undefined, mockTarget, false);

        expect(launchStub).to.have.been.calledTwice;

        // First call: from constructor
        // Second call: from explicit start
        const [sourceArg2, targetArg2, runComparisonArg2] = launchStub.secondCall.args;

        // You can assert the second call matches your expectations
        expect(sourceArg2, "source should be undefined").to.be.undefined;
        expect(targetArg2, "target should match mockTarget").to.deep.equal(mockTarget);
        expect(runComparisonArg2, "runComparison should be false").to.be.false;

        launchStub.restore();
    });

    test("start - calls launch with runComparison true", async () => {
        const mockSource: mssql.SchemaCompareEndpointInfo = {
            endpointType: 1,
            serverName: "sourceServer",
            databaseName: "sourceDb",
            packageFilePath: "",
            serverDisplayName: "",
            ownerUri: "",
            connectionDetails: undefined,
            connectionName: "",
            projectFilePath: "",
            targetScripts: [],
            dataSchemaProvider: "",
            extractTarget: 5,
        };
        const mockTarget: mssql.SchemaCompareEndpointInfo = {
            endpointType: 1,
            serverName: "targetServer",
            databaseName: "targetDb",
            packageFilePath: "",
            serverDisplayName: "",
            ownerUri: "",
            connectionDetails: undefined,
            connectionName: "",
            projectFilePath: "",
            targetScripts: [],
            dataSchemaProvider: "",
            extractTarget: 5,
        };
        controller = new SchemaCompareWebViewController(
            mockContext,
            vscodeWrapperStub,
            mockSource,
            mockTarget,
            true,
            schemaCompareService,
            connectionManagerStub,
            deploymentOptionsResultMock,
            schemaCompareWebViewTitle,
        );

        const launchStub = sinon.stub(controller, "launch").resolves();

        await controller.start(mockSource, mockTarget, true);

        expect(launchStub).to.have.been.calledTwice;

        // Second call: from explicit start
        const [sourceArg2, targetArg2, runComparisonArg2] = launchStub.secondCall.args;
        expect(sourceArg2, "source should match mockSource").to.deep.equal(mockSource);
        expect(targetArg2, "target should match mockTarget").to.deep.equal(mockTarget);
        expect(runComparisonArg2, "runComparison should be true").to.be.true;

        launchStub.restore();
    });

    // lewissanchez todo: remove async method from constructor and call a seperate async method to "start" the controller with a source endpoint
    test.skip("start - called with sqlproject path - sets sourceEndpointInfo correctly", () => {
        const mockSqlProjectNode: mssql.SchemaCompareEndpointInfo = {
            endpointType: 1,
            serverName: "targetServer",
            databaseName: "targetDb",
            packageFilePath: "",
            serverDisplayName: "",
            ownerUri: "",
            connectionDetails: undefined,
            connectionName: "",
            projectFilePath: "c:\\TestSqlProject\\TestProject.sqlproj",
            targetScripts: [],
            dataSchemaProvider: "",
            extractTarget: 5,
        };

        const scController = new SchemaCompareWebViewController(
            mockContext,
            vscodeWrapperStub,
            mockSqlProjectNode,
            undefined,
            false,
            schemaCompareService,
            connectionManagerStub,
            deploymentOptionsResultMock,
            schemaCompareWebViewTitle,
        );

        const expected = {
            endpointType: 2,
            packageFilePath: "",
            serverDisplayName: "",
            serverName: "",
            databaseName: "",
            ownerUri: "",
            connectionDetails: undefined,
            projectFilePath: "c:\\TestSqlProject\\TestProject.sqlproj",
            targetScripts: [],
            dataSchemaProvider: undefined,
            extractTarget: 5,
        };

        expect(
            scController.state.sourceEndpointInfo,
            "sourceEndpointInfo should match the expected path",
        ).to.deep.equal(expected);
    });

    test("compare reducer - when called - completes successfully", async () => {
        const expectedCompareResultMock: mssql.SchemaCompareResult = {
            operationId: "AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE",
            areEqual: true,
            differences: [],
            success: true,
            errorMessage: "",
        };

        const compareStub = sandbox.stub(scUtils, "compare").resolves(expectedCompareResultMock);

        const payload = {
            deploymentOptions,
            sourceEndpointInfo,
            targetEndpointInfo,
        };

        const result = await controller["_reducerHandlers"].get("compare")(
            mockInitialState,
            payload,
        );

        expect(
            compareStub.firstCall.args,
            "compare should be called with correct arguments",
        ).to.deep.equal([operationId, TaskExecutionMode.execute, payload, schemaCompareService]);

        expect(compareStub, "compare should be called once").to.have.been.calledOnce;

        expect(result.schemaCompareResult, "compare should return expected result").to.deep.equal(
            expectedCompareResultMock,
        );

        compareStub.restore();
    });

    test("generateScript reducer - when called - completes successfully", async () => {
        const expectedScriptResultMock = {
            success: true,
            errorMessage: "",
        };

        const generateScriptStub = sandbox
            .stub(scUtils, "generateScript")
            .resolves(expectedScriptResultMock);

        const payload = {
            targetServerName: "localhost,1433",
            targetDatabaseName: "master",
        };

        const result = await controller["_reducerHandlers"].get("generateScript")(
            mockInitialState,
            payload,
        );

        expect(generateScriptStub, "generateScript should be called once").to.have.been.calledOnce;

        expect(
            generateScriptStub,
            "generateScript should be called with correct arguments",
        ).to.have.been.calledWith(
            operationId,
            TaskExecutionMode.script,
            payload,
            schemaCompareService,
            sinon.match.any,
        );

        expect(
            result.generateScriptResultStatus,
            "generateScript should return expected result",
        ).to.deep.equal(expectedScriptResultMock);

        generateScriptStub.restore();
    });

    test("publishDatabaseChanges reducer - when called - completes successfully", async () => {
        const expectedResultMock = {
            success: true,
            errorMessage: "",
        };

        const publishDatabaseChangesStub = sandbox
            .stub(scUtils, "publishDatabaseChanges")
            .resolves(expectedResultMock);

        const payload = {
            targetServerName: "localhost,1433",
            targetDatabaseName: "master",
        };

        const actualResult = await controller["_reducerHandlers"].get("publishDatabaseChanges")(
            mockInitialState,
            payload,
        );

        expect(publishDatabaseChangesStub, "publishDatabaseChanges should be called once").to.have
            .been.calledOnce;

        expect(
            publishDatabaseChangesStub.firstCall.args,
            "publishDatabaseChanges should be called with correct arguments",
        ).to.deep.equal([operationId, TaskExecutionMode.execute, payload, schemaCompareService]);

        expect(
            actualResult.publishDatabaseChangesResultStatus,
            "publishDatabaseChanges should return expected result",
        ).to.deep.equal(expectedResultMock);

        publishDatabaseChangesStub.restore();
    });

    test("publishProjectChanges reducer - when called - completes successfully", async () => {
        const expectedResultMock = {
            success: true,
            errorMessage: "",
            changedFiles: [],
            addedFiles: [],
            deletedFiles: [],
        };

        const publishProjectChangesStub = sandbox
            .stub(scUtils, "publishProjectChanges")
            .resolves(expectedResultMock);

        const payload = {
            targetProjectPath: "/TestSqlProject/TestProject/TestProject.sqlproj",
            targetFolderStructure: ExtractTarget.schemaObjectType,
            taskExecutionMode: TaskExecutionMode.execute,
        };

        const actualResult = await controller["_reducerHandlers"].get("publishProjectChanges")(
            mockInitialState,
            payload,
        );

        expect(publishProjectChangesStub, "publishProjectChanges should be called once").to.have
            .been.calledOnce;

        expect(
            publishProjectChangesStub.firstCall.args,
            "publishProjectChanges should be called with correct arguments",
        ).to.deep.equal([operationId, payload, schemaCompareService]);

        expect(
            actualResult.schemaComparePublishProjectResult,
            "publishProjectChanges should return expected result",
        ).to.deep.equal(expectedResultMock);

        publishProjectChangesStub.restore();
    });

    test("getDefaultOptions reducer - when called - completes successfully", async () => {
        const getDefaultOptionsStub = sandbox
            .stub(scUtils, "getDefaultOptions")
            .resolves(deploymentOptionsResultMock);

        const payload = {};

        const actualResult = await controller["_reducerHandlers"].get("resetOptions")(
            mockInitialState,
            payload,
        );

        expect(getDefaultOptionsStub, "getDefaultOptions should be called once").to.have.been
            .calledOnce;

        expect(
            getDefaultOptionsStub.firstCall.args,
            "getDefaultOptions should be called with correct arguments",
        ).to.deep.equal([schemaCompareService]);

        expect(
            actualResult.defaultDeploymentOptionsResult,
            "getDefaultOptions should return expected result",
        ).to.deep.equal(deploymentOptionsResultMock);

        getDefaultOptionsStub.restore();
    });

    test("includeExcludeNode reducer - when called - completes successfully", async () => {
        const expectedResultMock = {
            success: true,
            errorMessage: "",
            affectedDependencies: [],
            blockingDependencies: [],
        };

        const publishProjectChangesStub = sandbox
            .stub(scUtils, "includeExcludeNode")
            .resolves(expectedResultMock);

        const payload = {
            id: 0,
            diffEntry: {
                updateAction: SchemaUpdateAction.Change,
                differenceType: SchemaDifferenceType.Object,
                name: "Address",
                sourceValue: [],
                targetValue: [],
                parent: undefined,
                children: [],
                sourceScript: "",
                targetScript: "",
                included: false,
            },
            includeRequest: true,
        };

        const actualResult = await controller["_reducerHandlers"].get("includeExcludeNode")(
            mockInitialState,
            payload,
        );

        expect(publishProjectChangesStub, "includeExcludeNode should be called once").to.have.been
            .calledOnce;

        expect(
            publishProjectChangesStub,
            "includeExcludeNode should be called with correct arguments",
        ).to.have.been.calledWith(
            operationId,
            TaskExecutionMode.execute,
            payload,
            schemaCompareService,
            sinon.match.any,
        );

        expect(
            actualResult.schemaCompareIncludeExcludeResult,
            "includeExcludeNode should return expected result",
        ).to.deep.equal(expectedResultMock);

        publishProjectChangesStub.restore();
    });

    test("openScmp reducer - when called - completes successfully", async () => {
        const expectedResultMock = {
            success: true,
            errorMessage: "",
            sourceEndpointInfo,
            targetEndpointInfo,
            originalTargetName: "master",
            originalTargetServerName: "localhost,1433",
            originalConnectionString:
                "Data Source=localhost,1433;Integrated Security=True;Connect Timeout=30;Encrypt=False;TrustServerCertificate=True;Application Name=vscode-mssql;Current Language=us_english",
            deploymentOptions,
            excludedSourceElements: [],
            excludedTargetElements: [],
        };

        const filePath = "c:\\test.scmp";

        const showOpenDialogForScmpStub = sandbox
            .stub(scUtils, "showOpenDialogForScmp")
            .resolves(filePath);

        const openScmpStub = sandbox.stub(scUtils, "openScmp").resolves(expectedResultMock);

        const payload = {};

        const actualResult = await controller["_reducerHandlers"].get("openScmp")(
            mockInitialState,
            payload,
        );

        expect(showOpenDialogForScmpStub, "showOpenDialogForScmp should be called once").to.have
            .been.calledOnce;

        expect(openScmpStub, "openScmp should be called once").to.have.been.calledOnce;

        expect(
            openScmpStub,
            "openScmp should be called with correct arguments",
        ).to.have.been.calledWith(filePath, schemaCompareService, sinon.match.any);

        expect(
            actualResult.schemaCompareOpenScmpResult,
            "openScmp should return expected result",
        ).to.deep.equal(expectedResultMock);

        // Verify that intermediaryOptionsResult is updated with loaded options
        expect(
            actualResult.intermediaryOptionsResult?.defaultDeploymentOptions,
            "intermediaryOptionsResult should be updated with loaded deployment options",
        ).to.deep.equal(expectedResultMock.deploymentOptions);

        openScmpStub.restore();
    });

    test("openScmp reducer - with Azure MFA connection without accountId - populates accountId from saved profile", async () => {
        // Setup Azure MFA endpoint info without accountId
        const azureMfaTargetEndpointInfo = {
            endpointType: 0,
            packageFilePath: "",
            serverDisplayName: "azure-server.database.windows.net (user@domain.com)",
            serverName: "azure-server.database.windows.net",
            databaseName: "testdb",
            ownerUri: "",
            connectionDetails: {
                options: {
                    server: "azure-server.database.windows.net",
                    database: "testdb",
                    authenticationType: "AzureMFA",
                    accountId: undefined, // Missing accountId - this is what we're testing
                    user: "user@domain.com",
                    email: "user@domain.com",
                },
            },
            connectionName: "",
            projectFilePath: "",
            targetScripts: [],
            extractTarget: 5,
            dataSchemaProvider: "",
        };

        const expectedResultMock = {
            success: true,
            errorMessage: "",
            sourceEndpointInfo,
            targetEndpointInfo: azureMfaTargetEndpointInfo,
            originalTargetName: "testdb",
            originalTargetServerName: "azure-server.database.windows.net",
            originalConnectionString: "",
            deploymentOptions,
            excludedSourceElements: [],
            excludedTargetElements: [],
        };

        const filePath = "c:\\test_azure.scmp";

        const showOpenDialogForScmpStub = sandbox
            .stub(scUtils, "showOpenDialogForScmp")
            .resolves(filePath);

        const openScmpStub = sandbox.stub(scUtils, "openScmp").resolves(expectedResultMock);

        // Stub connectionManager methods
        connectionManagerStub.getUriForScmpConnection.returns(undefined); // No existing connection
        connectionManagerStub.connect.resolves(true);

        // Stub the ensureAccountIdForAzureMfa helper function
        const ensureAccountIdStub = sandbox
            .stub(Utils, "ensureAccountIdForAzureMfa")
            .callsFake(async (connInfo) => {
                // Simulate what the real helper does - populate accountId from saved profile
                connInfo.accountId = "test-account-id-12345";
            });

        const payload = {};

        const actualResult = await controller["_reducerHandlers"].get("openScmp")(
            mockInitialState,
            payload,
        );

        expect(showOpenDialogForScmpStub).to.have.been.calledOnce;
        expect(openScmpStub).to.have.been.calledOnce;

        // Verify the helper was called to populate missing accountId
        expect(ensureAccountIdStub).to.have.been.calledOnce;

        // Verify connect was called with accountId populated
        const connectCallArgs = connectionManagerStub.connect.firstCall.args;
        expect(connectCallArgs[1].accountId).to.equal("test-account-id-12345");

        expect(actualResult.schemaCompareOpenScmpResult).to.deep.equal(expectedResultMock);

        openScmpStub.restore();
        ensureAccountIdStub.restore();
    });

    test("saveScmp reducer - when called - completes successfully", async () => {
        const expectedResultMock = {
            success: true,
            errorMessage: "",
        };

        const savePath = "c:\\saved_scmp\\";

        const showSaveDialogForScmpStub = sandbox
            .stub(scUtils, "showSaveDialogForScmp")
            .resolves(savePath);

        const publishProjectChangesStub = sandbox
            .stub(scUtils, "saveScmp")
            .resolves(expectedResultMock);

        const payload = {};

        const actualResult = await controller["_reducerHandlers"].get("saveScmp")(
            mockInitialState,
            payload,
        );

        expect(showSaveDialogForScmpStub, "showSaveDialogForScmp should be called once").to.have
            .been.calledOnce;

        expect(publishProjectChangesStub, "saveScmp should be called once").to.have.been.calledOnce;

        expect(
            publishProjectChangesStub.firstCall.args,
            "saveScmp should be called with correct arguments",
        ).to.deep.equal([
            databaseSourceEndpointInfo,
            undefined,
            TaskExecutionMode.execute,
            deploymentOptions,
            savePath,
            [],
            [],
            schemaCompareService,
        ]);

        expect(
            actualResult.saveScmpResultStatus,
            "saveScmp should return expected result",
        ).to.deep.equal(expectedResultMock);

        publishProjectChangesStub.restore();
    });

    test("cancel reducer - when called - completes successfully", async () => {
        const expectedResultMock = {
            success: true,
            errorMessage: "",
        };

        const publishProjectChangesStub = sandbox
            .stub(scUtils, "cancel")
            .resolves(expectedResultMock);

        const payload = {};

        const actualResult = await controller["_reducerHandlers"].get("cancel")(
            mockInitialState,
            payload,
        );

        expect(publishProjectChangesStub, "cancel should be called once").to.have.been.calledOnce;

        expect(
            publishProjectChangesStub.firstCall.args,
            "cancel should be called with correct arguments",
        ).to.deep.equal([operationId, schemaCompareService]);

        expect(
            actualResult.cancelResultStatus,
            "cancel should be called with correct arguments",
        ).to.deep.equal(expectedResultMock);

        publishProjectChangesStub.restore();
    });

    test("listActiveServers reducer - when called - returns: {conn_uri: {profileName: 'profile1', server: 'server1'}}", async () => {
        const payload = {};

        const actualResult = await controller["_reducerHandlers"].get("listActiveServers")(
            mockInitialState,
            payload,
        );

        const expectedResult = { conn_uri: { profileName: "profile1", server: "server1" } };

        expect(
            actualResult.activeServers,
            "listActiveServers should return: {conn_uri: {profileName: 'profile1', server: 'server1'}}",
        ).to.deep.equal(expectedResult);
    });

    test("listDatabasesForActiveServer reducer - when called - returns: ['db1', 'db2']", async () => {
        const payload = { connectionUri: "conn_uri" };

        const actualResult = await controller["_reducerHandlers"].get(
            "listDatabasesForActiveServer",
        )(mockInitialState, payload);

        const expectedResult = ["db1", "db2"];

        expect(
            actualResult.databases,
            "listActiveServers should return ['db1', 'db2']",
        ).to.deep.equal(expectedResult);
    });

    test("selectFile reducer - when called - returns correct auxiliary endpoint info", async () => {
        const payload = {
            endpoint: { packageFilePath: "c:\\test.dacpac" },
            endpointType: "source",
            fileType: "dacpac",
        };

        sandbox.stub(scUtils, "showOpenDialogForDacpacOrSqlProj").resolves("c:\\test.dacpac");

        const actualResult = await controller["_reducerHandlers"].get("selectFile")(
            mockInitialState,
            payload,
        );

        const expectedResult = {
            connectionDetails: undefined,
            databaseName: "",
            dataSchemaProvider: "",
            endpointType: 1,
            extractTarget: 5,
            ownerUri: "",
            packageFilePath: "c:\\test.dacpac",
            projectFilePath: "",
            serverDisplayName: "",
            serverName: "",
            targetScripts: [],
        };

        expect(
            actualResult.auxiliaryEndpointInfo,
            "selectFile should return the expected auxiliary endpoint info",
        ).to.deep.equal(expectedResult);
    });

    test("confirmSelectedFile reducer - when called - auxiliary endpoint info becomes target endpoint info", async () => {
        const payload = {
            endpointType: "target",
            folderStructure: "",
        };

        const expectedResult = {
            connectionDetails: undefined,
            databaseName: "",
            dataSchemaProvider: "",
            endpointType: 1,
            extractTarget: 5,
            ownerUri: "",
            packageFilePath: "c:\\test.dacpac",
            projectFilePath: "",
            serverDisplayName: "",
            serverName: "",
            targetScripts: [],
        };

        mockInitialState.auxiliaryEndpointInfo = expectedResult;

        const actualResult = await controller["_reducerHandlers"].get("confirmSelectedSchema")(
            mockInitialState,
            payload,
        );

        expect(
            actualResult.targetEndpointInfo,
            "confirmSelectedSchema should make auxiliary endpoint info the target endpoint info",
        ).to.deep.equal(expectedResult);
    });

    test("includeExcludeAllNodes reducer - when includeRequest is false - all nodes are excluded", async () => {
        const payload = {
            includeRequest: false,
        };

        const expectedResult = {
            allIncludedOrExcludedDifferences: [
                {
                    children: [],
                    differenceType: 0,
                    included: false,
                    name: "Table",
                    parent: null,
                    sourceObjectType: "Microsoft.Data.Tools.Schema.Sql.SchemaModel.SqlTable",
                    sourceScript:
                        "CREATE TABLE [dbo].[Customers] (\r\n [CustomerID] INT NOT NULL,\r\n [CustomerName] NVARCHAR (100) NOT NULL,\r\n [Email] NVARCHAR (100) NOT NULL,\r\n [Phone] NVARCHAR (20) NULL,\r\n PRIMARY KEY CLUSTERED ([CustomerID] ASC)\r\n);\r\nGO",
                    sourceValue: ["dbo", "CUstomers"],
                    targetObjectType: null,
                    targetScript: null,
                    targetValue: null,
                    updateAction: 2,
                },
                {
                    children: [],
                    differenceType: 0,
                    included: false,
                    name: "Table",
                    parent: null,
                    sourceObjectType: "Microsoft.Data.Tools.Schema.Sql.SchemaModel.SqlTable",
                    sourceScript:
                        "CREATE TABLE [dbo].[Orders] (\r\n [OrderID] INT NOT NULL,\r\n [CustomerID] INT NULL,\r\n [OrderDate] DATE NOT NULL,\r\n [TotalAmount] DECIMAL (10, 2) NOT NULL,\r\n PRIMARY KEY CLUSTERED ([OrderID] ASC),\r\n FOREIGN KEY ([CustomerID]) REFERENCES [dbo].[Customers] ([CustomerID])\r\n);\r\nGO",
                    sourceValue: ["dbo", "Customers"],
                    targetObjectType: null,
                    targetScript: null,
                    targetValue: null,
                    updateAction: 2,
                },
                {
                    children: [],
                    differenceType: 0,
                    included: false,
                    name: "Table",
                    parent: null,
                    sourceObjectType: "Microsoft.Data.Tools.Schema.Sql.SchemaModel.SqlTable",
                    sourceScript:
                        "CREATE TABLE [dbo].[Products] (\r\n [ProductID] INT NOT NULL,\r\n [ProductName] NVARCHAR (100) NOT NULL,\r\n [Price] DECIMAL (10, 2) NOT NULL,\r\n [StockQuantity] INT NOT NULL,\r\n PRIMARY KEY CLUSTERED ([ProductID] ASC)\r\n);\r\nGO",
                    sourceValue: ["dbo", "Products"],
                    targetObjectType: null,
                    targetScript: null,
                    targetValue: null,
                    updateAction: 2,
                },
            ],
            errorMessage: null,
            success: true,
        };

        const includeExcludeAllStub = sandbox
            .stub(scUtils, "includeExcludeAllNodes")
            .resolves(expectedResult);

        const actualResult = await controller["_reducerHandlers"].get("includeExcludeAllNodes")(
            mockInitialState,
            payload,
        );

        expect(includeExcludeAllStub, "includeExcludeAllNodes should be called once").to.have.been
            .calledOnce;

        expect(
            actualResult.schemaCompareResult.differences,
            "includeExcludeAllNodes should return the expected result",
        ).to.deep.equal(expectedResult.allIncludedOrExcludedDifferences);

        includeExcludeAllStub.restore();
    });

    test("includeExcludeAllNodes reducer - when includeRequest is true - all nodes are included", async () => {
        const payload = {
            includeRequest: true,
        };

        const expectedResult = {
            allIncludedOrExcludedDifferences: [
                {
                    children: [],
                    differenceType: 0,
                    included: true,
                    name: "Table",
                    parent: null,
                    sourceObjectType: "Microsoft.Data.Tools.Schema.Sql.SchemaModel.SqlTable",
                    sourceScript:
                        "CREATE TABLE [dbo].[Customers] (\r\n [CustomerID] INT NOT NULL,\r\n [CustomerName] NVARCHAR (100) NOT NULL,\r\n [Email] NVARCHAR (100) NOT NULL,\r\n [Phone] NVARCHAR (20) NULL,\r\n PRIMARY KEY CLUSTERED ([CustomerID] ASC)\r\n);\r\nGO",
                    sourceValue: ["dbo", "CUstomers"],
                    targetObjectType: null,
                    targetScript: null,
                    targetValue: null,
                    updateAction: 2,
                },
                {
                    children: [],
                    differenceType: 0,
                    included: true,
                    name: "Table",
                    parent: null,
                    sourceObjectType: "Microsoft.Data.Tools.Schema.Sql.SchemaModel.SqlTable",
                    sourceScript:
                        "CREATE TABLE [dbo].[Orders] (\r\n [OrderID] INT NOT NULL,\r\n [CustomerID] INT NULL,\r\n [OrderDate] DATE NOT NULL,\r\n [TotalAmount] DECIMAL (10, 2) NOT NULL,\r\n PRIMARY KEY CLUSTERED ([OrderID] ASC),\r\n FOREIGN KEY ([CustomerID]) REFERENCES [dbo].[Customers] ([CustomerID])\r\n);\r\nGO",
                    sourceValue: ["dbo", "Customers"],
                    targetObjectType: null,
                    targetScript: null,
                    targetValue: null,
                    updateAction: 2,
                },
                {
                    children: [],
                    differenceType: 0,
                    included: true,
                    name: "Table",
                    parent: null,
                    sourceObjectType: "Microsoft.Data.Tools.Schema.Sql.SchemaModel.SqlTable",
                    sourceScript:
                        "CREATE TABLE [dbo].[Products] (\r\n [ProductID] INT NOT NULL,\r\n [ProductName] NVARCHAR (100) NOT NULL,\r\n [Price] DECIMAL (10, 2) NOT NULL,\r\n [StockQuantity] INT NOT NULL,\r\n PRIMARY KEY CLUSTERED ([ProductID] ASC)\r\n);\r\nGO",
                    sourceValue: ["dbo", "Products"],
                    targetObjectType: null,
                    targetScript: null,
                    targetValue: null,
                    updateAction: 2,
                },
            ],
            errorMessage: null,
            success: true,
        };

        const includeExcludeAllStub = sandbox
            .stub(scUtils, "includeExcludeAllNodes")
            .resolves(expectedResult);

        const actualResult = await controller["_reducerHandlers"].get("includeExcludeAllNodes")(
            mockInitialState,
            payload,
        );

        expect(includeExcludeAllStub, "includeExcludeAllNodes should be called once").to.have.been
            .calledOnce;

        expect(
            actualResult.schemaCompareResult.differences,
            "includeExcludeAllNodes should return the expected result",
        ).to.deep.equal(expectedResult.allIncludedOrExcludedDifferences);

        includeExcludeAllStub.restore();
    });

    test("intermediaryIncludeObjectTypesBulkChanged reducer - when checking object types - adds them to exclusion list", async () => {
        // Setup initial state with some object types in the exclusion list
        const initialState = { ...mockInitialState };
        initialState.intermediaryOptionsResult = {
            success: true,
            errorMessage: "",
            defaultDeploymentOptions: {
                ...deploymentOptions,
                excludeObjectTypes: {
                    value: ["ServerTriggers", "Routes"],
                    description: "",
                    displayName: "",
                },
            },
        };

        const payload = {
            keys: ["Aggregates", "ApplicationRoles"],
            checked: false, // false means we want to exclude (uncheck) these types
        };

        const actualResult = await controller["_reducerHandlers"].get(
            "intermediaryIncludeObjectTypesBulkChanged",
        )(initialState, payload);

        // Verify that the object types were added to the exclusion list
        const excludeObjectTypes =
            actualResult.intermediaryOptionsResult.defaultDeploymentOptions.excludeObjectTypes
                .value;
        expect(
            excludeObjectTypes.includes("Aggregates"),
            "Aggregates should be added to exclusion list",
        ).to.be.true;
        expect(
            excludeObjectTypes.includes("ApplicationRoles"),
            "ApplicationRoles should be added to exclusion list",
        ).to.be.true;
        expect(
            excludeObjectTypes.includes("ServerTriggers"),
            "Existing ServerTriggers should remain in exclusion list",
        ).to.be.true;
        expect(
            excludeObjectTypes.includes("Routes"),
            "Existing Routes should remain in exclusion list",
        ).to.be.true;
    });

    test("intermediaryIncludeObjectTypesBulkChanged reducer - when unchecking object types - removes them from exclusion list", async () => {
        // Setup initial state with object types in the exclusion list
        const initialState = { ...mockInitialState };
        initialState.intermediaryOptionsResult = {
            success: true,
            errorMessage: "",
            defaultDeploymentOptions: {
                ...deploymentOptions,
                excludeObjectTypes: {
                    value: ["ServerTriggers", "Routes", "Aggregates", "ApplicationRoles"],
                    description: "",
                    displayName: "",
                },
            },
        };

        const payload = {
            keys: ["Aggregates", "ApplicationRoles"],
            checked: true, // true means we want to include (check) these types
        };

        const actualResult = await controller["_reducerHandlers"].get(
            "intermediaryIncludeObjectTypesBulkChanged",
        )(initialState, payload);

        // Verify that the object types were removed from the exclusion list
        const excludeObjectTypes =
            actualResult.intermediaryOptionsResult.defaultDeploymentOptions.excludeObjectTypes
                .value;
        expect(
            !excludeObjectTypes.includes("Aggregates"),
            "Aggregates should be removed from exclusion list",
        ).to.be.true;
        expect(
            !excludeObjectTypes.includes("ApplicationRoles"),
            "ApplicationRoles should be removed from exclusion list",
        ).to.be.true;
        expect(
            excludeObjectTypes.includes("ServerTriggers"),
            "Existing ServerTriggers should remain in exclusion list",
        ).to.be.true;
        expect(
            excludeObjectTypes.includes("Routes"),
            "Existing Routes should remain in exclusion list",
        ).to.be.true;
    });

    test("intermediaryIncludeObjectTypesBulkChanged reducer - when checking already included types - no duplicates added", async () => {
        // Setup initial state with minimal exclusion list
        const initialState = { ...mockInitialState };
        initialState.intermediaryOptionsResult = {
            success: true,
            errorMessage: "",
            defaultDeploymentOptions: {
                ...deploymentOptions,
                excludeObjectTypes: {
                    value: ["ServerTriggers"],
                    description: "",
                    displayName: "",
                },
            },
        };

        const payload = {
            keys: ["Aggregates", "ApplicationRoles"],
            checked: true, // true means include these types (remove from exclusion)
        };

        const actualResult = await controller["_reducerHandlers"].get(
            "intermediaryIncludeObjectTypesBulkChanged",
        )(initialState, payload);

        // Verify no changes since they weren't excluded in the first place
        const excludeObjectTypes =
            actualResult.intermediaryOptionsResult.defaultDeploymentOptions.excludeObjectTypes
                .value;
        expect(excludeObjectTypes.length, "Should only have 1 item in exclusion list").to.equal(1);
        expect(
            excludeObjectTypes.includes("ServerTriggers"),
            "ServerTriggers should remain in exclusion list",
        ).to.be.true;
        expect(
            !excludeObjectTypes.includes("Aggregates"),
            "Aggregates should not be in exclusion list",
        ).to.be.true;
        expect(
            !excludeObjectTypes.includes("ApplicationRoles"),
            "ApplicationRoles should not be in exclusion list",
        ).to.be.true;
    });

    test("intermediaryIncludeObjectTypesBulkChanged reducer - when unchecking already excluded types - no duplicates added", async () => {
        // Setup initial state with object types already in exclusion list
        const initialState = { ...mockInitialState };
        initialState.intermediaryOptionsResult = {
            success: true,
            errorMessage: "",
            defaultDeploymentOptions: {
                ...deploymentOptions,
                excludeObjectTypes: {
                    value: ["ServerTriggers", "Routes", "Aggregates"],
                    description: "",
                    displayName: "",
                },
            },
        };

        const payload = {
            keys: ["Aggregates", "ApplicationRoles"],
            checked: false, // false means exclude these types
        };

        const actualResult = await controller["_reducerHandlers"].get(
            "intermediaryIncludeObjectTypesBulkChanged",
        )(initialState, payload);

        // Verify that Aggregates is not duplicated and ApplicationRoles is added
        const excludeObjectTypes =
            actualResult.intermediaryOptionsResult.defaultDeploymentOptions.excludeObjectTypes
                .value;
        const aggregatesCount = excludeObjectTypes.filter((type) => type === "Aggregates").length;
        expect(aggregatesCount, "Aggregates should appear only once in exclusion list").to.equal(1);
        expect(
            excludeObjectTypes.includes("ApplicationRoles"),
            "ApplicationRoles should be added to exclusion list",
        ).to.be.true;
        expect(
            excludeObjectTypes.includes("ServerTriggers"),
            "ServerTriggers should remain in exclusion list",
        ).to.be.true;
        expect(excludeObjectTypes.includes("Routes"), "Routes should remain in exclusion list").to
            .be.true;
    });

    test("intermediaryIncludeObjectTypesBulkChanged reducer - case insensitive comparison works correctly", async () => {
        // Setup initial state with mixed case object types in exclusion list
        const initialState = { ...mockInitialState };
        initialState.intermediaryOptionsResult = {
            success: true,
            errorMessage: "",
            defaultDeploymentOptions: {
                ...deploymentOptions,
                excludeObjectTypes: {
                    value: ["serverTriggers", "ROUTES"],
                    description: "",
                    displayName: "",
                },
            },
        };

        const payload = {
            keys: ["ServerTriggers", "Routes"],
            checked: true, // true means include these types (remove from exclusion)
        };

        const actualResult = await controller["_reducerHandlers"].get(
            "intermediaryIncludeObjectTypesBulkChanged",
        )(initialState, payload);

        // Verify that case-insensitive matching worked
        const excludeObjectTypes =
            actualResult.intermediaryOptionsResult.defaultDeploymentOptions.excludeObjectTypes
                .value;
        expect(
            excludeObjectTypes.length,
            "All object types should be removed from exclusion list",
        ).to.equal(0);
    });

    test("intermediaryIncludeObjectTypesBulkChanged reducer - with empty keys array - no changes made", async () => {
        // Setup initial state
        const initialState = { ...mockInitialState };
        initialState.intermediaryOptionsResult = {
            success: true,
            errorMessage: "",
            defaultDeploymentOptions: {
                ...deploymentOptions,
                excludeObjectTypes: {
                    value: ["ServerTriggers", "Routes"],
                    description: "",
                    displayName: "",
                },
            },
        };

        const payload = {
            keys: [],
            checked: false,
        };

        const actualResult = await controller["_reducerHandlers"].get(
            "intermediaryIncludeObjectTypesBulkChanged",
        )(initialState, payload);

        // Verify no changes were made
        const excludeObjectTypes =
            actualResult.intermediaryOptionsResult.defaultDeploymentOptions.excludeObjectTypes
                .value;
        expect(excludeObjectTypes, "Exclusion list should remain unchanged").to.deep.equal([
            "ServerTriggers",
            "Routes",
        ]);
    });

    test("intermediaryGeneralOptionsBulkChanged reducer - when setting options to true - updates all specified options", async () => {
        // Setup initial state with some general options set to false
        const initialState = { ...mockInitialState };
        initialState.intermediaryOptionsResult = {
            success: true,
            errorMessage: "",
            defaultDeploymentOptions: {
                ...deploymentOptions,
                booleanOptionsDictionary: {
                    allowDropBlockingAssemblies: {
                        value: false,
                        description: "Description for allowDropBlockingAssemblies",
                        displayName: "Allow drop blocking assemblies",
                    },
                    allowExternalLanguagePaths: {
                        value: false,
                        description: "Description for allowExternalLanguagePaths",
                        displayName: "Use file paths for external language",
                    },
                    allowExternalLibraryPaths: {
                        value: true, // This one is already true
                        description: "Description for allowExternalLibraryPaths",
                        displayName: "Use file paths for external libraries",
                    },
                },
            },
        };

        const payload = {
            keys: ["allowDropBlockingAssemblies", "allowExternalLanguagePaths"],
            checked: true,
        };

        const actualResult = await controller["_reducerHandlers"].get(
            "intermediaryGeneralOptionsBulkChanged",
        )(initialState, payload);

        // Verify that the specified options were set to true
        const booleanOptions =
            actualResult.intermediaryOptionsResult.defaultDeploymentOptions
                .booleanOptionsDictionary;
        expect(
            booleanOptions.allowDropBlockingAssemblies.value,
            "allowDropBlockingAssemblies should be set to true",
        ).to.equal(true);
        expect(
            booleanOptions.allowExternalLanguagePaths.value,
            "allowExternalLanguagePaths should be set to true",
        ).to.equal(true);
        expect(
            booleanOptions.allowExternalLibraryPaths.value,
            "allowExternalLibraryPaths should remain unchanged (was already true)",
        ).to.equal(true);
    });

    test("intermediaryGeneralOptionsBulkChanged reducer - when setting options to false - updates all specified options", async () => {
        // Setup initial state with some general options set to true
        const initialState = { ...mockInitialState };
        initialState.intermediaryOptionsResult = {
            success: true,
            errorMessage: "",
            defaultDeploymentOptions: {
                ...deploymentOptions,
                booleanOptionsDictionary: {
                    allowDropBlockingAssemblies: {
                        value: true,
                        description: "Description for allowDropBlockingAssemblies",
                        displayName: "Allow drop blocking assemblies",
                    },
                    allowExternalLanguagePaths: {
                        value: true,
                        description: "Description for allowExternalLanguagePaths",
                        displayName: "Use file paths for external language",
                    },
                    allowExternalLibraryPaths: {
                        value: false, // This one is already false
                        description: "Description for allowExternalLibraryPaths",
                        displayName: "Use file paths for external libraries",
                    },
                },
            },
        };

        const payload = {
            keys: ["allowDropBlockingAssemblies", "allowExternalLanguagePaths"],
            checked: false,
        };

        const actualResult = await controller["_reducerHandlers"].get(
            "intermediaryGeneralOptionsBulkChanged",
        )(initialState, payload);

        // Verify that the specified options were set to false
        const booleanOptions =
            actualResult.intermediaryOptionsResult.defaultDeploymentOptions
                .booleanOptionsDictionary;
        expect(
            booleanOptions.allowDropBlockingAssemblies.value,
            "allowDropBlockingAssemblies should be set to false",
        ).to.equal(false);
        expect(
            booleanOptions.allowExternalLanguagePaths.value,
            "allowExternalLanguagePaths should be set to false",
        ).to.equal(false);
        expect(
            booleanOptions.allowExternalLibraryPaths.value,
            "allowExternalLibraryPaths should remain unchanged (was already false)",
        ).to.equal(false);
    });

    test("intermediaryGeneralOptionsBulkChanged reducer - when key does not exist - ignores non-existent options", async () => {
        // Setup initial state with some general options
        const initialState = { ...mockInitialState };
        initialState.intermediaryOptionsResult = {
            success: true,
            errorMessage: "",
            defaultDeploymentOptions: {
                ...deploymentOptions,
                booleanOptionsDictionary: {
                    allowDropBlockingAssemblies: {
                        value: false,
                        description: "Description for allowDropBlockingAssemblies",
                        displayName: "Allow drop blocking assemblies",
                    },
                    allowExternalLanguagePaths: {
                        value: true,
                        description: "Description for allowExternalLanguagePaths",
                        displayName: "Use file paths for external language",
                    },
                },
            },
        };

        const payload = {
            keys: ["allowDropBlockingAssemblies", "nonExistentOption", "anotherNonExistentOption"],
            checked: true,
        };

        const actualResult = await controller["_reducerHandlers"].get(
            "intermediaryGeneralOptionsBulkChanged",
        )(initialState, payload);

        // Verify that existing options were changed and non-existent options were ignored
        const booleanOptions =
            actualResult.intermediaryOptionsResult.defaultDeploymentOptions
                .booleanOptionsDictionary;
        expect(
            booleanOptions.allowDropBlockingAssemblies.value,
            "allowDropBlockingAssemblies should be set to true",
        ).to.equal(true);
        expect(
            booleanOptions.allowExternalLanguagePaths.value,
            "allowExternalLanguagePaths should remain unchanged",
        ).to.equal(true);
        expect(Object.keys(booleanOptions).length, "No new options should be created").to.equal(2);
        expect(
            !booleanOptions.hasOwnProperty("nonExistentOption"),
            "nonExistentOption should not be created",
        ).to.be.true;
        expect(
            !booleanOptions.hasOwnProperty("anotherNonExistentOption"),
            "anotherNonExistentOption should not be created",
        ).to.be.true;
    });

    test("intermediaryGeneralOptionsBulkChanged reducer - with empty keys array - no changes made", async () => {
        // Setup initial state
        const initialState = { ...mockInitialState };
        initialState.intermediaryOptionsResult = {
            success: true,
            errorMessage: "",
            defaultDeploymentOptions: {
                ...deploymentOptions,
                booleanOptionsDictionary: {
                    allowDropBlockingAssemblies: {
                        value: false,
                        description: "Description for allowDropBlockingAssemblies",
                        displayName: "Allow drop blocking assemblies",
                    },
                    allowExternalLanguagePaths: {
                        value: true,
                        description: "Description for allowExternalLanguagePaths",
                        displayName: "Use file paths for external language",
                    },
                },
            },
        };

        const payload = {
            keys: [],
            checked: true,
        };

        const actualResult = await controller["_reducerHandlers"].get(
            "intermediaryGeneralOptionsBulkChanged",
        )(initialState, payload);

        // Verify no changes were made
        const booleanOptions =
            actualResult.intermediaryOptionsResult.defaultDeploymentOptions
                .booleanOptionsDictionary;
        expect(
            booleanOptions.allowDropBlockingAssemblies.value,
            "allowDropBlockingAssemblies should remain unchanged",
        ).to.equal(false);
        expect(
            booleanOptions.allowExternalLanguagePaths.value,
            "allowExternalLanguagePaths should remain unchanged",
        ).to.equal(true);
    });

    test("intermediaryGeneralOptionsBulkChanged reducer - with mixed option states - updates all specified options uniformly", async () => {
        // Setup initial state with mixed boolean values
        const initialState = { ...mockInitialState };
        initialState.intermediaryOptionsResult = {
            success: true,
            errorMessage: "",
            defaultDeploymentOptions: {
                ...deploymentOptions,
                booleanOptionsDictionary: {
                    allowDropBlockingAssemblies: {
                        value: true,
                        description: "Description for allowDropBlockingAssemblies",
                        displayName: "Allow drop blocking assemblies",
                    },
                    allowExternalLanguagePaths: {
                        value: false,
                        description: "Description for allowExternalLanguagePaths",
                        displayName: "Use file paths for external language",
                    },
                    allowExternalLibraryPaths: {
                        value: true,
                        description: "Description for allowExternalLibraryPaths",
                        displayName: "Use file paths for external libraries",
                    },
                },
            },
        };

        const payload = {
            keys: [
                "allowDropBlockingAssemblies",
                "allowExternalLanguagePaths",
                "allowExternalLibraryPaths",
            ],
            checked: false,
        };

        const actualResult = await controller["_reducerHandlers"].get(
            "intermediaryGeneralOptionsBulkChanged",
        )(initialState, payload);

        // Verify all specified options are set to the same value regardless of their initial state
        const booleanOptions =
            actualResult.intermediaryOptionsResult.defaultDeploymentOptions
                .booleanOptionsDictionary;
        expect(
            booleanOptions.allowDropBlockingAssemblies.value,
            "allowDropBlockingAssemblies should be set to false",
        ).to.equal(false);
        expect(
            booleanOptions.allowExternalLanguagePaths.value,
            "allowExternalLanguagePaths should be set to false",
        ).to.equal(false);
        expect(
            booleanOptions.allowExternalLibraryPaths.value,
            "allowExternalLibraryPaths should be set to false",
        ).to.equal(false);
    });

    test("intermediaryGeneralOptionsBulkChanged reducer - preserves option metadata - only changes value property", async () => {
        // Setup initial state
        const initialState = { ...mockInitialState };
        const originalDescription = "Original description for allowDropBlockingAssemblies";
        const originalDisplayName = "Original display name";

        initialState.intermediaryOptionsResult = {
            success: true,
            errorMessage: "",
            defaultDeploymentOptions: {
                ...deploymentOptions,
                booleanOptionsDictionary: {
                    allowDropBlockingAssemblies: {
                        value: false,
                        description: originalDescription,
                        displayName: originalDisplayName,
                    },
                },
            },
        };

        const payload = {
            keys: ["allowDropBlockingAssemblies"],
            checked: true,
        };

        const actualResult = await controller["_reducerHandlers"].get(
            "intermediaryGeneralOptionsBulkChanged",
        )(initialState, payload);

        // Verify that only the value changed, not the metadata
        const option =
            actualResult.intermediaryOptionsResult.defaultDeploymentOptions.booleanOptionsDictionary
                .allowDropBlockingAssemblies;
        expect(option.value, "Value should be updated to true").to.equal(true);
        expect(option.description, "Description should remain unchanged").to.equal(
            originalDescription,
        );
        expect(option.displayName, "Display name should remain unchanged").to.equal(
            originalDisplayName,
        );
    });
});
