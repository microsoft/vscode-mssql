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

suite("Schema Compare WebView Controller Tests", () => {
    let controller: SchemaCompareWebViewController;
    let sandbox: sinon.SinonSandbox;
    let mockContext: vscode.ExtensionContext;
    let treeNode: TreeNodeInfo;
    let mockSchemaCompareService: TypeMoq.IMock<mssql.ISchemaCompareService>;
    let mockConnectionManager: TypeMoq.IMock<ConnectionManager>;
    let mockInitialState: SchemaCompareWebViewState;
    const schemaCompareWebViewTitle: string = "Schema Compare";

    setup(() => {
        sandbox = sinon.createSandbox();
        sandbox.restore();
        sinon.reset();

        let defaultDeploymentOptions: mssql.DeploymentOptions = {
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
            defaultDeploymentOptions: defaultDeploymentOptions,
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
            defaultDeploymentOptions,
            schemaCompareWebViewTitle,
        );
    });

    teardown(() => {
        sandbox.restore();
    });

    test("SchemaCompareWebViewController should initialize with correct state", () => {
        assert.deepStrictEqual(
            controller.state,
            mockInitialState,
            "Initial state should match",
        );
    });

    test("SchemaCompareWebViewController should initialize with Schema Compare title", () => {
        assert.deepStrictEqual(
            controller.panel.title,
            schemaCompareWebViewTitle,
            "Webview Title should match",
        );
    });
});
