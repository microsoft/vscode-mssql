/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as sinon from "sinon";
import sinonChai from "sinon-chai";
import { expect } from "chai";
import * as chai from "chai";
import { IServerInfo, MetadataType, ObjectMetadata } from "vscode-mssql";
import ConnectionManager from "../../src/controllers/connectionManager";
import SqlToolsServiceClient from "../../src/languageservice/serviceclient";
import {
    IScriptingResult,
    ScriptingRequest,
    ScriptOperation,
} from "../../src/models/contracts/scripting/scriptingRequest";
import { TreeNodeInfo } from "../../src/objectExplorer/nodes/treeNodeInfo";
import { ScriptingService } from "../../src/scripting/scriptingService";
import { initializeIconUtils } from "./utils";

chai.use(sinonChai);

suite("Scripting Service Tests", () => {
    let sandbox: sinon.SinonSandbox;
    let connectionManager: sinon.SinonStubbedInstance<ConnectionManager>;
    let client: sinon.SinonStubbedInstance<SqlToolsServiceClient>;
    let scriptingService: ScriptingService;

    const mockScriptResult: IScriptingResult = {
        operationId: undefined,
        script: "test_script",
    };

    const serverInfo: IServerInfo = {
        engineEditionId: 2,
        serverMajorVersion: 1,
        isCloud: true,
        serverMinorVersion: 0,
        serverReleaseVersion: 0,
        serverVersion: "",
        serverLevel: "",
        serverEdition: "",
        azureVersion: 0,
        osVersion: "",
    };

    setup(() => {
        sandbox = sinon.createSandbox();
        initializeIconUtils();

        connectionManager = sandbox.createStubInstance(ConnectionManager);
        client = sandbox.createStubInstance(SqlToolsServiceClient);

        // Wire scripting service dependencies
        connectionManager.client = client;
        connectionManager.getServerInfo.callsFake(() => serverInfo);
        client.onNotification.callsFake(() => undefined);
        client.sendRequest
            .withArgs(ScriptingRequest.type, sinon.match.any)
            .resolves(mockScriptResult);
    });

    teardown(() => {
        sandbox.restore();
    });

    function getTableNode(): TreeNodeInfo {
        const metadata: ObjectMetadata = {
            metadataType: MetadataType.Table,
            metadataTypeName: "Table",
            urn: undefined,
            schema: "dbo",
            name: "test_table",
        };
        return new TreeNodeInfo(
            "test_table (System Versioned)",
            undefined,
            undefined,
            undefined,
            undefined,
            "Table",
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            metadata,
        );
    }

    function getSprocNode(): TreeNodeInfo {
        const metadata: ObjectMetadata = {
            metadataType: MetadataType.SProc,
            metadataTypeName: "StoredProcedure",
            urn: undefined,
            schema: "dbo",
            name: "test_sproc",
        };
        return new TreeNodeInfo(
            "test_sproc",
            undefined,
            undefined,
            undefined,
            undefined,
            "StoredProcedure",
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            metadata,
        );
    }

    test("Test Get Object From Node function", () => {
        const testNode = getTableNode();
        scriptingService = new ScriptingService(connectionManager);
        const scriptingObject = scriptingService.getObjectFromNode(testNode);

        expect(scriptingObject).to.include({
            type: "Table",
            schema: "dbo",
            name: "test_table",
        });
    });

    test("Test Create Scripting Params", () => {
        const testNode = getTableNode();
        scriptingService = new ScriptingService(connectionManager);

        const scriptingParams = scriptingService.createScriptingParamsFromNode(
            testNode,
            "test_uri",
            ScriptOperation.Select,
        );
        const scriptingObject = scriptingService.getObjectFromNode(testNode);

        expect(scriptingParams).to.not.be.undefined;
        expect(scriptingParams.scriptDestination).to.equal("ToEditor");
        expect(scriptingParams.scriptingObjects[0]).to.include(scriptingObject);
    });

    test("Test Script Select function", async () => {
        const testNode = getTableNode();
        scriptingService = new ScriptingService(connectionManager);

        const script = await scriptingService.scriptTreeNode(
            testNode,
            "test_uri",
            ScriptOperation.Select,
        );

        expect(script).to.equal("test_script");
    });

    test("Test Script Create function", async () => {
        const testNode = getTableNode();
        scriptingService = new ScriptingService(connectionManager);

        const script = await scriptingService.scriptTreeNode(
            testNode,
            "test_uri",
            ScriptOperation.Create,
        );

        expect(script).to.equal("test_script");
    });

    test("Test Script Execute function", async () => {
        const testNode = getSprocNode();
        scriptingService = new ScriptingService(connectionManager);

        const script = await scriptingService.scriptTreeNode(
            testNode,
            "test_uri",
            ScriptOperation.Execute,
        );

        expect(script).to.equal("test_script");
    });

    test("Test Script Drop function", async () => {
        const testNode = getTableNode();
        scriptingService = new ScriptingService(connectionManager);

        const script = await scriptingService.scriptTreeNode(
            testNode,
            "test_uri",
            ScriptOperation.Delete,
        );

        expect(script).to.equal("test_script");
    });

    test("Test Script Alter function", async () => {
        const testNode = getSprocNode();
        scriptingService = new ScriptingService(connectionManager);

        const script = await scriptingService.scriptTreeNode(
            testNode,
            "test_uri",
            ScriptOperation.Alter,
        );

        expect(script).to.equal("test_script");
    });
});
