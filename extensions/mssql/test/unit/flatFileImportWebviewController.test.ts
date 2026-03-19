/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as chai from "chai";
import { expect } from "chai";
import sinonChai from "sinon-chai";
import * as sinon from "sinon";
import * as vscode from "vscode";
import { SimpleExecuteResult } from "vscode-mssql";

import VscodeWrapper from "../../src/controllers/vscodeWrapper";
import { FlatFileImportWebviewController } from "../../src/controllers/flatFileImportWebviewController";
import { ApiStatus } from "../../src/sharedInterfaces/webview";
import * as Loc from "../../src/constants/locConstants";
import {
    ChangeColumnSettingsParams,
    ChangeColumnSettingsRequest,
    ChangeColumnSettingsResponse,
    DisposeSessionRequest,
    DisposeSessionResponse,
    InsertDataRequest,
    InsertDataResponse,
    ProseDiscoveryRequest,
    ProseDiscoveryResponse,
} from "../../src/models/contracts/flatFile";
import SqlToolsServiceClient from "../../src/languageservice/serviceclient";
import ConnectionManager from "../../src/controllers/connectionManager";
import { defaultSchema } from "../../src/constants/constants";
import { stubExtensionContext, stubTelemetry, stubVscodeWrapper } from "./utils";
import { TelemetryActions, TelemetryViews } from "../../src/sharedInterfaces/telemetry";
import * as path from "path";
import {
    FlatFileImportReducers,
    FlatFileStepType,
} from "../../src/sharedInterfaces/flatFileImport";
import { ConnectionProfile } from "../../src/models/connectionProfile";

chai.use(sinonChai);

suite("FlatFileImportWebviewController", () => {
    let sandbox: sinon.SinonSandbox;
    let mockContext: vscode.ExtensionContext;
    let vscodeWrapper: sinon.SinonStubbedInstance<VscodeWrapper>;
    let controller: FlatFileImportWebviewController;

    let mockClient: sinon.SinonStubbedInstance<SqlToolsServiceClient>;
    let mockConnectionManager: sinon.SinonStubbedInstance<ConnectionManager>;
    let mockConnectionProfile: ConnectionProfile;

    let sendActionEvent: sinon.SinonStub;
    let sendErrorEvent: sinon.SinonStub;

    const databases = ["db1", "db2"];

    function createSchemaQueryResult(schemaNames: string[]): SimpleExecuteResult {
        return {
            rowCount: schemaNames.length,
            columnInfo: [],
            rows: schemaNames.map((schemaName) => [
                {
                    displayValue: schemaName,
                    invariantCultureDisplayValue: schemaName,
                    isNull: false,
                },
            ]),
        };
    }

    function getReducer(reducerName: keyof FlatFileImportReducers) {
        const reducer = controller["_reducerHandlers"].get(reducerName);
        expect(reducer).to.not.be.undefined;
        return reducer!;
    }

    setup(async () => {
        sandbox = sinon.createSandbox();

        mockContext = stubExtensionContext(sandbox);

        vscodeWrapper = stubVscodeWrapper(sandbox);
        ({ sendActionEvent, sendErrorEvent } = stubTelemetry(sandbox));

        mockClient = sandbox.createStubInstance(SqlToolsServiceClient);
        mockConnectionManager = sandbox.createStubInstance(ConnectionManager);
        mockConnectionManager.listDatabases.resolves(databases);

        mockConnectionProfile = new ConnectionProfile();
        mockConnectionProfile.server = "testServer";
        mockConnectionProfile.database = "db1";
        mockConnectionProfile.azureAccountToken = undefined;

        mockClient.sendRequest.resolves(createSchemaQueryResult(["dbo", "custom"]));

        controller = new FlatFileImportWebviewController(
            mockContext,
            vscodeWrapper,
            mockClient,
            mockConnectionManager,
            mockConnectionProfile,
            "ownerUri",
            databases[0], // pass initial database name
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
            TelemetryActions.Initialize,
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
        await controller["handleLoadSchemas"]();

        expect(controller.state.schemaLoadStatus).to.equal(ApiStatus.Loaded);

        const schemaComponent = controller.state.formComponents["tableSchema"];
        expect(schemaComponent.options.map((o) => o.value)).to.include("dbo");
        expect(controller.state.formState.tableSchema).to.equal(defaultSchema);
    });

    test("handleLoadSchemas handles error", async () => {
        mockClient.sendRequest.rejects(new Error("boom"));

        await controller["handleLoadSchemas"]();

        expect(controller.state.schemaLoadStatus).to.equal(ApiStatus.Error);
        expect(controller.state.errorMessage).to.equal(Loc.FlatFileImport.fetchSchemasError);
    });

    test("formAction reducer reloads schemas when database changes", async () => {
        mockClient.sendRequest.resetHistory();
        mockClient.sendRequest.resolves(createSchemaQueryResult(["sales", "reporting"]));

        await getReducer("formAction")(controller.state, {
            event: {
                propertyName: "databaseName",
                value: "db2",
                isAction: false,
            },
        });

        expect(controller.state.formState.databaseName).to.equal("db2");
        expect(controller.state.formState.tableSchema).to.equal("sales");
        expect(controller.state.formComponents["tableSchema"].options).to.deep.equal([
            { displayName: "sales", value: "sales" },
            { displayName: "reporting", value: "reporting" },
        ]);
    });

    test("setColumnChanges reducer updates state", async () => {
        const columnChanges: ChangeColumnSettingsParams[] = [{ index: 0 }, { index: 1 }];
        const state = await getReducer("setColumnChanges")(controller.state, {
            columnChanges: columnChanges,
        });
        expect(state.columnChanges).to.equal(columnChanges);
    });

    test("getTablePreview reducer success", async () => {
        const operationId = controller["operationId"];
        const tablePreview: ProseDiscoveryResponse = {
            dataPreview: [],
            columnInfo: [],
        };

        mockClient.sendRequest
            .withArgs(
                ProseDiscoveryRequest.type,
                sinon.match({
                    operationId,
                    filePath: "file.csv",
                    tableName: "table",
                    schemaName: "dbo",
                }),
            )
            .resolves(tablePreview);

        const state = await getReducer("getTablePreview")(controller.state, {
            filePath: "file.csv",
            tableName: "table",
            schemaName: "dbo",
        });

        expect(state.tablePreviewStatus).to.equal(ApiStatus.Loaded);
    });

    test("getTablePreview reducer failure", async () => {
        const operationId = controller["operationId"];
        mockClient.sendRequest
            .withArgs(
                ProseDiscoveryRequest.type,
                sinon.match({
                    operationId,
                    filePath: "file.csv",
                    tableName: "table",
                    schemaName: "dbo",
                }),
            )
            .rejects(new Error("fail"));

        const state = await getReducer("getTablePreview")(controller.state, {
            filePath: "file.csv",
            tableName: "table",
            schemaName: "dbo",
        });

        expect(state.tablePreviewStatus).to.equal(ApiStatus.Error);
        expect(state.errorMessage).to.equal(Loc.FlatFileImport.fetchTablePreviewError);
    });

    test("importData reducer success path", async () => {
        controller.state.columnChanges = [{ index: 0, newName: "col_a" }];
        const operationId = controller["operationId"];
        const changeColumnSettingsResponse: ChangeColumnSettingsResponse = {
            result: { success: true, errorMessage: "" },
        };
        const insertDataResponse: InsertDataResponse = {
            result: { success: true, errorMessage: "" },
        };

        mockClient.sendRequest
            .withArgs(
                ChangeColumnSettingsRequest.type,
                sinon.match({
                    index: 0,
                    newName: "col_a",
                    operationId,
                }),
            )
            .resolves(changeColumnSettingsResponse);
        mockClient.sendRequest
            .withArgs(
                InsertDataRequest.type,
                sinon.match({
                    operationId,
                    ownerUri: "ownerUri",
                    databaseName: "db1",
                    batchSize: 1000,
                }),
            )
            .resolves(insertDataResponse);

        const state = await getReducer("importData")(controller.state, {});

        expect(state.importDataStatus).to.equal(ApiStatus.Loaded);
        expect(sendActionEvent).to.have.been.calledWith(
            TelemetryViews.FlatFile,
            TelemetryActions.ImportFile,
        );
    });

    test("importData reducer failure path", async () => {
        controller.state.columnChanges = [];
        const operationId = controller["operationId"];

        mockClient.sendRequest
            .withArgs(
                InsertDataRequest.type,
                sinon.match({
                    operationId,
                    ownerUri: "ownerUri",
                    databaseName: "db1",
                    batchSize: 1000,
                }),
            )
            .rejects(new Error("fail"));

        const state = await getReducer("importData")(controller.state, {});

        expect(state.importDataStatus).to.equal(ApiStatus.Error);
        expect(state.errorMessage).to.equal(Loc.FlatFileImport.importFailed);
        expect(sendErrorEvent).to.have.been.called;
    });

    test("importData reducer returns existing state when already running", async () => {
        controller.state.importDataStatus = ApiStatus.Loading;

        const state = await getReducer("importData")(controller.state, {});

        expect(state).to.equal(controller.state);
        expect(state.importDataStatus).to.equal(ApiStatus.Loading);
        expect(mockClient.sendRequest).to.not.have.been.calledWith(
            ChangeColumnSettingsRequest.type,
        );
        expect(mockClient.sendRequest).to.not.have.been.calledWith(InsertDataRequest.type);
    });

    test("openVSCodeFileBrowser reducer sets flatFilePath and tableName correctly", async () => {
        // Mock VS Code file picker
        const mockFilePath = "/path/to/file.csv";
        sandbox.stub(vscode.window, "showOpenDialog").resolves([vscode.Uri.file(mockFilePath)]);
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
        const operationId = controller["operationId"];
        const disposeSessionResponse: DisposeSessionResponse = {
            result: { success: true, errorMessage: "" },
        };

        mockClient.sendRequest
            .withArgs(
                DisposeSessionRequest.type,
                sinon.match({
                    operationId,
                }),
            )
            .resolves(disposeSessionResponse);

        const state = { ...controller.state };

        const newState = await controller["_reducerHandlers"].get("dispose")(state, {});

        expect(disposeStub).to.have.been.calledOnce; // panel.dispose() triggers onDidDispose which calls dispose()
        expect(newState).to.equal(state);
    });

    test("resetState reducer handles all reset types correctly", async () => {
        const reducer = getReducer("resetState");
        const tablePreview: ProseDiscoveryResponse = {
            dataPreview: [],
            columnInfo: [],
        };

        // start with a fully-populated state
        let state = {
            ...controller.state,
            importDataStatus: ApiStatus.Loaded,
            columnChanges: [{ index: 0 }],
            tablePreviewStatus: ApiStatus.Loaded,
            tablePreview,
            formErrors: ["flatFilePath"],
            formState: {
                databaseName: "db1",
                flatFilePath: "/path/file.csv",
                tableName: "file",
                tableSchema: "custom",
            },
            currentStep: FlatFileStepType.ImportData,
        };

        // ---- ImportData branch ----
        state = await reducer(state, { resetType: FlatFileStepType.ImportData });

        expect(state.importDataStatus).to.equal(ApiStatus.NotStarted);
        expect(state.currentStep).to.equal(FlatFileStepType.ColumnChanges);

        // ---- ColumnChanges branch ----
        state.columnChanges = [{ index: 1 }]; // repopulate
        state = await reducer(state, { resetType: FlatFileStepType.ColumnChanges });

        expect(state.columnChanges).to.deep.equal([]);
        expect(state.currentStep).to.equal(FlatFileStepType.TablePreview);

        // ---- TablePreview branch ----
        state.tablePreviewStatus = ApiStatus.Loaded;
        state.tablePreview = tablePreview;

        state = await reducer(state, { resetType: FlatFileStepType.TablePreview });

        expect(state.tablePreviewStatus).to.equal(ApiStatus.Loading);
        expect(state.tablePreview).to.be.undefined;
        expect(state.currentStep).to.equal(FlatFileStepType.Form);

        // ---- default / full reset branch ----
        state.importDataStatus = ApiStatus.Loaded;
        state.columnChanges = [{ index: 2 }];
        state.tablePreviewStatus = ApiStatus.Loaded;
        state.tablePreview = tablePreview;
        state.formErrors = ["flatFilePath"];
        state.formState = {
            databaseName: "db1",
            flatFilePath: "/path/file.csv",
            tableName: "file",
            tableSchema: "custom",
        };

        state = await reducer(state, { resetType: FlatFileStepType.Form });

        expect(state.importDataStatus).to.equal(ApiStatus.NotStarted);
        expect(state.columnChanges).to.deep.equal([]);
        expect(state.tablePreviewStatus).to.equal(ApiStatus.Loading);
        expect(state.tablePreview).to.be.undefined;
        expect(state.formErrors).to.deep.equal([]);
        expect(state.formState).to.deep.equal({
            databaseName: "db1", // preserved
            flatFilePath: "",
            tableName: "",
            tableSchema: defaultSchema,
        });
        expect(state.currentStep).to.equal(FlatFileStepType.Form);
    });

    test("setStep reducer updates state", async () => {
        const step = FlatFileStepType.ColumnChanges;
        const state = await getReducer("setStep")(controller.state, { step: step });
        expect(state.currentStep).to.equal(step);
    });
});
