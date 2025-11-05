/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as sinon from "sinon";
import sinonChai from "sinon-chai";
import { expect } from "chai";
import * as chai from "chai";
import * as vscode from "vscode";
import { IServerInfo, MetadataType, ObjectMetadata, IScriptingObject } from "vscode-mssql";
import ConnectionManager from "../../src/controllers/connectionManager";
import SqlDocumentService, { ConnectionStrategy } from "../../src/controllers/sqlDocumentService";
import VscodeWrapper from "../../src/controllers/vscodeWrapper";
import SqlToolsServiceClient from "../../src/languageservice/serviceclient";
import { SqlOutputContentProvider } from "../../src/models/sqlOutputContentProvider";
import StatusView from "../../src/views/statusView";
import { TreeNodeInfo } from "../../src/objectExplorer/nodes/treeNodeInfo";
import { ObjectExplorerUtils } from "../../src/objectExplorer/objectExplorerUtils";
import { ScriptingService } from "../../src/scripting/scriptingService";
import {
    ScriptOperation,
    ScriptingRequest,
    ScriptingProgressNotification,
    ScriptingCompleteNotification,
    ScriptingCancelRequest,
} from "../../src/models/contracts/scripting/scriptingRequest";
import * as telemetry from "../../src/telemetry/telemetry";
import * as Constants from "../../src/constants/constants";
import * as LocalizedConstants from "../../src/constants/locConstants";
import { ActivityObject, ActivityStatus } from "../../src/sharedInterfaces/telemetry";
import { Logger } from "../../src/models/logger";
import { getMockContext, initializeIconUtils, stubVscodeWrapper } from "./utils";

chai.use(sinonChai);

type ProgressHandler = (params: any) => void;

type CommandMap = Record<string, (...args: unknown[]) => unknown>;

export const TEST_DB_NAME = "test_db";
export const NODE_URI = "node_uri";
export const TEST_DOCUMENT = {
    document: { uri: vscode.Uri.parse("file:///test.sql") },
} as vscode.TextEditor;

suite("Scripting Service", () => {
    let sandbox: sinon.SinonSandbox;
    let connectionManager: sinon.SinonStubbedInstance<ConnectionManager>;
    let client: sinon.SinonStubbedInstance<SqlToolsServiceClient>;
    let sqlDocumentService: sinon.SinonStubbedInstance<SqlDocumentService>;
    let sqlOutputContentProvider: sinon.SinonStubbedInstance<SqlOutputContentProvider>;
    let vscodeWrapper: sinon.SinonStubbedInstance<VscodeWrapper>;
    let statusView: StatusView;
    let scriptingService: ScriptingService;
    let withProgressStub: sinon.SinonStub;
    let showErrorMessageStub: sinon.SinonStub;
    let showInformationMessageStub: sinon.SinonStub;
    let configurationGetStub: sinon.SinonStub;
    let registerCommandStub: sinon.SinonStub;
    let sendRequestStub: sinon.SinonStub;
    let loggerStub: { error: sinon.SinonStub; verbose: sinon.SinonStub };
    let objectExplorerTree: { selection: TreeNodeInfo[] };
    let scriptingProgressHandler: ProgressHandler | undefined;
    let scriptingCompleteHandler: ProgressHandler | undefined;
    let registeredCommands: CommandMap;
    let telemetryActivities: ActivityObject[];
    let cancellationCallback: ((e: unknown) => void) | undefined;
    let removeRecentlyUsedStub: sinon.SinonStub;

    function configureRunQueryStub(): void {
        sqlOutputContentProvider.runQuery.callsFake(
            async (_statusView, _uri, _options, _title, _something, queryPromise) => {
                if (queryPromise && typeof (queryPromise as any).resolve === "function") {
                    (queryPromise as any).resolve(true);
                }
                return undefined;
            },
        );
    }

    const serverInfo: IServerInfo = {
        engineEditionId: 2,
        serverMajorVersion: 16,
        serverMinorVersion: 0,
        serverReleaseVersion: 0,
        serverLevel: "",
        serverEdition: "",
        azureVersion: 0,
        isCloud: true,
        osVersion: "",
        serverVersion: "16.0.0",
    };

    function createTableNode(): TreeNodeInfo {
        const metadata: ObjectMetadata = {
            metadataType: MetadataType.Table,
            metadataTypeName: "Table",
            urn: undefined,
            schema: "dbo",
            name: "test_table",
        };
        return new TreeNodeInfo(
            "dbo.test_table",
            undefined,
            undefined,
            "node-path",
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

    function createSprocNode(): TreeNodeInfo {
        const metadata: ObjectMetadata = {
            metadataType: MetadataType.SProc,
            metadataTypeName: "StoredProcedure",
            urn: undefined,
            schema: "dbo",
            name: "test_sproc",
        };
        return new TreeNodeInfo(
            "dbo.test_sproc",
            undefined,
            undefined,
            "sproc-node-path",
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

    function applyConnectionProfile(node: TreeNodeInfo, database: string = "master"): void {
        node.updateConnectionProfile({
            id: "connection-id",
            server: "test-server",
            database,
        } as any);
    }

    suiteSetup(() => {
        sandbox = sinon.createSandbox();
        initializeIconUtils();
        telemetryActivities = [];
        registeredCommands = {};

        withProgressStub = sandbox
            .stub(vscode.window, "withProgress")
            .callsFake(async (_options, task) => {
                const progress = {
                    report: sandbox.stub(),
                } as vscode.Progress<{ message?: string; increment?: number }>;

                const token: vscode.CancellationToken = {
                    isCancellationRequested: false,
                    onCancellationRequested: (callback: (e: unknown) => void) => {
                        cancellationCallback = callback;
                        return { dispose: () => undefined } as vscode.Disposable;
                    },
                } as vscode.CancellationToken;

                return await task(progress, token);
            });

        showErrorMessageStub = sandbox.stub(vscode.window, "showErrorMessage").resolves(undefined);
        showInformationMessageStub = sandbox
            .stub(vscode.window, "showInformationMessage")
            .resolves(undefined);

        configurationGetStub = sandbox.stub().returns(false);
        sandbox
            .stub(vscode.workspace, "getConfiguration")
            .returns({ get: configurationGetStub } as unknown as vscode.WorkspaceConfiguration);

        registerCommandStub = sandbox
            .stub(vscode.commands, "registerCommand")
            .callsFake(
                (
                    commandId: string,
                    callback: (...args: unknown[]) => unknown,
                    thisArg?: unknown,
                ) => {
                    registeredCommands[commandId] = thisArg ? callback.bind(thisArg) : callback;
                    return { dispose: () => undefined } as vscode.Disposable;
                },
            );

        sandbox.stub(ObjectExplorerUtils, "getNodeUri").returns(NODE_URI);
        sandbox.stub(ObjectExplorerUtils, "getDatabaseName").returns(TEST_DB_NAME);

        sandbox.stub(telemetry, "startActivity").callsFake(() => {
            const activity: ActivityObject = {
                correlationId: "test-correlation",
                startTime: Date.now(),
                update: sandbox.stub(),
                end: sandbox.stub(),
                endFailed: sandbox.stub(),
            };
            telemetryActivities.push(activity);
            return activity;
        });

        loggerStub = {
            error: sandbox.stub(),
            verbose: sandbox.stub(),
        };
        sandbox.stub(Logger, "create").returns(loggerStub as unknown as Logger);

        connectionManager = sandbox.createStubInstance(ConnectionManager);
        client = sandbox.createStubInstance(SqlToolsServiceClient);
        connectionManager.client = client;

        sqlDocumentService = sandbox.createStubInstance(SqlDocumentService);
        sqlDocumentService.newQuery.resolves(TEST_DOCUMENT);

        sqlOutputContentProvider = sandbox.createStubInstance(SqlOutputContentProvider);

        configureRunQueryStub();

        statusView = {} as StatusView;
        vscodeWrapper = stubVscodeWrapper(sandbox);
        objectExplorerTree = { selection: [] };

        sendRequestStub = client.sendRequest;
        sendRequestStub.resolves({ operationId: "operation-id" });

        client.onNotification.callsFake((type, handler) => {
            if (type === ScriptingProgressNotification.type) {
                scriptingProgressHandler = handler;
            } else if (type === ScriptingCompleteNotification.type) {
                scriptingCompleteHandler = handler;
            }
            return undefined;
        });

        removeRecentlyUsedStub = sandbox.stub().resolves();
        connectionManager.connectionStore = {
            removeRecentlyUsed: removeRecentlyUsedStub,
        } as any;

        connectionManager.getServerInfo.callsFake(() => serverInfo);
        connectionManager.isConnected.returns(true);
        connectionManager.isConnecting.returns(false);
        connectionManager.connect.resolves(true);

        scriptingService = new ScriptingService(
            getMockContext(),
            vscodeWrapper,
            connectionManager,
            sqlDocumentService as unknown as SqlDocumentService,
            sqlOutputContentProvider as unknown as SqlOutputContentProvider,
            statusView,
            objectExplorerTree as unknown as vscode.TreeView<TreeNodeInfo>,
        );
    });

    teardown(() => {
        sandbox.resetHistory();
        telemetryActivities.length = 0;
        cancellationCallback = undefined;
        configurationGetStub.returns(false);
        connectionManager.isConnected.returns(true);
        connectionManager.isConnecting.returns(false);
        connectionManager.connect.resolves(true);
        sendRequestStub.resetBehavior();
        sendRequestStub.resolves({ operationId: "operation-id" });
        sqlDocumentService.newQuery.resolves(TEST_DOCUMENT);
        sqlOutputContentProvider.runQuery.resetBehavior();
        configureRunQueryStub();
        objectExplorerTree.selection = [];
    });

    suiteTeardown(() => {
        sandbox.restore();
    });

    test("registers scripting commands", () => {
        const commandArrays = [
            Constants.cmdScriptSelect,
            Constants.cmdScriptCreate,
            Constants.cmdScriptDelete,
            Constants.cmdScriptExecute,
            Constants.cmdScriptAlter,
        ];
        expect(registerCommandStub).to.have.callCount(commandArrays.length);
        expect(registeredCommands).to.have.keys(commandArrays);
    });

    test("scriptNode connects and auto executes select scripts when allowed", async () => {
        const node = createTableNode();
        applyConnectionProfile(node);
        const updateTokenStub = sandbox.stub(node, "updateEntraTokenInfo");

        connectionManager.isConnected.returns(false);
        connectionManager.connect.resolves(true);

        const scriptTreeStub = sandbox
            .stub(scriptingService as any, "scriptTreeNode")
            .resolves("SELECT 1");

        try {
            await scriptingService.scriptNode(node, ScriptOperation.Select);

            expect(connectionManager.connect).to.have.been.calledOnceWithExactly(
                NODE_URI,
                sinon.match.has("database", TEST_DB_NAME),
            );
            expect(sqlDocumentService.newQuery).to.have.been.calledOnce;
            const newQueryArgs = sqlDocumentService.newQuery.getCall(0).args[0];
            expect(newQueryArgs.content).to.equal("SELECT 1");
            expect(newQueryArgs.connectionStrategy).to.equal(
                ConnectionStrategy.CopyConnectionFromInfo,
            );
            expect(sqlOutputContentProvider.runQuery).to.have.been.calledOnce;
            expect(removeRecentlyUsedStub).to.have.been.calledOnce;
            expect(updateTokenStub).to.have.been.called;
            expect(loggerStub.error).to.not.have.been.called;
            expect(telemetryActivities[0].end).to.have.been.calledOnceWithExactly(
                ActivityStatus.Succeeded,
            );
        } finally {
            scriptTreeStub.restore();
        }
    });

    test("scriptNode skips auto execution when configuration prevents it", async () => {
        const node = createTableNode();
        applyConnectionProfile(node, TEST_DB_NAME);
        sandbox.stub(node, "updateEntraTokenInfo");
        configurationGetStub.returns(true);

        const scriptTreeStub = sandbox
            .stub(scriptingService as any, "scriptTreeNode")
            .resolves("SELECT 1");

        try {
            await scriptingService.scriptNode(node, ScriptOperation.Select);

            expect(connectionManager.connect).to.not.have.been.called;
            expect(sqlDocumentService.newQuery).to.have.been.calledOnce;
            expect(sqlOutputContentProvider.runQuery).to.not.have.been.called;
            expect(removeRecentlyUsedStub).to.not.have.been.called;
            expect(telemetryActivities[0].end).to.have.been.calledOnce;
        } finally {
            scriptTreeStub.restore();
        }
    });

    test("scriptNode handles connection failures gracefully", async () => {
        const node = createTableNode();
        applyConnectionProfile(node);
        sandbox.stub(node, "updateEntraTokenInfo");

        connectionManager.isConnected.returns(false);
        connectionManager.isConnecting.returns(false);
        connectionManager.connect.resolves(false);

        const scriptTreeStub = sandbox
            .stub(scriptingService as any, "scriptTreeNode")
            .resolves("SELECT 1");

        try {
            await scriptingService.scriptNode(node, ScriptOperation.Select);

            expect(connectionManager.connect).to.have.been.calledOnce;
            expect(sqlDocumentService.newQuery).to.not.have.been.called;
            expect(sqlOutputContentProvider.runQuery).to.not.have.been.called;
            expect(loggerStub.error).to.have.been.calledOnce;
            expect(telemetryActivities[0].endFailed).to.have.been.calledOnce;
        } finally {
            scriptTreeStub.restore();
        }
    });

    test("scriptNode logs error when scripting object is missing", async () => {
        const node = new TreeNodeInfo(
            "invalid",
            undefined,
            undefined,
            "node-path",
            undefined,
            "Table",
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
        );
        applyConnectionProfile(node);
        sandbox.stub(node, "updateEntraTokenInfo");

        await scriptingService.scriptNode(node, ScriptOperation.Select);

        expect(sqlDocumentService.newQuery).to.not.have.been.called;
        expect(loggerStub.error).to.have.been.calledOnce;
        expect(telemetryActivities[0].endFailed).to.have.been.calledOnce;
    });

    test("scriptNode logs error when no script is returned", async () => {
        const node = createTableNode();
        applyConnectionProfile(node);
        sandbox.stub(node, "updateEntraTokenInfo");

        const scriptTreeStub = sandbox
            .stub(scriptingService as any, "scriptTreeNode")
            .resolves(undefined);

        await scriptingService.scriptNode(node, ScriptOperation.Select);

        expect(sqlDocumentService.newQuery).to.not.have.been.called;
        expect(sqlOutputContentProvider.runQuery).to.not.have.been.called;
        expect(loggerStub.error).to.have.been.calledOnce;
        expect(telemetryActivities[0].endFailed).to.have.been.calledOnce;
        scriptTreeStub.restore();
    });

    test("scriptTreeNode forwards scripting params to script", async () => {
        const node = createTableNode();
        applyConnectionProfile(node);

        const scriptStub = sandbox.stub(scriptingService, "script").resolves("SELECT 1");
        const result = await (scriptingService as any).scriptTreeNode(
            node,
            "owner-uri",
            ScriptOperation.Select,
        );

        expect(connectionManager.getServerInfo).to.have.been.calledOnce;
        expect(scriptStub).to.have.been.calledOnce;
        expect(result).to.equal("SELECT 1");
        scriptStub.restore();
    });

    test("createScriptingRequestParams honors engine settings", () => {
        const scriptingObject: IScriptingObject = {
            type: "Table",
            schema: "dbo",
            name: "test_table",
            parentName: undefined,
            parentTypeName: undefined,
        };

        const params = scriptingService.createScriptingRequestParams(
            serverInfo,
            scriptingObject,
            "owner-uri",
            ScriptOperation.Select,
        );

        expect(params.scriptDestination).to.equal("ToEditor");
        expect(params.scriptOptions.targetDatabaseEngineType).to.equal("SqlAzure");
        expect(params.scriptOptions.scriptCreateDrop).to.equal("ScriptSelect");
        expect(params.scriptOptions.scriptCompatibilityOption).to.equal("Script160Compat");
        expect(params.scriptingObjects[0]).to.include(scriptingObject);
    });

    test("createScriptingRequestParams maps delete operation", () => {
        const scriptingObject: IScriptingObject = {
            type: "Table",
            schema: "dbo",
            name: "test_table",
            parentName: undefined,
            parentTypeName: undefined,
        };

        const params = scriptingService.createScriptingRequestParams(
            { ...serverInfo, isCloud: false },
            scriptingObject,
            "owner-uri",
            ScriptOperation.Delete,
        );

        expect(params.scriptOptions.scriptCreateDrop).to.equal("ScriptDrop");
        expect(params.scriptOptions.targetDatabaseEngineType).to.equal("SingleInstance");
    });

    test("target database engine edition falls back when mapping missing", () => {
        const scriptingObject: IScriptingObject = {
            type: "Table",
            schema: "dbo",
            name: "test_table",
            parentName: undefined,
            parentTypeName: undefined,
        };

        const params = scriptingService.createScriptingRequestParams(
            { ...serverInfo, engineEditionId: undefined },
            scriptingObject,
            "owner-uri",
            ScriptOperation.Create,
        );

        expect(params.scriptOptions.targetDatabaseEngineEdition).to.equal(
            "SqlServerEnterpriseEdition",
        );
        expect(params.scriptOptions.scriptCreateDrop).to.equal("ScriptCreate");
    });

    test("getScriptCompatibility handles known versions", () => {
        expect(ScriptingService.getScriptCompatibility(15, 0)).to.equal("Script150Compat");
        expect(ScriptingService.getScriptCompatibility(10, 50)).to.equal("Script105Compat");
        expect(ScriptingService.getScriptCompatibility(999, 0)).to.equal("Script140Compat");
    });

    test("script resolves when completion notification received", async () => {
        const scriptingObject: IScriptingObject = {
            type: "Table",
            schema: "dbo",
            name: "test_table",
            parentName: undefined,
            parentTypeName: undefined,
        };
        const params = scriptingService.createScriptingRequestParams(
            serverInfo,
            scriptingObject,
            "owner-uri",
            ScriptOperation.Select,
        );

        sendRequestStub.resetBehavior();
        sendRequestStub.callsFake(async (type) => {
            if (type === ScriptingRequest.type) {
                return { operationId: "op-success" };
            }
            return undefined;
        });

        const scriptPromise = scriptingService.script(params);
        expect(scriptingCompleteHandler).to.be.a("function");

        await Promise.resolve();

        scriptingCompleteHandler!({
            operationId: "op-success",
            script: "SELECT 1",
            errorMessage: undefined,
            errorDetails: undefined,
        });

        const script = await scriptPromise;

        expect(script).to.equal("SELECT 1");
        expect(withProgressStub).to.have.been.calledOnce;
        expect(telemetryActivities[0].end).to.have.been.calledOnceWithExactly(
            ActivityStatus.Succeeded,
        );
    });

    test("script surfaces errors from progress notifications", async () => {
        const scriptingObject: IScriptingObject = {
            type: "Table",
            schema: "dbo",
            name: "test_table",
            parentName: undefined,
            parentTypeName: undefined,
        };
        const params = scriptingService.createScriptingRequestParams(
            serverInfo,
            scriptingObject,
            "owner-uri",
            ScriptOperation.Select,
        );

        sendRequestStub.resetBehavior();
        sendRequestStub.callsFake(async (type) => {
            if (type === ScriptingRequest.type) {
                return { operationId: "op-error" };
            }
            return undefined;
        });

        const scriptPromise = scriptingService.script(params);
        expect(scriptingProgressHandler).to.be.a("function");

        await Promise.resolve();

        scriptingProgressHandler!({
            operationId: "op-error",
            errorMessage: "script failed",
            errorDetails: "detail",
        });

        let error: unknown;
        try {
            await scriptPromise;
        } catch (e) {
            error = e;
        }

        expect((error as Error).message).to.equal("script failed");
        expect(showErrorMessageStub).to.have.been.calledWithExactly(
            LocalizedConstants.msgScriptingOperationFailed("script failed"),
        );
        expect(loggerStub.error).to.have.been.calledWithMatch("Scripting error details:");
        expect(telemetryActivities[0].endFailed).to.have.been.calledOnce;
    });

    test("script sends cancellation request when token is cancelled", async () => {
        const scriptingObject: IScriptingObject = {
            type: "Table",
            schema: "dbo",
            name: "test_table",
            parentName: undefined,
            parentTypeName: undefined,
        };
        const params = scriptingService.createScriptingRequestParams(
            serverInfo,
            scriptingObject,
            "owner-uri",
            ScriptOperation.Select,
        );

        sendRequestStub.resetBehavior();
        const cancellationCalls: unknown[] = [];
        sendRequestStub.callsFake(async (type, payload) => {
            if (type === ScriptingRequest.type) {
                return { operationId: "op-cancel" };
            }
            if (type === ScriptingCancelRequest.type) {
                cancellationCalls.push(payload);
            }
            return undefined;
        });

        const scriptPromise = scriptingService.script(params);

        await Promise.resolve();
        cancellationCallback?.(undefined);

        const result = await scriptPromise;

        expect(result).to.be.undefined;
        expect(cancellationCalls).to.have.lengthOf(1);
        expect((cancellationCalls[0] as { operationId: string }).operationId).to.equal("op-cancel");
        expect(showErrorMessageStub).to.not.have.been.called;
    });

    test("scriptNode commands use tree selection when node not provided", async () => {
        const createCommand = registeredCommands[Constants.cmdScriptCreate];
        const node = createTableNode();
        applyConnectionProfile(node);
        objectExplorerTree.selection = [node];
        const scriptNodeStub = sandbox.stub(scriptingService, "scriptNode").resolves();

        try {
            await createCommand(undefined);
            expect(scriptNodeStub).to.have.been.calledOnceWithExactly(node, ScriptOperation.Create);
        } finally {
            scriptNodeStub.restore();
        }
    });

    test("command shows information message when no node selection", async () => {
        const createCommand = registeredCommands[Constants.cmdScriptCreate];
        const scriptNodeStub = sandbox.stub(scriptingService, "scriptNode").resolves();

        try {
            await createCommand(undefined);
            expect(scriptNodeStub).to.not.have.been.called;
            expect(showInformationMessageStub).to.have.been.calledWithExactly(
                LocalizedConstants.msgSelectNodeToScript,
            );
        } finally {
            scriptNodeStub.restore();
        }
    });

    test("command shows information message when multiple nodes selected", async () => {
        const createCommand = registeredCommands[Constants.cmdScriptCreate];
        const nodeA = createTableNode();
        const nodeB = createSprocNode();
        objectExplorerTree.selection = [nodeA, nodeB];
        const scriptNodeStub = sandbox.stub(scriptingService, "scriptNode").resolves();

        try {
            await createCommand(undefined);
            expect(scriptNodeStub).to.not.have.been.called;
            expect(showInformationMessageStub).to.have.been.calledWithExactly(
                LocalizedConstants.msgSelectSingleNodeToScript,
            );
        } finally {
            scriptNodeStub.restore();
        }
    });

    test("scriptNode maps operations for other commands", async () => {
        const deleteCommand = registeredCommands[Constants.cmdScriptDelete];
        const alterCommand = registeredCommands[Constants.cmdScriptAlter];
        const executeCommand = registeredCommands[Constants.cmdScriptExecute];

        const node = createTableNode();
        applyConnectionProfile(node);
        objectExplorerTree.selection = [node];

        const scriptNodeStub = sandbox.stub(scriptingService, "scriptNode").resolves();

        try {
            await deleteCommand(node);
            await alterCommand(createSprocNode());
            await executeCommand(createSprocNode());

            expect(scriptNodeStub).to.have.been.calledThrice;
            expect(scriptNodeStub.getCall(0).args[1]).to.equal(ScriptOperation.Delete);
            expect(scriptNodeStub.getCall(1).args[1]).to.equal(ScriptOperation.Alter);
            expect(scriptNodeStub.getCall(2).args[1]).to.equal(ScriptOperation.Execute);
        } finally {
            scriptNodeStub.restore();
        }
    });
});
