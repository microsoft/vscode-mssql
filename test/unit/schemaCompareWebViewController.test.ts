/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from "assert";
import * as vscode from "vscode";
import * as TypeMoq from "typemoq";
import * as sinon from "sinon";
import * as mssql from "vscode-mssql";

import { SchemaCompareWebViewController } from "../../src/schemaCompare/schemaCompareWebViewController";
import { TreeNodeInfo } from "../../src/objectExplorer/treeNodeInfo";
import ConnectionManager from "../../src/controllers/connectionManager";
import { SchemaCompareWebViewState } from "../../src/sharedInterfaces/schemaCompare";
import * as scUtils from "../../src/schemaCompare/schemaCompareUtils";
import VscodeWrapper from "../../src/controllers/vscodeWrapper";

suite("SchemaCompareWebViewController Tests", () => {
    let controller: SchemaCompareWebViewController;
    let sandbox: sinon.SinonSandbox;
    let mockContext: vscode.ExtensionContext;
    let treeNode: TreeNodeInfo;
    let mockSchemaCompareService: TypeMoq.IMock<mssql.ISchemaCompareService>;
    let mockConnectionManager: TypeMoq.IMock<ConnectionManager>;
    let mockInitialState: SchemaCompareWebViewState;
    let vscodeWrapper: TypeMoq.IMock<VscodeWrapper>;
    const schemaCompareWebViewTitle: string = "Schema Compare";
    const operationId = "AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE";
    let generateOperationIdStub: sinon.SinonStub<[], string>;

    const deploymentOptions: mssql.DeploymentOptions = {
        excludeObjectTypes: {
            value: [
                "ServerTriggers",
                "Routes",
                "LinkedServerLogins",
                "Endpoints",
                "ErrorMessages",
            ],
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
        dataSchemaProvider: "160",
    };

    const targetEndpointInfo = {
        endpointType: 0,
        packageFilePath: "",
        serverDisplayName: "localhost,1433 (sa)",
        serverName: "localhost,1433",
        databaseName: "master",
        ownerUri:
            "connection:providerName:MSSQL|server:localhost,1433|trustServerCertificate:true|user:sa|groupId:C777F06B-202E-4480-B475-FA416154D458",
        connectionDetails: undefined,
        connectionName: "",
        projectFilePath: "",
        targetScripts: [],
        extractTarget: 5,
        dataSchemaProvider: "",
    };

    const taskExecutionMode = mssql.TaskExecutionMode.execute;

    setup(() => {
        sandbox = sinon.createSandbox();

        let sourceEndpointInfo: mssql.SchemaCompareEndpointInfo = {
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

        mockInitialState = {
            defaultDeploymentOptionsResult: deploymentOptionsResultMock,
            sourceEndpointInfo: sourceEndpointInfo,
            targetEndpointInfo: undefined,
            schemaCompareResult: undefined,
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

        let context: mssql.TreeNodeContextValue = {
            type: "",
            subType: "",
            filterable: false,
            hasFilters: false,
        };

        let connInfo: mssql.IConnectionInfo = {
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
        );

        mockSchemaCompareService =
            TypeMoq.Mock.ofType<mssql.ISchemaCompareService>();

        vscodeWrapper = TypeMoq.Mock.ofType(
            VscodeWrapper,
            TypeMoq.MockBehavior.Loose,
        );

        mockConnectionManager = TypeMoq.Mock.ofType<ConnectionManager>();
        mockConnectionManager
            .setup((mgr) => mgr.getUriForConnection(TypeMoq.It.isAny()))
            .returns(() => "localhost,1433_undefined_sa_undefined");

        generateOperationIdStub = sandbox
            .stub(scUtils, "generateOperationId")
            .returns(operationId);

        controller = new SchemaCompareWebViewController(
            mockContext,
            vscodeWrapper.object,
            treeNode,
            mockSchemaCompareService.object,
            mockConnectionManager.object,
            deploymentOptionsResultMock,
            schemaCompareWebViewTitle,
        );
    });

    teardown(() => {
        generateOperationIdStub.restore();

        sandbox.restore();
    });

    test("controller - initialize title - is 'Schema Compare'", () => {
        assert.deepStrictEqual(
            controller.panel.title,
            schemaCompareWebViewTitle,
            "Webview Title should match",
        );
    });

    test("start - called with sqlproject path - sets sourceEndpointInfo correctly", () => {
        const mockSqlProjectNode = {
            treeDataProvider: {
                roots: [
                    {
                        projectFileUri: {
                            fsPath: "c:\\TestSqlProject\\TestProject.sqlproj",
                        },
                    },
                ],
            },
        };

        const scController = new SchemaCompareWebViewController(
            mockContext,
            vscodeWrapper.object,
            mockSqlProjectNode,
            mockSchemaCompareService.object,
            mockConnectionManager.object,
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

        assert.deepEqual(
            scController.state.sourceEndpointInfo,
            expected,
            "sourceEndpointInfo should match the expected path",
        );
    });

    test("compare reducer - when called - completes successfully", async () => {
        const expectedCompareResultMock: mssql.SchemaCompareResult = {
            operationId: "AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE",
            areEqual: true,
            differences: [],
            success: true,
            errorMessage: "",
        };

        const compareStub = sandbox
            .stub(scUtils, "compare")
            .resolves(expectedCompareResultMock);

        const payload = {
            sourceEndpointInfo,
            targetEndpointInfo,
            taskExecutionMode,
            deploymentOptions,
        };

        const result = await controller["_reducers"]["compare"](
            mockInitialState,
            payload,
        );

        assert.deepEqual(
            compareStub.firstCall.args,
            [operationId, payload, mockSchemaCompareService.object],
            "compare should be called with correct arguments",
        );

        assert.ok(compareStub.calledOnce, "compare should be called once");

        assert.deepEqual(
            result.schemaCompareResult,
            expectedCompareResultMock,
            "compare should return expected result",
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
            taskExecutionMode,
        };

        const result = await controller["_reducers"]["generateScript"](
            mockInitialState,
            payload,
        );

        assert.ok(
            generateScriptStub.calledOnce,
            "generateScript should be called once",
        );

        assert.deepEqual(
            generateScriptStub.firstCall.args,
            [operationId, payload, mockSchemaCompareService.object],
            "generateScript should be called with correct arguments",
        );

        assert.deepEqual(
            result.generateScriptResultStatus,
            expectedScriptResultMock,
            "generateScript should return expected result",
        );

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
            taskExecutionMode,
        };

        const actualResult = await controller["_reducers"][
            "publishDatabaseChanges"
        ](mockInitialState, payload);

        assert.ok(
            publishDatabaseChangesStub.calledOnce,
            "publishDatabaseChanges should be called once",
        );

        assert.deepEqual(
            publishDatabaseChangesStub.firstCall.args,
            [operationId, payload, mockSchemaCompareService.object],
            "publishDatabaseChanges should be called with correct arguments",
        );

        assert.deepEqual(
            actualResult.publishDatabaseChangesResultStatus,
            expectedResultMock,
            "publishDatabaseChanges should return expected result",
        );

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
            targetProjectPath:
                "/TestSqlProject/TestProject/TestProject.sqlproj",
            targetFolderStructure: mssql.ExtractTarget.schemaObjectType,
            taskExecutionMode,
        };

        const acutalResult = await controller["_reducers"][
            "publishProjectChanges"
        ](mockInitialState, payload);

        assert.ok(
            publishProjectChangesStub.calledOnce,
            "publishProjectChanges should be called once",
        );

        assert.deepEqual(
            publishProjectChangesStub.firstCall.args,
            [operationId, payload, mockSchemaCompareService.object],
            "publishProjectChanges should be called with correct arguments",
        );

        assert.deepEqual(
            acutalResult.schemaComparePublishProjectResult,
            expectedResultMock,
            "publishProjectChanges should return expected result",
        );

        publishProjectChangesStub.restore();
    });

    test("getDefaultOptions reducer - when called - completes successfully", async () => {
        const getDefaultOptionsStub = sandbox
            .stub(scUtils, "getDefaultOptions")
            .resolves(deploymentOptionsResultMock);

        const payload = {};

        const acutalResult = await controller["_reducers"]["getDefaultOptions"](
            mockInitialState,
            payload,
        );

        assert.ok(
            getDefaultOptionsStub.calledOnce,
            "getDefaultOptions should be called once",
        );

        assert.deepEqual(
            getDefaultOptionsStub.firstCall.args,
            [mockSchemaCompareService.object],
            "getDefaultOptions should be called with correct arguments",
        );

        assert.deepEqual(
            acutalResult.defaultDeploymentOptionsResult,
            deploymentOptionsResultMock,
            "getDefaultOptions should return expected result",
        );

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
            targetProjectPath:
                "/TestSqlProject/TestProject/TestProject.sqlproj",
            targetFolderStructure: mssql.ExtractTarget.schemaObjectType,
            taskExecutionMode,
        };

        const actualResult = await controller["_reducers"][
            "includeExcludeNode"
        ](mockInitialState, payload);

        assert.ok(
            publishProjectChangesStub.calledOnce,
            "includeExcludeNode should be called once",
        );

        assert.deepEqual(
            publishProjectChangesStub.firstCall.args,
            [operationId, payload, mockSchemaCompareService.object],
            "includeExcludeNode should be called with correct arguments",
        );

        assert.deepEqual(
            actualResult.schemaCompareIncludeExcludeResult,
            expectedResultMock,
            "includeExcludeNode should return expected result",
        );

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

        const publishProjectChangesStub = sandbox
            .stub(scUtils, "openScmp")
            .resolves(expectedResultMock);

        const payload = {
            filePath: "/comparison/comparison.scmp",
        };

        const actualResult = await controller["_reducers"]["openScmp"](
            mockInitialState,
            payload,
        );

        assert.ok(
            publishProjectChangesStub.calledOnce,
            "openScmp should be called once",
        );

        assert.deepEqual(
            publishProjectChangesStub.firstCall.args,
            [payload, mockSchemaCompareService.object],
            "openScmp should be called with correct arguments",
        );

        assert.deepEqual(
            actualResult.schemaCompareOpenScmpResult,
            expectedResultMock,
            "openScmp should return expected result",
        );

        publishProjectChangesStub.restore();
    });

    test("saveScmp reducer - when called - completes successfully", async () => {
        const expectedResultMock = {
            success: true,
            errorMessage: "",
        };

        const publishProjectChangesStub = sandbox
            .stub(scUtils, "saveScmp")
            .resolves(expectedResultMock);

        const payload = {
            sourceEndpointInfo,
            targetEndpointInfo,
            taskExecutionMode: mssql.TaskExecutionMode.execute,
            deploymentOptions,
            scmpFilePath: "/TestSqlProject/TestProject/",
            excludedSourceObjects: [],
            excludedTargetObjects: [],
        };

        const actualResult = await controller["_reducers"]["saveScmp"](
            mockInitialState,
            payload,
        );

        assert.ok(
            publishProjectChangesStub.calledOnce,
            "saveScmp should be called once",
        );

        assert.deepEqual(
            publishProjectChangesStub.firstCall.args,
            [payload, mockSchemaCompareService.object],
            "saveScmp should be called with correct arguments",
        );

        assert.deepEqual(
            actualResult.saveScmpResultStatus,
            expectedResultMock,
            "saveScmp should return expected result",
        );

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

        const actualResult = await controller["_reducers"]["cancel"](
            mockInitialState,
            payload,
        );

        assert.ok(
            publishProjectChangesStub.calledOnce,
            "cancel should be called once",
        );

        assert.deepEqual(
            publishProjectChangesStub.firstCall.args,
            [operationId, mockSchemaCompareService.object],
            "cancel should be called with correct arguments",
        );

        assert.deepEqual(
            actualResult.cancelResultStatus,
            expectedResultMock,
            "cancel should be called with correct arguments",
        );

        publishProjectChangesStub.restore();
    });
});
