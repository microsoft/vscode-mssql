/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as chai from "chai";
import { expect } from "chai";
import sinonChai from "sinon-chai";
import * as sinon from "sinon";
import * as vscode from "vscode";

import VscodeWrapper from "../../src/controllers/vscodeWrapper";
import { FlatFileImportController } from "../../src/controllers/flatFileImportController";
import { ApiStatus } from "../../src/sharedInterfaces/webview";
import * as Loc from "../../src/constants/locConstants";
import { FlatFileProvider } from "../../src/models/contracts/flatFile";
import SqlToolsServiceClient from "../../src/languageservice/serviceclient";
import ConnectionManager from "../../src/controllers/connectionManager";
import { ConnectionNode } from "../../src/objectExplorer/nodes/connectionNode";
import { defaultSchema } from "../../src/constants/constants";
import { stubTelemetry, stubVscodeWrapper } from "./utils";
import { TelemetryActions, TelemetryViews } from "../../src/sharedInterfaces/telemetry";
import * as path from "path";

chai.use(sinonChai);

suite("FlatFileImportController", () => {
    let sandbox: sinon.SinonSandbox;
    let mockContext: vscode.ExtensionContext;
    let vscodeWrapper: sinon.SinonStubbedInstance<VscodeWrapper>;
    let controller: FlatFileImportController;

    let mockClient: sinon.SinonStubbedInstance<SqlToolsServiceClient>;
    let mockConnectionManager: sinon.SinonStubbedInstance<ConnectionManager>;
    let mockProvider: FlatFileProvider;
    let mockNode: ConnectionNode;

    let sendActionEvent: sinon.SinonStub;
    let sendErrorEvent: sinon.SinonStub;

    const databases = ["db1", "db2"];

    setup(async () => {
        sandbox = sinon.createSandbox();

        mockContext = {
            extensionUri: vscode.Uri.parse("https://localhost"),
            extensionPath: "path",
        } as unknown as vscode.ExtensionContext;

        vscodeWrapper = stubVscodeWrapper(sandbox);
        ({ sendActionEvent, sendErrorEvent } = stubTelemetry(sandbox));

        mockClient = sandbox.createStubInstance(SqlToolsServiceClient);
        mockConnectionManager = sandbox.createStubInstance(ConnectionManager);

        mockProvider = {
            sendProseDiscoveryRequest: sandbox.stub(),
            sendGetColumnInfoRequest: sandbox.stub(),
            sendChangeColumnSettingsRequest: sandbox.stub(),
            sendInsertDataRequest: sandbox.stub(),
        } as FlatFileProvider;

        mockNode = {
            nodeType: "Server",
            connectionProfile: {
                server: "testServer",
                database: "db1",
                azureAccountToken: undefined,
            },
            sessionId: "sessionId",
        } as unknown as ConnectionNode;

        mockClient.sendRequest.resolves({
            rowCount: 2,
            rows: [[{ displayValue: "dbo" }], [{ displayValue: "custom" }]],
        } as any);

        controller = new FlatFileImportController(
            mockContext,
            vscodeWrapper,
            mockClient,
            mockConnectionManager,
            mockProvider,
            mockNode,
            databases,
        );
        await controller["initialize"]();
    });

    teardown(() => {
        sandbox.restore();
    });

    test("should initialize with correct state", async () => {
        expect(controller.state.serverName).to.equal("testServer");
        expect(controller.state.formState.databaseName).to.equal("db1");
        expect(controller.state.loadState).to.equal(ApiStatus.Loaded);

        const databaseComponent = controller.state.formComponents["databaseName"];
        expect(databaseComponent.options).to.deep.equal([
            { displayName: "db1", value: "db1" },
            { displayName: "db2", value: "db2" },
        ]);

        expect(sendActionEvent).to.have.been.calledWith(
            TelemetryViews.FlatFile,
            TelemetryActions.StartFlatFile,
        );
    });

    test("setFlatFileFormComponents creates components with validation", () => {
        const { formComponents } = controller.state;

        const dbComponent = formComponents["databaseName"];
        expect(dbComponent.type).to.equal("dropdown");
        let validation = dbComponent.validate(controller.state, "");
        expect(validation.isValid).to.be.false;
        expect(validation.validationMessage).to.equal(Loc.FlatFileImport.databaseRequired);

        const fileComponent = formComponents["flatFilePath"];
        validation = fileComponent.validate(controller.state, "");
        expect(validation.isValid).to.be.false;
        expect(validation.validationMessage).to.equal(Loc.FlatFileImport.importFileRequired);

        const tableComponent = formComponents["tableName"];
        validation = tableComponent.validate(controller.state, "");
        expect(validation.isValid).to.be.false;
        expect(validation.validationMessage).to.equal(Loc.FlatFileImport.tableNameRequired);

        const schemaComponent = formComponents["tableSchema"];
        validation = schemaComponent.validate(controller.state, "");
        expect(validation.isValid).to.be.false;
        expect(validation.validationMessage).to.equal(Loc.FlatFileImport.schemaRequired);

        const activeComps = controller["getActiveFormComponents"](controller.state);
        expect(activeComps.length).to.equal(4);
    });

    test("handleLoadSchemas loads schemas successfully", async () => {
        await (controller as any)["handleLoadSchemas"]();

        expect(controller.state.schemaLoadStatus).to.equal(ApiStatus.Loaded);

        const schemaComponent = controller.state.formComponents["tableSchema"];
        expect(schemaComponent.options.map((o) => o.value)).to.include("dbo");
        expect(controller.state.formState.tableSchema).to.equal(defaultSchema);
    });

    test("handleLoadSchemas handles error", async () => {
        mockClient.sendRequest.rejects(new Error("boom"));

        await (controller as any)["handleLoadSchemas"]();

        expect(controller.state.schemaLoadStatus).to.equal(ApiStatus.Error);
        expect(controller.state.errorMessage).to.equal(Loc.FlatFileImport.fetchSchemasError);
    });

    test("formAction reducer reloads schemas when database changes", async () => {
        const loadSchemasStub = sandbox.stub(controller as any, "handleLoadSchemas");

        await (controller["_reducerHandlers"] as any).get("formAction")(controller.state, {
            event: {
                propertyName: "databaseName",
                value: "db2",
                isAction: false,
            },
        });

        expect(loadSchemasStub).to.have.been.calledOnce;
    });

    test("setColumnChanges reducer updates state", async () => {
        const columnChanges = [{ id: 1 } as any, { id: 2 } as any];
        const state = await (controller["_reducerHandlers"] as any).get("setColumnChanges")(
            controller.state,
            { columnChanges: columnChanges },
        );
        expect(state.columnChanges).to.equal(columnChanges);
    });

    test("getTablePreview reducer success", async () => {
        (mockProvider.sendProseDiscoveryRequest as sinon.SinonStub).resolves({
            columns: [],
        } as any);

        const state = await (controller["_reducerHandlers"] as any).get("getTablePreview")(
            controller.state,
            {
                filePath: "file.csv",
                tableName: "table",
                schemaName: "dbo",
            },
        );

        expect(state.tablePreviewStatus).to.equal(ApiStatus.Loaded);
    });

    test("getTablePreview reducer failure", async () => {
        (mockProvider.sendProseDiscoveryRequest as sinon.SinonStub).rejects(new Error("fail"));

        const state = await (controller["_reducerHandlers"] as any).get("getTablePreview")(
            controller.state,
            {
                filePath: "file.csv",
                tableName: "table",
                schemaName: "dbo",
            },
        );

        expect(state.tablePreviewStatus).to.equal(ApiStatus.Error);
        expect(state.errorMessage).to.equal(Loc.FlatFileImport.fetchTablePreviewError);
    });

    test("importData reducer success path", async () => {
        controller.state.columnChanges = [{ id: 1 } as any];

        mockConnectionManager.createConnectionDetails.returns({} as any);
        mockConnectionManager.getConnectionString.resolves("connString");

        (mockProvider.sendChangeColumnSettingsRequest as sinon.SinonStub).resolves({
            result: { success: true },
        } as any);
        (mockProvider.sendInsertDataRequest as sinon.SinonStub).resolves({
            result: { success: true },
        } as any);

        const state = await (controller["_reducerHandlers"] as any).get("importData")(
            controller.state,
            {},
        );

        expect(state.importDataStatus).to.equal(ApiStatus.Loaded);
        expect(sendActionEvent).to.have.been.calledWith(
            TelemetryViews.FlatFile,
            TelemetryActions.ImportFile,
        );
    });

    test("importData reducer failure path", async () => {
        controller.state.columnChanges = [];

        mockConnectionManager.createConnectionDetails.returns({} as any);
        mockConnectionManager.getConnectionString.rejects(new Error("fail"));

        const state = await (controller["_reducerHandlers"] as any).get("importData")(
            controller.state,
            {},
        );

        expect(state.importDataStatus).to.equal(ApiStatus.Error);
        expect(state.errorMessage).to.equal(Loc.FlatFileImport.importFailed);
        expect(sendErrorEvent).to.have.been.called;
    });

    test("openVSCodeFileBrowser reducer sets flatFilePath and tableName correctly", async () => {
        // Mock VS Code file picker
        const mockFilePath = "/path/to/file.csv";
        sandbox
            .stub(vscode.window, "showOpenDialog")
            .resolves([{ fsPath: mockFilePath } as vscode.Uri]);
        sandbox.stub(path, "sep").value("/");
        
        const state = {
            ...controller.state,
            formErrors: ["flatFilePath"],
        };

        const newState = await controller["_reducerHandlers"].get("openVSCodeFileBrowser")(
            state,
            {},
        );

        // Check that the file path and table name were set
        expect(newState.formState.flatFilePath).to.equal(mockFilePath);
        expect(newState.formState.tableName).to.equal("file");

        // Check that formErrors removed flatFilePath
        expect(newState.formErrors).to.not.include("flatFilePath");
    });

    test("openVSCodeFileBrowser reducer handles cancel (no file selected)", async () => {
        // User cancels file picker
        sandbox.stub(vscode.window, "showOpenDialog").resolves(undefined);

        const state = {
            ...controller.state,
            formErrors: [],
        };

        const newState = await controller["_reducerHandlers"].get("openVSCodeFileBrowser")(
            state,
            {},
        );

        expect(newState.formState.flatFilePath).to.equal("");
        expect(newState.formState.tableName).to.equal("");
        expect(newState.formErrors).to.include("flatFilePath");
    });

    test("dispose reducer disposes controller", async () => {
        // Stub controller dispose
        const disposeStub = sandbox.stub(controller, "dispose");

        const state = { ...controller.state };

        const newState = await controller["_reducerHandlers"].get("dispose")(state, {});

        expect(disposeStub).to.have.been.calledTwice; // once from controller and once from panel
        expect(newState).to.equal(state);
    });
});
