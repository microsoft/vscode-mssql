/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { assert } from "chai";
import * as TypeMoq from "typemoq";
import { IServerInfo, MetadataType, ObjectMetadata } from "vscode-mssql";
import ConnectionManager from "../../src/extension/controllers/connectionManager";
import SqlToolsServiceClient from "../../src/extension/languageservice/serviceclient";
import {
    IScriptingObject,
    IScriptingResult,
    ScriptingRequest,
    ScriptOperation,
} from "../../src/extension/models/contracts/scripting/scriptingRequest";
import { TreeNodeInfo } from "../../src/extension/objectExplorer/nodes/treeNodeInfo";
import { ScriptingService } from "../../src/extension/scripting/scriptingService";
import { TestExtensionContext } from "./stubs";

suite("Scripting Service Tests", () => {
    let scriptingService: ScriptingService;
    let connectionManager: TypeMoq.IMock<ConnectionManager>;
    let client: TypeMoq.IMock<SqlToolsServiceClient>;

    setup(() => {
        connectionManager = TypeMoq.Mock.ofType(
            ConnectionManager,
            TypeMoq.MockBehavior.Loose,
            TestExtensionContext.object,
        );
        connectionManager.setup((c) => c.client).returns(() => client.object);
        client = TypeMoq.Mock.ofType(SqlToolsServiceClient, TypeMoq.MockBehavior.Loose);
        const mockScriptResult: IScriptingResult = {
            operationId: undefined,
            script: "test_script",
        };
        client
            .setup((c) => c.sendRequest(ScriptingRequest.type, TypeMoq.It.isAny()))
            .returns(() => Promise.resolve(mockScriptResult));
        connectionManager.object.client = client.object;
        connectionManager
            .setup((c) => c.getServerInfo(TypeMoq.It.isAny()))
            .returns(() => {
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
                return serverInfo;
            });
    });

    test("Test Get Object From Node function", () => {
        const testNodeMetadata: ObjectMetadata = {
            metadataType: MetadataType.Table,
            metadataTypeName: "Table",
            urn: undefined,
            schema: "dbo",
            name: "test_table",
        };
        const testNode = new TreeNodeInfo(
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
            testNodeMetadata,
        );
        scriptingService = new ScriptingService(connectionManager.object);
        const expectedScriptingObject: IScriptingObject = {
            type: testNodeMetadata.metadataTypeName,
            schema: testNodeMetadata.schema,
            name: testNodeMetadata.name,
        };
        const scriptingObject = scriptingService.getObjectFromNode(testNode);
        assert.equal(scriptingObject.name, expectedScriptingObject.name);
        assert.equal(scriptingObject.schema, expectedScriptingObject.schema);
        assert.equal(scriptingObject.type, expectedScriptingObject.type);
    });

    test("Test Create Scripting Params", () => {
        const testNodeMetadata: ObjectMetadata = {
            metadataType: MetadataType.Table,
            metadataTypeName: "Table",
            urn: undefined,
            schema: "dbo",
            name: "test_table",
        };
        const testNode = new TreeNodeInfo(
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
            testNodeMetadata,
        );
        scriptingService = new ScriptingService(connectionManager.object);
        let scriptingParams = scriptingService.createScriptingParams(
            testNode,
            "test_uri",
            ScriptOperation.Select,
        );
        const scriptingObject = scriptingService.getObjectFromNode(testNode);
        assert.notEqual(scriptingParams, undefined);
        assert.equal(scriptingParams.scriptDestination, "ToEditor");
        assert.equal(scriptingParams.scriptingObjects[0].name, scriptingObject.name);
        assert.equal(scriptingParams.scriptingObjects[0].schema, scriptingObject.schema);
        assert.equal(scriptingParams.scriptingObjects[0].type, scriptingObject.type);
        assert.equal(scriptingParams.operation, ScriptOperation.Select);
    });

    test("Test Script Select function", async () => {
        const testNodeMetadata: ObjectMetadata = {
            metadataType: MetadataType.Table,
            metadataTypeName: "Table",
            urn: undefined,
            schema: "dbo",
            name: "test_table",
        };
        const testNode = new TreeNodeInfo(
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
            testNodeMetadata,
        );
        scriptingService = new ScriptingService(connectionManager.object);
        const script = await scriptingService.script(testNode, "test_uri", ScriptOperation.Select);
        assert.notEqual(script, undefined);
    });

    test("Test Script Create function", async () => {
        const testNodeMetadata: ObjectMetadata = {
            metadataType: MetadataType.Table,
            metadataTypeName: "Table",
            urn: undefined,
            schema: "dbo",
            name: "test_table",
        };
        const testNode = new TreeNodeInfo(
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
            testNodeMetadata,
        );
        scriptingService = new ScriptingService(connectionManager.object);
        const script = await scriptingService.script(testNode, "test_uri", ScriptOperation.Create);
        assert.notEqual(script, undefined);
    });

    test("Test Script Execute function", async () => {
        const testNodeMetadata: ObjectMetadata = {
            metadataType: MetadataType.SProc,
            metadataTypeName: "StoredProcedure",
            urn: undefined,
            schema: "dbo",
            name: "test_proc",
        };
        const testNode = new TreeNodeInfo(
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
            testNodeMetadata,
        );
        scriptingService = new ScriptingService(connectionManager.object);
        const script = await scriptingService.script(testNode, "test_uri", ScriptOperation.Execute);
        assert.notEqual(script, undefined);
    });

    test("Test Script Drop function", async () => {
        const testNodeMetadata: ObjectMetadata = {
            metadataType: MetadataType.Table,
            metadataTypeName: "Table",
            urn: undefined,
            schema: "dbo",
            name: "test_table",
        };
        const testNode = new TreeNodeInfo(
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
            testNodeMetadata,
        );
        scriptingService = new ScriptingService(connectionManager.object);
        const script = await scriptingService.script(testNode, "test_uri", ScriptOperation.Delete);
        assert.notEqual(script, undefined);
    });

    test("Test Script Alter function", async () => {
        const testNodeMetadata: ObjectMetadata = {
            metadataType: MetadataType.SProc,
            metadataTypeName: "StoredProcedure",
            urn: undefined,
            schema: "dbo",
            name: "test_sproc",
        };
        const testNode = new TreeNodeInfo(
            "test_table (System Versioned)",
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
            testNodeMetadata,
        );
        scriptingService = new ScriptingService(connectionManager.object);
        const script = await scriptingService.script(testNode, "test_uri", ScriptOperation.Alter);
        assert.notEqual(script, undefined);
    });
});
