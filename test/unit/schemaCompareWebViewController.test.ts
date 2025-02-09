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

suite("SchemaCompareWebViewController Tests", () => {
    let controller: SchemaCompareWebViewController;
    let sandbox: sinon.SinonSandbox;
    let mockContext: vscode.ExtensionContext;
    let treeNode: TreeNodeInfo;
    let mockSchemaCompareService: TypeMoq.IMock<mssql.ISchemaCompareService>;
    let mockConnectionManager: TypeMoq.IMock<ConnectionManager>;
    let mockInitialState: SchemaCompareWebViewState;
    const schemaCompareWebViewTitle: string = "Schema Compare";
    const operationId = "AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE";

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

    const deploymentOptionsResult: mssql.SchemaCompareOptionsResult = {
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
            defaultDeploymentOptionsResult: deploymentOptionsResult,
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
            password: "Pa$$w0rd",
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

        mockConnectionManager = TypeMoq.Mock.ofType<ConnectionManager>();
        mockConnectionManager
            .setup((mgr) => mgr.getUriForConnection(TypeMoq.It.isAny()))
            .returns(() => "localhost,1433_undefined_sa_undefined");

        controller = new SchemaCompareWebViewController(
            mockContext,
            treeNode,
            mockSchemaCompareService.object,
            mockConnectionManager.object,
            deploymentOptionsResult,
            schemaCompareWebViewTitle,
        );
    });

    teardown(() => {
        sandbox.restore();
    });

    test("controller - initialize title - is 'Schema Compare'", () => {
        assert.deepStrictEqual(
            controller.panel.title,
            schemaCompareWebViewTitle,
            "Webview Title should match",
        );
    });

    test("compare reducer - when called - runs once", async () => {
        const compareResult: mssql.SchemaCompareResult = {
            operationId: "AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE",
            areEqual: true,
            differences: [],
            success: true,
            errorMessage: "",
        };

        const compareStub = sandbox
            .stub(scUtils, "compare")
            .resolves(compareResult);

        const payload = {
            operationId,
            sourceEndpointInfo,
            targetEndpointInfo,
            taskExecutionMode,
            deploymentOptions,
        };

        await controller["_reducers"]["compare"](mockInitialState, payload);

        assert.ok(compareStub.calledOnce, "compare should be called once");

        compareStub.restore();
    });

    test("compare reducer - called - with correct arguments", async () => {
        const compareResult: mssql.SchemaCompareResult = {
            operationId: "AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE",
            areEqual: true,
            differences: [],
            success: true,
            errorMessage: "",
        };

        const compareStub = sandbox
            .stub(scUtils, "compare")
            .resolves(compareResult);

        const payload = {
            operationId,
            sourceEndpointInfo,
            targetEndpointInfo,
            taskExecutionMode,
            deploymentOptions,
        };

        await controller["_reducers"]["compare"](mockInitialState, payload);

        assert.deepEqual(
            compareStub.firstCall.args,
            [mockInitialState, payload, mockSchemaCompareService.object],
            "compare should be called with correct arguments",
        );

        compareStub.restore();
    });

    test("compare reducer - when called - returns expected result", async () => {
        const compareResult: mssql.SchemaCompareResult = {
            operationId: "AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE",
            areEqual: true,
            differences: [],
            success: true,
            errorMessage: "",
        };

        const compareStub = sandbox
            .stub(scUtils, "compare")
            .resolves(compareResult);

        const payload = {
            operationId,
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
            result.schemaCompareResult,
            compareResult,
            "compare should return expected result",
        );

        compareStub.restore();
    });

    test("generateScript reducer - when called - runs once", async () => {
        const result = {
            success: true,
            errorMessage: "",
        };

        const generateScriptStub = sandbox
            .stub(scUtils, "generateScript")
            .resolves(result);

        const payload = {
            operationId,
            targetServerName: "localhost,1433",
            targetDatabaseName: "master",
            taskExecutionMode,
        };

        await controller["_reducers"]["generateScript"](
            mockInitialState,
            payload,
        );

        assert.ok(
            generateScriptStub.calledOnce,
            "generateScript should be called once",
        );

        generateScriptStub.restore();
    });

    test("generateScript reducer - called - with correct arguments", async () => {
        const result = {
            success: true,
            errorMessage: "",
        };

        const generateScriptStub = sandbox
            .stub(scUtils, "generateScript")
            .resolves(result);

        const payload = {
            operationId,
            targetServerName: "localhost,1433",
            targetDatabaseName: "master",
            taskExecutionMode,
        };

        await controller["_reducers"]["generateScript"](
            mockInitialState,
            payload,
        );

        assert.deepEqual(
            generateScriptStub.firstCall.args,
            [mockInitialState, payload, mockSchemaCompareService.object],
            "generateScript should be called with correct arguments",
        );

        generateScriptStub.restore();
    });

    test("generateScript reducer - when called - returns expected result", async () => {
        const scriptResult = {
            success: true,
            errorMessage: "",
        };

        const generateScriptStub = sandbox
            .stub(scUtils, "generateScript")
            .resolves(scriptResult);

        const payload = {
            operationId,
            targetServerName: "localhost,1433",
            targetDatabaseName: "master",
            taskExecutionMode,
        };

        const result = await controller["_reducers"]["generateScript"](
            mockInitialState,
            payload,
        );

        assert.deepEqual(
            result.generateScriptResultStatus,
            scriptResult,
            "generateScript should return expected result",
        );

        generateScriptStub.restore();
    });

    test("publishDatabaseChanges reducer - when called - runs once", async () => {
        const result = {
            success: true,
            errorMessage: "",
        };

        const publishDatabaseChangesStub = sandbox
            .stub(scUtils, "publishDatabaseChanges")
            .resolves(result);

        const payload = {
            operationId,
            targetServerName: "localhost,1433",
            targetDatabaseName: "master",
            taskExecutionMode,
        };

        await controller["_reducers"]["publishDatabaseChanges"](
            mockInitialState,
            payload,
        );

        assert.ok(
            publishDatabaseChangesStub.calledOnce,
            "publishDatabaseChanges should be called once",
        );

        publishDatabaseChangesStub.restore();
    });

    test("publishDatabaseChanges reducer - called - with correct arguments", async () => {
        const result = {
            success: true,
            errorMessage: "",
        };

        const publishDatabaseChangesStub = sandbox
            .stub(scUtils, "publishDatabaseChanges")
            .resolves(result);

        const payload = {
            operationId,
            targetServerName: "localhost,1433",
            targetDatabaseName: "master",
            taskExecutionMode,
        };

        await controller["_reducers"]["publishDatabaseChanges"](
            mockInitialState,
            payload,
        );

        assert.deepEqual(
            publishDatabaseChangesStub.firstCall.args,
            [mockInitialState, payload, mockSchemaCompareService.object],
            "publishDatabaseChanges should be called with correct arguments",
        );

        publishDatabaseChangesStub.restore();
    });

    test("publishDatabaseChanges reducer - when called - returns expected result", async () => {
        const publishDatabaseResult = {
            success: true,
            errorMessage: "",
        };

        const publishDatabaseChangesStub = sandbox
            .stub(scUtils, "publishDatabaseChanges")
            .resolves(publishDatabaseResult);

        const payload = {
            operationId,
            targetServerName: "localhost,1433",
            targetDatabaseName: "master",
            taskExecutionMode,
        };

        const actualResult = await controller["_reducers"][
            "publishDatabaseChanges"
        ](mockInitialState, payload);

        assert.deepEqual(
            actualResult.publishDatabaseChangesResultStatus,
            publishDatabaseResult,
            "publishDatabaseChanges should return expected result",
        );

        publishDatabaseChangesStub.restore();
    });

    test("publishProjectChanges reducer - when called - runs once", async () => {
        const result = {
            success: true,
            errorMessage: "",
            changedFiles: [],
            addedFiles: [],
            deletedFiles: [],
        };

        const publishProjectChangesStub = sandbox
            .stub(scUtils, "publishProjectChanges")
            .resolves(result);

        const payload = {
            operationId,
            targetProjectPath:
                "/TestSqlProject/TestProject/TestProject.sqlproj",
            targetFolderStructure: mssql.ExtractTarget.schemaObjectType,
            taskExecutionMode,
        };

        await controller["_reducers"]["publishProjectChanges"](
            mockInitialState,
            payload,
        );

        assert.ok(
            publishProjectChangesStub.calledOnce,
            "publishProjectChanges should be called once",
        );

        publishProjectChangesStub.restore();
    });

    test("publishProjectChanges reducer - called - with correct arguments", async () => {
        const result = {
            success: true,
            errorMessage: "",
            changedFiles: [],
            addedFiles: [],
            deletedFiles: [],
        };

        const publishProjectChangesStub = sandbox
            .stub(scUtils, "publishProjectChanges")
            .resolves(result);

        const payload = {
            operationId,
            targetProjectPath:
                "/TestSqlProject/TestProject/TestProject.sqlproj",
            targetFolderStructure: mssql.ExtractTarget.schemaObjectType,
            taskExecutionMode,
        };

        await controller["_reducers"]["publishProjectChanges"](
            mockInitialState,
            payload,
        );

        assert.deepEqual(
            publishProjectChangesStub.firstCall.args,
            [mockInitialState, payload, mockSchemaCompareService.object],
            "publishProjectChanges should be called with correct arguments",
        );

        publishProjectChangesStub.restore();
    });

    test("publishProjectChanges reducer - when called - returns expected result", async () => {
        const publishProjectChangesResult = {
            success: true,
            errorMessage: "",
            changedFiles: [],
            addedFiles: [],
            deletedFiles: [],
        };

        const publishProjectChangesStub = sandbox
            .stub(scUtils, "publishProjectChanges")
            .resolves(publishProjectChangesResult);

        const payload = {
            operationId,
            targetProjectPath:
                "/TestSqlProject/TestProject/TestProject.sqlproj",
            targetFolderStructure: mssql.ExtractTarget.schemaObjectType,
            taskExecutionMode,
        };

        const acutalResult = await controller["_reducers"][
            "publishProjectChanges"
        ](mockInitialState, payload);

        assert.deepEqual(
            acutalResult.schemaComparePublishProjectResult,
            publishProjectChangesResult,
            "publishProjectChanges should return expected result",
        );

        publishProjectChangesStub.restore();
    });

    test("getDefaultOptions reducer - when called - runs once", async () => {
        const getDefaultOptionsStub = sandbox
            .stub(scUtils, "getDefaultOptions")
            .resolves(deploymentOptionsResult);

        const payload = {};

        await controller["_reducers"]["getDefaultOptions"](
            mockInitialState,
            payload,
        );

        assert.ok(
            getDefaultOptionsStub.calledOnce,
            "getDefaultOptions should be called once",
        );

        getDefaultOptionsStub.restore();
    });

    test("getDefaultOptions reducer - called - with correct arguments", async () => {
        const getDefaultOptionsStub = sandbox
            .stub(scUtils, "getDefaultOptions")
            .resolves(deploymentOptionsResult);

        const payload = {};

        await controller["_reducers"]["getDefaultOptions"](
            mockInitialState,
            payload,
        );

        assert.deepEqual(
            getDefaultOptionsStub.firstCall.args,
            [mockSchemaCompareService.object],
            "getDefaultOptions should be called with correct arguments",
        );

        getDefaultOptionsStub.restore();
    });

    test("getDefaultOptions reducer - when called - returns expected result", async () => {
        const getDefaultOptionsStub = sandbox
            .stub(scUtils, "getDefaultOptions")
            .resolves(deploymentOptionsResult);

        const payload = {};

        const acutalResult = await controller["_reducers"]["getDefaultOptions"](
            mockInitialState,
            payload,
        );

        assert.deepEqual(
            acutalResult.defaultDeploymentOptionsResult,
            deploymentOptionsResult,
            "getDefaultOptions should return expected result",
        );

        getDefaultOptionsStub.restore();
    });

    test("includeExcludeNode reducer - when called - runs once", async () => {
        const result = {
            success: true,
            errorMessage: "",
            affectedDependencies: [],
            blockingDependencies: [],
        };

        const publishProjectChangesStub = sandbox
            .stub(scUtils, "includeExcludeNode")
            .resolves(result);

        const payload = {
            operationId,
            targetProjectPath:
                "/TestSqlProject/TestProject/TestProject.sqlproj",
            targetFolderStructure: mssql.ExtractTarget.schemaObjectType,
            taskExecutionMode,
        };

        await controller["_reducers"]["includeExcludeNode"](
            mockInitialState,
            payload,
        );

        assert.ok(
            publishProjectChangesStub.calledOnce,
            "includeExcludeNode should be called once",
        );

        publishProjectChangesStub.restore();
    });

    test("includeExcludeNode reducer - called - with correct arguments", async () => {
        const result = {
            success: true,
            errorMessage: "",
            affectedDependencies: [],
            blockingDependencies: [],
        };

        const publishProjectChangesStub = sandbox
            .stub(scUtils, "includeExcludeNode")
            .resolves(result);

        const payload = {
            operationId,
            targetProjectPath:
                "/TestSqlProject/TestProject/TestProject.sqlproj",
            targetFolderStructure: mssql.ExtractTarget.schemaObjectType,
            taskExecutionMode,
        };

        await controller["_reducers"]["includeExcludeNode"](
            mockInitialState,
            payload,
        );

        assert.deepEqual(
            publishProjectChangesStub.firstCall.args,
            [mockInitialState, payload, mockSchemaCompareService.object],
            "includeExcludeNode should be called with correct arguments",
        );

        publishProjectChangesStub.restore();
    });

    test("includeExcludeNode reducer - when called - returns expected result", async () => {
        const includeExcludeNodeResult = {
            success: true,
            errorMessage: "",
            affectedDependencies: [],
            blockingDependencies: [],
        };

        const publishProjectChangesStub = sandbox
            .stub(scUtils, "includeExcludeNode")
            .resolves(includeExcludeNodeResult);

        const payload = {
            operationId,
            targetProjectPath:
                "/TestSqlProject/TestProject/TestProject.sqlproj",
            targetFolderStructure: mssql.ExtractTarget.schemaObjectType,
            taskExecutionMode,
        };

        const actualResult = await controller["_reducers"][
            "includeExcludeNode"
        ](mockInitialState, payload);

        assert.deepEqual(
            actualResult.schemaCompareIncludeExcludeResult,
            includeExcludeNodeResult,
            "includeExcludeNode should return expected result",
        );

        publishProjectChangesStub.restore();
    });

    test("openScmp reducer - when called - runs once", async () => {
        const result = {
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
            .resolves(result);

        const payload = {
            operationId,
            targetProjectPath:
                "/TestSqlProject/TestProject/TestProject.sqlproj",
            targetFolderStructure: mssql.ExtractTarget.schemaObjectType,
            taskExecutionMode,
        };

        await controller["_reducers"]["openScmp"](mockInitialState, payload);

        assert.ok(
            publishProjectChangesStub.calledOnce,
            "openScmp should be called once",
        );

        publishProjectChangesStub.restore();
    });

    test("openScmp reducer - called - with correct arguments", async () => {
        const result = {
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
            .resolves(result);

        const payload = {
            operationId,
            targetProjectPath:
                "/TestSqlProject/TestProject/TestProject.sqlproj",
            targetFolderStructure: mssql.ExtractTarget.schemaObjectType,
            taskExecutionMode,
        };

        await controller["_reducers"]["openScmp"](mockInitialState, payload);

        assert.deepEqual(
            publishProjectChangesStub.firstCall.args,
            [mockInitialState, payload, mockSchemaCompareService.object],
            "openScmp should be called with correct arguments",
        );

        publishProjectChangesStub.restore();
    });

    test("openScmp reducer - when called - returns expected result", async () => {
        const openScmpResult = {
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
            .resolves(openScmpResult);

        const payload = {
            operationId,
            targetProjectPath:
                "/TestSqlProject/TestProject/TestProject.sqlproj",
            targetFolderStructure: mssql.ExtractTarget.schemaObjectType,
            taskExecutionMode,
        };

        const actualResult = await controller["_reducers"]["openScmp"](
            mockInitialState,
            payload,
        );

        assert.deepEqual(
            actualResult.schemaCompareOpenScmpResult,
            openScmpResult,
            "openScmp should return expected result",
        );

        publishProjectChangesStub.restore();
    });

    test("saveScmp reducer - when called - runs once", async () => {
        const result = {
            success: true,
            errorMessage: "",
        };

        const publishProjectChangesStub = sandbox
            .stub(scUtils, "saveScmp")
            .resolves(result);

        const payload = {
            sourceEndpointInfo,
            targetEndpointInfo,
            taskExecutionMode: mssql.TaskExecutionMode.execute,
            deploymentOptions,
            scmpFilePath: "/TestSqlProject/TestProject/",
            excludedSourceObjects: [],
            excludedTargetObjects: [],
        };

        await controller["_reducers"]["saveScmp"](mockInitialState, payload);

        assert.ok(
            publishProjectChangesStub.calledOnce,
            "saveScmp should be called once",
        );

        publishProjectChangesStub.restore();
    });

    test("saveScmp reducer - called - with correct arguments", async () => {
        const result = {
            success: true,
            errorMessage: "",
        };

        const publishProjectChangesStub = sandbox
            .stub(scUtils, "saveScmp")
            .resolves(result);

        const payload = {
            sourceEndpointInfo,
            targetEndpointInfo,
            taskExecutionMode: mssql.TaskExecutionMode.execute,
            deploymentOptions,
            scmpFilePath: "/TestSqlProject/TestProject/",
            excludedSourceObjects: [],
            excludedTargetObjects: [],
        };

        await controller["_reducers"]["saveScmp"](mockInitialState, payload);

        assert.deepEqual(
            publishProjectChangesStub.firstCall.args,
            [mockInitialState, payload, mockSchemaCompareService.object],
            "saveScmp should be called with correct arguments",
        );

        publishProjectChangesStub.restore();
    });

    test("saveScmp reducer - when called - returns expected result", async () => {
        const saveScmpResult = {
            success: true,
            errorMessage: "",
        };

        const publishProjectChangesStub = sandbox
            .stub(scUtils, "saveScmp")
            .resolves(saveScmpResult);

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

        assert.deepEqual(
            actualResult.saveScmpResultStatus,
            saveScmpResult,
            "saveScmp should return expected result",
        );

        publishProjectChangesStub.restore();
    });

    test("cancel reducer - when called - runs once", async () => {
        const result = {
            success: true,
            errorMessage: "",
        };

        const publishProjectChangesStub = sandbox
            .stub(scUtils, "cancel")
            .resolves(result);

        const payload = {
            operationId,
        };

        await controller["_reducers"]["cancel"](mockInitialState, payload);

        assert.ok(
            publishProjectChangesStub.calledOnce,
            "cancel should be called once",
        );

        publishProjectChangesStub.restore();
    });

    test("cancel reducer - called - with correct arguments", async () => {
        const result = {
            success: true,
            errorMessage: "",
        };

        const publishProjectChangesStub = sandbox
            .stub(scUtils, "cancel")
            .resolves(result);

        const payload = {
            operationId,
        };

        await controller["_reducers"]["cancel"](mockInitialState, payload);

        assert.deepEqual(
            publishProjectChangesStub.firstCall.args,
            [mockInitialState, payload, mockSchemaCompareService.object],
            "cancel should be called with correct arguments",
        );

        publishProjectChangesStub.restore();
    });

    test("cancel reducer - when called - returns expected result", async () => {
        const cancelResult = {
            success: true,
            errorMessage: "",
        };

        const publishProjectChangesStub = sandbox
            .stub(scUtils, "cancel")
            .resolves(cancelResult);

        const payload = {
            operationId,
        };

        const actualResult = await controller["_reducers"]["cancel"](
            mockInitialState,
            payload,
        );

        assert.deepEqual(
            actualResult.cancelResultStatus,
            cancelResult,
            "cancel should be called with correct arguments",
        );

        publishProjectChangesStub.restore();
    });
});
