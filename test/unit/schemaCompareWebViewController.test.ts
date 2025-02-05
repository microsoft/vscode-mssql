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
            defaultDeploymentOptions: deploymentOptions,
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
            deploymentOptions,
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

    test("compare reducer - called once", async () => {
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

        await controller["_reducers"]["schemaCompare"](
            mockInitialState,
            payload,
        );

        assert.ok(compareStub.calledOnce, "compare should be called once");
    });

    test("generateScript reducer - called once", async () => {
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

        await controller["_reducers"]["schemaCompareGenerateScript"](
            mockInitialState,
            payload,
        );

        assert.ok(
            generateScriptStub.calledOnce,
            "generateScript should be called once",
        );
    });

    test("publishDatabaseChanges reducer - called once", async () => {
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

        await controller["_reducers"]["schemaComparePublishDatabaseChanges"](
            mockInitialState,
            payload,
        );

        assert.ok(
            publishDatabaseChangesStub.calledOnce,
            "publishDatabaseChanges should be called once",
        );
    });

    test("schemaComparePublishProjectChanges reducer - called once", async () => {
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

        await controller["_reducers"]["schemaComparePublishProjectChanges"](
            mockInitialState,
            payload,
        );

        assert.ok(
            publishProjectChangesStub.calledOnce,
            "schemaComparePublishProjectChanges should be called once",
        );
    });

    test("schemaCompareIncludeExcludeNode reducer - called once", async () => {
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

        await controller["_reducers"]["schemaCompareIncludeExcludeNode"](
            mockInitialState,
            payload,
        );

        assert.ok(
            publishProjectChangesStub.calledOnce,
            "schemaCompareIncludeExcludeNode should be called once",
        );
    });

    test("schemaCompareOpenScmp reducer - called once", async () => {
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

        await controller["_reducers"]["schemaCompareOpenScmp"](
            mockInitialState,
            payload,
        );

        assert.ok(
            publishProjectChangesStub.calledOnce,
            "schemaCompareOpenScmp should be called once",
        );
    });

    test("schemaCompareSaveScmp reducer - called once", async () => {
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

        await controller["_reducers"]["schemaCompareSaveScmp"](
            mockInitialState,
            payload,
        );

        assert.ok(
            publishProjectChangesStub.calledOnce,
            "schemaCompareSaveScmp should be called once",
        );
    });

    test("schemaCompareCancel reducer - called once", async () => {
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

        await controller["_reducers"]["schemaCompareCancel"](
            mockInitialState,
            payload,
        );

        assert.ok(
            publishProjectChangesStub.calledOnce,
            "schemaCompareCancel should be called once",
        );
    });
});
