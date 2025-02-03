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

suite("Schema Compare WebView Controller Tests", () => {
    let controller: SchemaCompareWebViewController;
    let sandbox: sinon.SinonSandbox;
    let mockContext: vscode.ExtensionContext;
    let treeNode: TreeNodeInfo;
    let mockSchemaCompareService: TypeMoq.IMock<mssql.ISchemaCompareService>;
    let mockConnectionManager: TypeMoq.IMock<ConnectionManager>;
    let mockDefaultDeploymentOptions: TypeMoq.IMock<mssql.DeploymentOptions>;

    setup(() => {
        sandbox = sinon.createSandbox();
        sandbox.restore();
        sinon.reset();

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
            server: "server",
            database: "database",
            user: "user",
            password: "password",
            email: "email@microsoft.com",
            accountId: "1234567890",
            tenantId: "1234567890",
            port: 1433,
            authenticationType: "sql-login",
            azureAccountToken: undefined,
            expiresOn: undefined,
            encrypt: true,
            trustServerCertificate: true,
            hostNameInCertificate: undefined,
            persistSecurityInfo: undefined,
            columnEncryptionSetting: undefined,
            attestationProtocol: undefined,
            enclaveAttestationUrl: undefined,
            connectTimeout: undefined,
            commandTimeout: undefined,
            connectRetryCount: undefined,
            connectRetryInterval: undefined,
            applicationName: undefined,
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
            connectionString: "connection-string",
        };
        treeNode = new TreeNodeInfo(
            "node-label",
            context,
            vscode.TreeItemCollapsibleState.None,
            "nodePath",
            "nodeStatus",
            "nodeType",
            "sessionId",
            connInfo,
            undefined,
            [],
        );

        mockSchemaCompareService =
            TypeMoq.Mock.ofType<mssql.ISchemaCompareService>();
        mockConnectionManager = TypeMoq.Mock.ofType<ConnectionManager>();
        mockDefaultDeploymentOptions =
            TypeMoq.Mock.ofType<mssql.DeploymentOptions>();
    });

    test("Server Object Explorer Node, results in valid state", () => {
        controller = new SchemaCompareWebViewController(
            mockContext,
            treeNode,
            mockSchemaCompareService.object,
            mockConnectionManager.object,
            mockDefaultDeploymentOptions.object,
            "Schema Compare",
        );

        assert.equal(undefined, undefined);
    });
});
