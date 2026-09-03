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
import * as utils from "../../src/models/utils";

chai.use(sinonChai);

import { SchemaCompareWebViewController } from "../../src/schemaCompare/schemaCompareWebViewController";
import { TreeNodeInfo } from "../../src/objectExplorer/nodes/treeNodeInfo";
import ConnectionManager, { ConnectionInfo } from "../../src/controllers/connectionManager";
import {
    ExtractTarget,
    SchemaDifferenceType,
    SchemaUpdateAction,
    TaskExecutionMode,
} from "../../src/enums";
import { SchemaCompareWebViewState } from "../../src/sharedInterfaces/schemaCompare";
import * as scUtils from "../../src/schemaCompare/schemaCompareUtils";
import { UserSurvey } from "../../src/nps/userSurvey";
import { IconUtils } from "../../src/utils/iconUtils";
import {
    CredentialsQuickPickItemType,
    IConnectionProfile,
    IConnectionProfileWithSource,
} from "../../src/models/interfaces";
import { AzureAuthType } from "../../src/models/contracts/azure";
import { SchemaCompareService } from "../../src/services/schemaCompareService";
import { ConnectionStore } from "../../src/models/connectionStore";
import * as locConstants from "../../src/constants/locConstants";

suite("SchemaCompareWebViewController Tests", () => {
    let controller: SchemaCompareWebViewController;
    let sandbox: sinon.SinonSandbox;
    let mockContext: vscode.ExtensionContext;
    let treeNode: TreeNodeInfo;
    let mockConnectionInfo: ConnectionInfo;
    let activeConnections: { [fileUri: string]: ConnectionInfo };
    let mockServerConnInfo: mssql.IConnectionInfo;
    let mockInitialState: SchemaCompareWebViewState;
    let schemaCompareService: mssql.ISchemaCompareService;
    let connectionManagerStub: sinon.SinonStubbedInstance<ConnectionManager>;
    let connectionStoreStub: sinon.SinonStubbedInstance<ConnectionStore>;
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
            isComparisonInProgress: false,
            isApplyInProgress: false,
            applySucceeded: false,
            applyFailed: false,
            isIncludeExcludeAllOperationInProgress: false,
            connections: {},
            databases: [],
            databaseListConnectionId: "",
            isDatabaseListLoading: false,
            databaseListError: "",
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
            configSource: vscode.ConfigurationTarget.Global,
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
        connectionStoreStub = sandbox.createStubInstance(ConnectionStore);
        connectionStoreStub.readAllConnections.resolves([]);
        sandbox.stub(connectionManagerStub, "connectionStore").get(() => connectionStoreStub);
        connectionChangedEmitter = new vscode.EventEmitter<void>();
        Object.defineProperty(connectionManagerStub, "onConnectionsChanged", {
            value: connectionChangedEmitter.event,
        });
        // Reflect activeConnections in getUriForConnection lookups rather than returning a constant.
        // Match requires both the profile ID and the server to match so that editing a saved
        // connection's server does not accidentally reuse a stale URI.
        connectionManagerStub.getUriForConnection.callsFake((profile: IConnectionProfile) => {
            const profileId = (profile as IConnectionProfile).id;
            return Object.keys(activeConnections).find((uri) => {
                const creds = activeConnections[uri].credentials as IConnectionProfile;
                if (profileId && creds.id === profileId) {
                    return creds.server === profile.server;
                }
                return !profileId && creds.server === profile.server;
            });
        });
        // Default: no saved profile matched; individual tests override this where a specific profile matters
        connectionManagerStub.findMatchingProfile.resolves({
            profile: undefined,
            score: utils.MatchScore.NotMatch,
        });

        mockServerConnInfo = {
            server: "server1",
            profileName: "profile1",
        } as unknown as mssql.IConnectionInfo;

        mockConnectionInfo = {
            credentials: mockServerConnInfo,
        } as unknown as ConnectionInfo;

        activeConnections = {
            conn_uri: mockConnectionInfo,
        };
        sandbox.stub(connectionManagerStub, "activeConnections").get(() => activeConnections);

        connectionManagerStub.isConnected.withArgs("conn_uri").returns(true);
        connectionManagerStub.listDatabases.resolves(["db1", "db2"]);

        generateOperationIdStub = sandbox.stub(scUtils, "generateOperationId").returns(operationId);

        controller = new SchemaCompareWebViewController(
            mockContext,
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
            undefined,
            mockTarget,
            false,
            schemaCompareService,
            connectionManagerStub,
            deploymentOptionsResultMock,
            schemaCompareWebViewTitle,
        );

        const launchStub = sandbox.stub(controller, "launch").resolves();

        await controller.start(undefined, mockTarget, false);

        expect(launchStub).to.have.been.calledTwice;

        // First call: from constructor
        // Second call: from explicit start
        const [sourceArg2, targetArg2, runComparisonArg2] = launchStub.secondCall.args;

        // You can assert the second call matches your expectations
        expect(sourceArg2, "source should be undefined").to.be.undefined;
        expect(targetArg2, "target should match mockTarget").to.deep.equal(mockTarget);
        expect(runComparisonArg2, "runComparison should be false").to.be.false;
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
            mockSource,
            mockTarget,
            true,
            schemaCompareService,
            connectionManagerStub,
            deploymentOptionsResultMock,
            schemaCompareWebViewTitle,
        );

        // Stub launch to track its calls
        const launchStub = sandbox.stub(controller, "launch").resolves();

        await controller.start(mockSource, mockTarget, true);

        // Verify launch was called twice (once from constructor, once from explicit start)
        expect(launchStub).to.have.been.calledTwice;

        // Verify second call has correct arguments
        const [sourceArg2, targetArg2, runComparisonArg2] = launchStub.secondCall.args;
        expect(sourceArg2, "source should match mockSource").to.deep.equal(mockSource);
        expect(targetArg2, "target should match mockTarget").to.deep.equal(mockTarget);
        expect(runComparisonArg2, "runComparison should be true").to.be.true;
    });

    test("launch - automatically triggers schema comparison when runComparison is true", async () => {
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

        const expectedCompareResultMock: mssql.SchemaCompareResult = {
            operationId: operationId,
            areEqual: false,
            differences: [],
            success: true,
            errorMessage: "",
        };

        // Stub the compare utility function to prevent actual comparison
        const compareStub = sandbox.stub(scUtils, "compare").resolves(expectedCompareResultMock);

        controller = new SchemaCompareWebViewController(
            mockContext,
            mockSource,
            mockTarget,
            false, // Don't auto-run on construction
            schemaCompareService,
            connectionManagerStub,
            deploymentOptionsResultMock,
            schemaCompareWebViewTitle,
        );

        // Now call launch with runComparison=true to test automatic comparison
        await controller.launch(mockSource, mockTarget, true, undefined);

        // Verify compare was called automatically when runComparison is true
        expect(compareStub, "compare should be called once").to.have.been.calledOnce;
        expect(
            compareStub.firstCall.args[2].sourceEndpointInfo,
            "source should match mockSource",
        ).to.deep.equal(mockSource);
        expect(
            compareStub.firstCall.args[2].targetEndpointInfo,
            "target should match mockTarget",
        ).to.deep.equal(mockTarget);
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

        const databaseTargetEndpoint = {
            ...targetEndpointInfo,
            connectionDetails: undefined,
        };
        const payload = {
            deploymentOptions,
            sourceEndpointInfo,
            targetEndpointInfo: databaseTargetEndpoint,
        };

        const result = await controller["_reducerHandlers"].get("compare")(
            mockInitialState,
            payload,
        );

        expect(
            compareStub,
            "compare should use the active connection owner URI without connection details",
        ).to.have.been.calledWith(
            operationId,
            TaskExecutionMode.execute,
            payload,
            schemaCompareService,
        );

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

    test("resetOptions reducer - when called - resets options to defaults from cached state", async () => {
        const payload = {};

        const actualResult = await controller["_reducerHandlers"].get("resetOptions")(
            mockInitialState,
            payload,
        );

        expect(
            actualResult.intermediaryOptionsResult,
            "intermediaryOptionsResult should be a clone of defaultDeploymentOptionsResult",
        ).to.deep.equal(mockInitialState.defaultDeploymentOptionsResult);
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
        // Setup Azure MFA endpoint info without accountId in connectionDetails
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
                    accountId: undefined, // Missing accountId — findMatchingProfile supplies it
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

        // The saved profile for this Azure MFA connection already has accountId resolved
        const azureSavedProfile: IConnectionProfile = {
            server: "azure-server.database.windows.net",
            database: "testdb",
            authenticationType: "AzureMFA",
            user: "user@domain.com",
            accountId: "test-account-id-12345",
            id: "azure-profile-id",
            profileName: "Azure MFA Profile",
        } as unknown as IConnectionProfile;

        // Override findMatchingProfile to return the saved profile with accountId
        connectionManagerStub.findMatchingProfile.resolves({
            profile: azureSavedProfile,
            score: utils.MatchScore.Id,
        });

        // No existing SCMP connection — constructEndpointInfo will open a new one
        connectionManagerStub.getUriForScmpConnection.returns(undefined);
        connectionManagerStub.connect.resolves(true);

        const payload = {};

        const actualResult = await controller["_reducerHandlers"].get("openScmp")(
            mockInitialState,
            payload,
        );

        expect(showOpenDialogForScmpStub).to.have.been.calledOnce;
        expect(openScmpStub).to.have.been.calledOnce;

        // Verify findMatchingProfile was called to resolve the saved profile (and its accountId)
        expect(connectionManagerStub.findMatchingProfile).to.have.been.called;

        // Verify connect was called with credentials that include the accountId from the saved profile
        expect(connectionManagerStub.connect).to.have.been.calledWithMatch(
            sinon.match.string,
            sinon.match({ accountId: "test-account-id-12345" }),
        );

        expect(actualResult.schemaCompareOpenScmpResult).to.deep.equal(expectedResultMock);

        openScmpStub.restore();
    });

    test("SCMP endpoint profile matching falls back to parsed connection fields", async () => {
        const endpoint = {
            endpointType: 0,
            serverName: "localhost,2433",
            databaseName: "OpsAnalytics",
            connectionDetails: {
                options: {
                    connectionString:
                        "Data Source=localhost,2433;Initial Catalog=OpsAnalytics;User ID=sa",
                    server: "localhost,2433",
                    database: "OpsAnalytics",
                    authenticationType: "SqlLogin",
                    user: "sa",
                },
            },
        } as unknown as mssql.SchemaCompareEndpointInfo;
        const savedProfile = {
            server: "localhost",
            port: "2433",
            database: "OpsAnalytics",
            authenticationType: "SqlLogin",
            user: "sa",
            id: "docker-profile",
        } as unknown as IConnectionProfile;

        connectionManagerStub.findMatchingProfile
            .onFirstCall()
            .resolves({ profile: undefined, score: utils.MatchScore.NotMatch })
            .onSecondCall()
            .resolves({
                profile: savedProfile,
                score: utils.MatchScore.ServerDatabaseAndAuth,
            });
        connectionManagerStub.getUriForScmpConnection.returns(undefined);
        connectionManagerStub.connect.resolves(true);

        await controller["constructEndpointInfo"](endpoint, "source");

        expect(connectionManagerStub.findMatchingProfile).to.have.been.calledTwice;
        expect(connectionManagerStub.findMatchingProfile.firstCall.args[0]).to.include({
            connectionString: "Data Source=localhost,2433;Initial Catalog=OpsAnalytics;User ID=sa",
            server: "localhost,2433",
            database: "OpsAnalytics",
        });
        expect(connectionManagerStub.findMatchingProfile.secondCall.args[0]).to.deep.include({
            server: "localhost,2433",
            database: "OpsAnalytics",
        });
        expect(connectionManagerStub.findMatchingProfile.secondCall.args[0].connectionString).to.be
            .undefined;
    });

    test("SCMP endpoint profile matching preserves exact connection string identity", async () => {
        const connectionString =
            "Data Source=localhost,2433;Initial Catalog=OpsAnalytics;User ID=sa";
        const endpoint = {
            endpointType: 0,
            serverName: "localhost,2433",
            databaseName: "OpsAnalytics",
            connectionDetails: {
                options: {
                    connectionString,
                    server: "localhost,2433",
                    database: "OpsAnalytics",
                    authenticationType: "SqlLogin",
                    user: "sa",
                },
            },
        } as unknown as mssql.SchemaCompareEndpointInfo;
        const savedProfile = {
            connectionString,
            id: "connection-string-profile",
        } as unknown as IConnectionProfile;

        connectionManagerStub.findMatchingProfile.resolves({
            profile: savedProfile,
            score: utils.MatchScore.AllAvailableProps,
        });
        connectionManagerStub.getUriForScmpConnection.returns(undefined);
        connectionManagerStub.connect.resolves(true);

        await controller["constructEndpointInfo"](endpoint, "source");

        expect(connectionManagerStub.findMatchingProfile).to.have.been.calledOnceWith(
            sinon.match({ connectionString }),
        );
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

    test("resetEndpointsSwitched reducer - when called - sets endpointsSwitched to false", async () => {
        // Setup initial state with endpointsSwitched set to true
        const initialState = { ...mockInitialState };
        initialState.endpointsSwitched = true;

        const payload = {};

        const actualResult = await controller["_reducerHandlers"].get("resetEndpointsSwitched")(
            initialState,
            payload,
        );

        expect(actualResult.endpointsSwitched, "endpointsSwitched should be set to false").to.equal(
            false,
        );
    });

    test("listActiveServers reducer - includes inactive saved connections", async () => {
        const savedConnection = {
            id: "saved-connection-id",
            profileName: "Saved connection",
            server: "saved-server",
            database: "saved-database",
            profileSource: CredentialsQuickPickItemType.Profile,
        } as IConnectionProfileWithSource;
        connectionStoreStub.readAllConnections.resolves([savedConnection]);
        connectionManagerStub.getUriForConnection.withArgs(savedConnection).returns(undefined);

        const actualResult = await controller["_reducerHandlers"].get("listActiveServers")(
            mockInitialState,
            {},
        );

        expect(actualResult.connections["saved-connection-id"]).to.deep.equal({
            profileName: "Saved connection",
            server: "saved-server",
            database: "saved-database",
        });
    });

    test("listActiveServers reducer - excludes active but unsaved connections", async () => {
        const actualResult = await controller["_reducerHandlers"].get("listActiveServers")(
            mockInitialState,
            {},
        );

        expect(actualResult.connections).not.to.have.property("conn_uri");
        expect(actualResult.connections).to.deep.equal({});
    });

    test("listActiveServers reducer - lists a saved profile exactly once regardless of active-connection count", async () => {
        const savedConnection = {
            id: "saved-connection-id",
            profileName: "Saved connection",
            server: "saved-server",
            profileSource: CredentialsQuickPickItemType.Profile,
        } as IConnectionProfileWithSource;
        connectionStoreStub.readAllConnections.resolves([savedConnection]);

        const actualResult = await controller["_reducerHandlers"].get("listActiveServers")(
            mockInitialState,
            {},
        );

        expect(actualResult.connections).to.deep.equal({
            "saved-connection-id": {
                profileName: "Saved connection",
                server: "saved-server",
            },
        });
    });

    test("listActiveServers reducer - multiple saved profiles each appear in connections under their own ID", async () => {
        const firstSavedConnection = {
            id: "first-saved-id",
            profileName: "First saved connection",
            server: "shared-server",
            authenticationType: "SqlLogin",
            user: "shared-user",
            profileSource: CredentialsQuickPickItemType.Profile,
        } as IConnectionProfileWithSource;
        const secondSavedConnection = {
            ...firstSavedConnection,
            id: "second-saved-id",
            profileName: "Second saved connection",
        };
        connectionStoreStub.readAllConnections.resolves([
            firstSavedConnection,
            secondSavedConnection,
        ]);

        const actualResult = await controller["_reducerHandlers"].get("listActiveServers")(
            mockInitialState,
            {},
        );

        expect(actualResult.connections).to.have.property("first-saved-id");
        expect(actualResult.connections).to.have.property("second-saved-id");
        expect(actualResult.connections["first-saved-id"].profileName).to.equal(
            "First saved connection",
        );
        expect(actualResult.connections["second-saved-id"].profileName).to.equal(
            "Second saved connection",
        );
    });

    test("listDatabasesForActiveServer reducer - rejects an unsaved active connection", async () => {
        const payload = { connectionUri: "conn_uri" };

        const actualResult = await controller["_reducerHandlers"].get(
            "listDatabasesForActiveServer",
        )(mockInitialState, payload);

        expect(actualResult.databases).to.deep.equal([]);
        expect(actualResult.isDatabaseListLoading).to.be.false;
        expect(actualResult.databaseListError).to.contain("conn_uri");
        expect(connectionManagerStub.listDatabases).not.to.have.been.called;
    });

    test("listDatabasesForActiveServer reducer - immediately replaces old databases with the configured database while loading", async () => {
        const savedConnection = {
            id: "conn_uri",
            profileName: "Saved connection",
            server: "server1",
            profileSource: CredentialsQuickPickItemType.Profile,
        } as IConnectionProfileWithSource;
        connectionStoreStub.readAllConnections.resolves([savedConnection]);
        mockConnectionInfo.credentials = savedConnection;
        let resolveDatabases!: (databases: string[]) => void;
        connectionManagerStub.listDatabases.returns(
            new Promise<string[]>((resolve) => {
                resolveDatabases = resolve;
            }),
        );
        const state = structuredClone(mockInitialState);
        state.databases = [
            {
                displayName: "old-database",
                value: "old-database",
                groupName: locConstants.ConnectionDialog.userDatabasesGroup,
            },
        ];
        state.databaseListConnectionId = "old-connection";

        const request = controller["_reducerHandlers"].get("listDatabasesForActiveServer")(state, {
            connectionUri: "conn_uri",
            connectionDatabaseName: "configured-database",
        });
        await new Promise<void>((resolve) => setImmediate(resolve));

        expect(state.databaseListConnectionId).to.equal("conn_uri");
        expect(state.databases.map((database) => database.value)).to.deep.equal([
            "configured-database",
        ]);
        expect(state.isDatabaseListLoading).to.be.true;
        expect(state.databaseListError).to.equal("");

        resolveDatabases(["db1"]);
        await request;

        expect(state.databases.map((database) => database.value)).to.deep.equal([
            "configured-database",
            "db1",
        ]);
        expect(state.isDatabaseListLoading).to.be.false;
    });

    test("listDatabasesForActiveServer reducer - groups, sorts, and caches database options per connection", async () => {
        const serverA = {
            id: "server-a-uri",
            profileName: "Server A",
            server: "server-a",
            profileSource: CredentialsQuickPickItemType.Profile,
        } as IConnectionProfileWithSource;
        const serverB = {
            id: "server-b-uri",
            profileName: "Server B",
            server: "server-b",
            profileSource: CredentialsQuickPickItemType.Profile,
        } as IConnectionProfileWithSource;
        const serverAConnection = new ConnectionInfo();
        serverAConnection.credentials = serverA;
        const serverBConnection = new ConnectionInfo();
        serverBConnection.credentials = serverB;
        connectionStoreStub.readAllConnections.resolves([serverA, serverB]);
        activeConnections = {
            "server-a-uri": serverAConnection,
            "server-b-uri": serverBConnection,
        };
        connectionManagerStub.isConnected.withArgs("server-a-uri").returns(true);
        connectionManagerStub.isConnected.withArgs("server-b-uri").returns(true);
        const serverAListDatabases = connectionManagerStub.listDatabases.withArgs("server-a-uri");
        serverAListDatabases
            .onFirstCall()
            .resolves(["tempdb", "z-database", "master", "a-database"]);
        serverAListDatabases.onSecondCall().rejects(new Error("Database cache was not used"));
        connectionManagerStub.listDatabases.withArgs("server-b-uri").resolves(["b-database"]);
        const state = structuredClone(mockInitialState);
        const listDatabases = controller["_reducerHandlers"].get("listDatabasesForActiveServer");

        await listDatabases(state, { connectionUri: "server-a-uri" });
        await listDatabases(state, { connectionUri: "server-b-uri" });
        const cachedResult = await listDatabases(state, { connectionUri: "server-a-uri" });

        expect(connectionManagerStub.listDatabases).to.have.been.calledWith("server-b-uri");
        expect(cachedResult.databases).to.deep.equal([
            {
                displayName: "a-database",
                value: "a-database",
                groupName: locConstants.ConnectionDialog.userDatabasesGroup,
            },
            {
                displayName: "z-database",
                value: "z-database",
                groupName: locConstants.ConnectionDialog.userDatabasesGroup,
            },
            {
                displayName: "master",
                value: "master",
                groupName: locConstants.ConnectionDialog.systemDatabasesGroup,
            },
            {
                displayName: "tempdb",
                value: "tempdb",
                groupName: locConstants.ConnectionDialog.systemDatabasesGroup,
            },
        ]);
        expect(cachedResult.databaseListConnectionId).to.equal("server-a-uri");
        expect(cachedResult.isDatabaseListLoading).to.be.false;
    });

    test("listDatabasesForActiveServer reducer - exposes connection failures and retains the configured database", async () => {
        const savedConnection = {
            id: "saved-connection-id",
            profileName: "Saved connection",
            server: "saved-server",
            database: "configured-database",
            profileSource: CredentialsQuickPickItemType.Profile,
        } as IConnectionProfileWithSource;
        connectionStoreStub.readAllConnections.resolves([savedConnection]);
        let failedConnectionUri = "";
        connectionManagerStub.connect.callsFake(async (fileUri) => {
            failedConnectionUri = fileUri;
            const failedConnection = new ConnectionInfo();
            failedConnection.credentials = savedConnection;
            failedConnection.errorMessage = "Login failed";
            activeConnections[fileUri] = failedConnection;
            connectionManagerStub.getConnectionInfo.withArgs(fileUri).returns(failedConnection);
            return false;
        });
        const state = structuredClone(mockInitialState);
        state.connections = {
            [savedConnection.id]: {
                profileName: savedConnection.profileName,
                server: savedConnection.server,
                database: savedConnection.database,
            },
        };

        const result = await controller["_reducerHandlers"].get("listDatabasesForActiveServer")(
            state,
            { connectionUri: savedConnection.id },
        );

        expect(result.databases.map((database) => database.value)).to.deep.equal([
            "configured-database",
        ]);
        expect(result.isDatabaseListLoading).to.be.false;
        expect(result.databaseListError).to.equal("Login failed");
        expect(activeConnections).not.to.have.property(failedConnectionUri);
    });

    test("listDatabasesForActiveServer reducer - stale request cannot overwrite newer databases", async () => {
        let resolveFirstDatabases!: (databases: string[]) => void;
        const serverA = {
            id: "server-a-uri",
            profileName: "Server A",
            server: "server-a",
            profileSource: CredentialsQuickPickItemType.Profile,
        } as IConnectionProfileWithSource;
        const serverB = {
            id: "server-b-uri",
            profileName: "Server B",
            server: "server-b",
            profileSource: CredentialsQuickPickItemType.Profile,
        } as IConnectionProfileWithSource;
        const serverAConnection = new ConnectionInfo();
        serverAConnection.credentials = serverA;
        const serverBConnection = new ConnectionInfo();
        serverBConnection.credentials = serverB;
        connectionStoreStub.readAllConnections.resolves([serverA, serverB]);
        activeConnections = {
            "server-a-uri": serverAConnection,
            "server-b-uri": serverBConnection,
        };
        connectionManagerStub.isConnected.withArgs("server-a-uri").returns(true);
        connectionManagerStub.isConnected.withArgs("server-b-uri").returns(true);
        connectionManagerStub.listDatabases.withArgs("server-a-uri").returns(
            new Promise<string[]>((resolve) => {
                resolveFirstDatabases = resolve;
            }),
        );
        connectionManagerStub.listDatabases.withArgs("server-b-uri").resolves(["b-database"]);
        const state = structuredClone(mockInitialState);
        const listDatabases = controller["_reducerHandlers"].get("listDatabasesForActiveServer");

        const firstRequest = listDatabases(state, { connectionUri: "server-a-uri" });
        await new Promise<void>((resolve) => setImmediate(resolve));

        const secondResult = await listDatabases(state, {
            connectionUri: "server-b-uri",
        });
        expect(secondResult.databases.map((database) => database.value)).to.deep.equal([
            "b-database",
        ]);

        resolveFirstDatabases(["a-database"]);
        await firstRequest;

        expect(state.databases.map((database) => database.value)).to.deep.equal(["b-database"]);
        expect(controller["databaseListCache"].has("server-a-uri")).to.be.false;
    });

    test("listDatabasesForActiveServer reducer - connects an inactive saved connection", async () => {
        const savedConnection = {
            id: "saved-connection-id",
            profileName: "Saved connection",
            server: "saved-server",
            profileSource: CredentialsQuickPickItemType.Profile,
        } as IConnectionProfileWithSource;
        connectionStoreStub.readAllConnections.resolves([savedConnection]);
        const savedConnectionInfo = new ConnectionInfo();
        savedConnectionInfo.credentials = savedConnection;
        // Capture the generated URI that connectToServer passes to connect
        let capturedUri: string;
        connectionManagerStub.connect.callsFake(async (uri: string) => {
            capturedUri = uri;
            activeConnections[uri] = savedConnectionInfo;
            return true;
        });
        connectionManagerStub.isConnected.callsFake(
            (connectionUri) => connectionUri === "conn_uri" || connectionUri in activeConnections,
        );
        // confirmSelectedDatabase calls getConnectionInfo then findMatchingProfile
        connectionManagerStub.getConnectionInfo.returns(savedConnectionInfo);
        connectionManagerStub.findMatchingProfile.resolves({
            profile: savedConnection as unknown as IConnectionProfile,
            score: utils.MatchScore.Id,
        });
        const state = structuredClone(mockInitialState);
        state.connections = {
            "saved-connection-id": {
                profileName: "Saved connection",
                server: "saved-server",
            },
        };

        const actualResult = await controller["_reducerHandlers"].get(
            "listDatabasesForActiveServer",
        )(state, { connectionUri: "saved-connection-id" });

        // connect is called with the generated adhoc URI and the saved profile
        expect(connectionManagerStub.connect).to.have.been.calledWithMatch(
            sinon.match.string,
            sinon.match({ id: savedConnection.id }),
        );
        expect(connectionManagerStub.listDatabases).to.have.been.calledWith(capturedUri);
        expect(actualResult.databases.map((database) => database.value)).to.deep.equal([
            "db1",
            "db2",
        ]);
        controller["connectionUris"].clear();
        const confirmedResult = await controller["_reducerHandlers"].get("confirmSelectedDatabase")(
            actualResult,
            {
                endpointType: "source",
                serverConnectionUri: "saved-connection-id",
                databaseName: "db1",
            },
        );

        expect(confirmedResult.sourceEndpointInfo.ownerUri).to.equal(capturedUri);
        expect(confirmedResult.sourceEndpointInfo.connectionId).to.equal("saved-connection-id");
        expect(confirmedResult.sourceEndpointInfo.databaseName).to.equal("db1");
        expect(confirmedResult.sourceEndpointInfo.connectionDetails).to.be.undefined;
    });

    test("confirmSelectedDatabase reducer - reports a missing saved connection", async () => {
        const showErrorMessage = sandbox
            .stub(vscode.window, "showErrorMessage")
            .resolves(undefined);

        const result = await controller["_reducerHandlers"].get("confirmSelectedDatabase")(
            structuredClone(mockInitialState),
            {
                endpointType: "source",
                serverConnectionUri: "missing-connection-id",
                databaseName: "db1",
            },
        );

        expect(showErrorMessage).to.have.been.calledWith(
            locConstants.SchemaCompare.connectionFailed(
                locConstants.SchemaCompare.savedConnectionNotFound("missing-connection-id"),
            ),
        );
        expect(result.sourceEndpointInfo).to.deep.equal(mockInitialState.sourceEndpointInfo);
    });

    test("listDatabasesForActiveServer reducer - reconnects an edited saved connection", async () => {
        const originalConnection = {
            id: "saved-connection-id",
            profileName: "Saved connection",
            server: "old-server",
            authenticationType: "SqlLogin",
            user: "old-user",
            profileSource: CredentialsQuickPickItemType.Profile,
        } as IConnectionProfileWithSource;
        const editedConnection = {
            ...originalConnection,
            server: "new-server",
            user: "new-user",
        };
        const originalConnectionInfo = new ConnectionInfo();
        originalConnectionInfo.credentials = originalConnection;
        activeConnections = {
            "old-connection-uri": originalConnectionInfo,
        };
        connectionStoreStub.readAllConnections.onFirstCall().resolves([originalConnection]);
        connectionStoreStub.readAllConnections.onSecondCall().resolves([editedConnection]);
        connectionManagerStub.isConnected.callsFake(
            (connectionUri) => connectionUri in activeConnections,
        );
        // Capture the generated URI for the new connection
        let capturedUri: string;
        connectionManagerStub.connect.callsFake(async (uri: string) => {
            capturedUri = uri;
            const editedConnectionInfo = new ConnectionInfo();
            editedConnectionInfo.credentials = editedConnection;
            activeConnections[uri] = editedConnectionInfo;
            return true;
        });
        const state = structuredClone(mockInitialState);

        await controller["_reducerHandlers"].get("listActiveServers")(state, {});
        const actualResult = await controller["_reducerHandlers"].get(
            "listDatabasesForActiveServer",
        )(state, { connectionUri: "saved-connection-id" });

        // connect is called with a generated URI and the edited profile
        expect(connectionManagerStub.connect).to.have.been.calledWithMatch(
            sinon.match.string,
            sinon.match({ server: editedConnection.server, user: editedConnection.user }),
        );
        expect(connectionManagerStub.listDatabases).to.have.been.calledWith(capturedUri);
        expect(connectionManagerStub.listDatabases).not.to.have.been.calledWith(
            "old-connection-uri",
        );
        expect(actualResult.databases.map((database) => database.value)).to.deep.equal([
            "db1",
            "db2",
        ]);
    });

    test("listDatabasesForActiveServer reducer - reconnects saved endpoint after URI refresh", async () => {
        const savedConnection = {
            id: "saved-connection-id",
            profileName: "Saved connection",
            server: "saved-server",
            profileSource: CredentialsQuickPickItemType.Profile,
        } as IConnectionProfileWithSource;
        const savedConnectionInfo = new ConnectionInfo();
        savedConnectionInfo.credentials = savedConnection;
        // Capture each URI that connectToServer generates for its connect call
        const capturedUris: string[] = [];
        connectionStoreStub.readAllConnections.resolves([savedConnection]);
        connectionManagerStub.connect.callsFake(async (uri: string) => {
            capturedUris.push(uri);
            activeConnections[uri] = savedConnectionInfo;
            return true;
        });
        connectionManagerStub.isConnected.callsFake(
            (connectionUri) => connectionUri in activeConnections,
        );
        // confirmSelectedDatabase needs getConnectionInfo and findMatchingProfile
        connectionManagerStub.getConnectionInfo.returns(savedConnectionInfo);
        connectionManagerStub.findMatchingProfile.resolves({
            profile: savedConnection as unknown as IConnectionProfile,
            score: utils.MatchScore.Id,
        });
        const state = structuredClone(mockInitialState);
        controller.state = state;
        await controller["_reducerHandlers"].get("listActiveServers")(state, {});

        await controller["_reducerHandlers"].get("listDatabasesForActiveServer")(state, {
            connectionUri: savedConnection.id,
        });
        const confirmedResult = await controller["_reducerHandlers"].get("confirmSelectedDatabase")(
            state,
            {
                endpointType: "source",
                serverConnectionUri: savedConnection.id,
                databaseName: "db1",
            },
        );

        const firstUri = capturedUris[0];
        expect(confirmedResult.sourceEndpointInfo.ownerUri).to.equal(firstUri);
        expect(confirmedResult.sourceEndpointInfo.connectionId).to.equal(savedConnection.id);

        delete activeConnections[firstUri];
        connectionChangedEmitter.fire();
        await new Promise<void>((resolve) => setImmediate(resolve));

        const reopenedResult = await controller["_reducerHandlers"].get(
            "listDatabasesForActiveServer",
        )(state, {
            connectionUri: confirmedResult.sourceEndpointInfo.connectionId,
        });

        const secondUri = capturedUris[1];
        expect(connectionManagerStub.connect).to.have.been.calledWithMatch(
            sinon.match.string,
            sinon.match({ id: savedConnection.id }),
        );
        expect(connectionManagerStub.listDatabases).to.have.been.calledWith(secondUri);
        expect(reopenedResult.databases.map((database) => database.value)).to.deep.equal([
            "db1",
            "db2",
        ]);
    });

    test("listDatabasesForActiveServer reducer - retry uses new connected URI instead of stale failed URI", async () => {
        const savedConnection = {
            id: "saved-connection-id",
            profileName: "Saved connection",
            server: "saved-server",
            profileSource: CredentialsQuickPickItemType.Profile,
        } as IConnectionProfileWithSource;
        const failedConnection = new ConnectionInfo();
        failedConnection.credentials = savedConnection;
        failedConnection.errorMessage = "Login failed";
        activeConnections = {
            "failed-connection-uri": failedConnection,
        };
        connectionStoreStub.readAllConnections.resolves([savedConnection]);
        // getUriForConnection returns the stale failed URI; isConnected returns false for it
        connectionManagerStub.getUriForConnection.returns("failed-connection-uri");
        connectionManagerStub.isConnected.callsFake(
            (connectionUri) =>
                connectionUri in activeConnections &&
                !activeConnections[connectionUri].errorMessage,
        );
        // Capture the generated URI that connectToServer uses for the new connection
        let capturedUri: string;
        connectionManagerStub.connect.callsFake(async (uri: string) => {
            capturedUri = uri;
            const successfulConnection = new ConnectionInfo();
            successfulConnection.credentials = { ...savedConnection };
            activeConnections[uri] = successfulConnection;
            return true;
        });
        const state = structuredClone(mockInitialState);
        state.connections = {
            "saved-connection-id": {
                profileName: "Saved connection",
                server: "saved-server",
            },
        };

        const actualResult = await controller["_reducerHandlers"].get(
            "listDatabasesForActiveServer",
        )(state, { connectionUri: "saved-connection-id" });

        // listDatabases is called with the new generated URI, not the stale failed one
        expect(connectionManagerStub.listDatabases).to.have.been.calledWith(capturedUri);
        expect(connectionManagerStub.listDatabases).not.to.have.been.calledWith(
            "failed-connection-uri",
        );
        expect(actualResult.databases.map((database) => database.value)).to.deep.equal([
            "db1",
            "db2",
        ]);
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

    test("publishChanges reducer - database target - success clears diff result and sets applySucceeded", async () => {
        const publishDatabaseChangesStub = sandbox
            .stub(scUtils, "publishDatabaseChanges")
            .resolves({ success: true, errorMessage: "" });

        sandbox.stub(UserSurvey, "getInstance").returns({
            promptUserForNPSFeedback: sandbox.stub().resolves(),
        } as unknown as UserSurvey);

        const state = { ...mockInitialState, targetEndpointInfo };
        const payload = { targetServerName: "localhost,1433", targetDatabaseName: "master" };

        const result = await controller["_reducerHandlers"].get("publishChanges")(state, payload);

        expect(
            publishDatabaseChangesStub,
            "publishDatabaseChanges should be called with correct operationId and execution mode",
        ).to.have.been.calledWithMatch(operationId, TaskExecutionMode.execute);
        expect(result.isApplyInProgress, "isApplyInProgress should be false after completion").to.be
            .false;
        expect(result.applySucceeded, "applySucceeded should be true on success").to.be.true;
        expect(result.applyFailed, "applyFailed should be false on success").to.be.false;
        expect(result.schemaCompareResult, "schemaCompareResult should be cleared on success").to.be
            .undefined;
    });

    test("publishChanges reducer - database target - STS failure clears diff result and sets applyFailed", async () => {
        const publishDatabaseChangesStub = sandbox
            .stub(scUtils, "publishDatabaseChanges")
            .resolves({ success: false, errorMessage: "Apply failed" });

        const state = { ...mockInitialState, targetEndpointInfo };
        const payload = { targetServerName: "localhost,1433", targetDatabaseName: "master" };

        const result = await controller["_reducerHandlers"].get("publishChanges")(state, payload);

        expect(
            publishDatabaseChangesStub,
            "publishDatabaseChanges should be called with correct operationId and execution mode",
        ).to.have.been.calledWithMatch(operationId, TaskExecutionMode.execute);
        expect(result.isApplyInProgress, "isApplyInProgress should be false after failure").to.be
            .false;
        expect(result.applySucceeded, "applySucceeded should remain false on failure").to.be.false;
        expect(result.applyFailed, "applyFailed should be true on failure").to.be.true;
        expect(
            result.schemaCompareResult,
            "schemaCompareResult should be cleared on failure to force re-compare and prevent stale script generation",
        ).to.be.undefined;
    });
});
