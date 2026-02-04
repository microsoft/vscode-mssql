/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import * as sinon from "sinon";
import { expect } from "chai";
import * as chai from "chai";
import sinonChai from "sinon-chai";
import { GlobalSearchWebViewController } from "../../src/globalSearch/globalSearchWebViewController";

chai.use(sinonChai);
import ConnectionManager from "../../src/controllers/connectionManager";
import { IMetadataService } from "../../src/services/metadataService";
import { MetadataType, ObjectMetadata } from "../../src/sharedInterfaces/metadata";
import { SearchResultItem } from "../../src/sharedInterfaces/globalSearch";
import { TreeNodeInfo } from "../../src/objectExplorer/nodes/treeNodeInfo";
import { stubTelemetry, stubVscodeWrapper } from "./utils";
import VscodeWrapper from "../../src/controllers/vscodeWrapper";
import { ScriptingService } from "../../src/scripting/scriptingService";

suite("GlobalSearchWebViewController", () => {
    let sandbox: sinon.SinonSandbox;
    let mockContext: vscode.ExtensionContext;
    let mockVscodeWrapper: VscodeWrapper;
    let mockMetadataService: sinon.SinonStubbedInstance<IMetadataService>;
    let mockConnectionManager: sinon.SinonStubbedInstance<ConnectionManager>;
    let mockTargetNode: TreeNodeInfo;
    let mockScriptingService: sinon.SinonStubbedInstance<ScriptingService>;
    let controller: GlobalSearchWebViewController;
    let mockWebview: vscode.Webview;
    let mockPanel: vscode.WebviewPanel;
    let showInformationMessageStub: sinon.SinonStub;
    let openTextDocumentStub: sinon.SinonStub;
    let showTextDocumentStub: sinon.SinonStub;
    let writeTextStub: sinon.SinonStub;

    const mockMetadata: ObjectMetadata[] = [
        {
            name: "Users",
            schema: "dbo",
            metadataType: MetadataType.Table,
            metadataTypeName: "Table",
        },
        {
            name: "Orders",
            schema: "dbo",
            metadataType: MetadataType.Table,
            metadataTypeName: "Table",
        },
        {
            name: "Products",
            schema: "sales",
            metadataType: MetadataType.Table,
            metadataTypeName: "Table",
        },
        {
            name: "vw_UserOrders",
            schema: "dbo",
            metadataType: MetadataType.View,
            metadataTypeName: "View",
        },
        {
            name: "sp_GetUsers",
            schema: "dbo",
            metadataType: MetadataType.SProc,
            metadataTypeName: "StoredProcedure",
        },
        {
            name: "fn_CalculateTotal",
            schema: "dbo",
            metadataType: MetadataType.Function,
            metadataTypeName: "UserDefinedFunction",
        },
    ];

    setup(() => {
        sandbox = sinon.createSandbox();
        stubTelemetry(sandbox);

        // Mock vscode.window methods
        showInformationMessageStub = sandbox.stub(vscode.window, "showInformationMessage");
        openTextDocumentStub = sandbox.stub(vscode.workspace, "openTextDocument");
        showTextDocumentStub = sandbox.stub(vscode.window, "showTextDocument");

        // Stub clipboard
        writeTextStub = sandbox.stub();
        sandbox.stub(vscode.env, "clipboard").value({
            writeText: writeTextStub,
        });

        // Setup mock webview and panel
        mockWebview = {
            postMessage: sandbox.stub(),
            asWebviewUri: sandbox.stub().returns(vscode.Uri.parse("file:///webview")),
            onDidReceiveMessage: sandbox.stub(),
        } as any;

        mockPanel = {
            webview: mockWebview,
            title: "Test Panel",
            viewColumn: vscode.ViewColumn.One,
            options: {},
            reveal: sandbox.stub(),
            dispose: sandbox.stub(),
            onDidDispose: sandbox.stub(),
            onDidChangeViewState: sandbox.stub(),
            iconPath: undefined,
        } as any;

        sandbox.stub(vscode.window, "createWebviewPanel").returns(mockPanel);

        // Setup mock context
        mockContext = {
            extensionUri: vscode.Uri.parse("file:///test"),
            extensionPath: "/test",
            subscriptions: [],
        } as unknown as vscode.ExtensionContext;

        // Setup mock services
        mockVscodeWrapper = stubVscodeWrapper(sandbox);

        mockMetadataService = {
            getDatabases: sandbox.stub().resolves(["master", "TestDB", "AdventureWorks"]),
            getMetadata: sandbox.stub().resolves(mockMetadata),
        } as unknown as sinon.SinonStubbedInstance<IMetadataService>;

        mockConnectionManager = {
            isConnected: sandbox.stub().returns(true),
            isConnecting: sandbox.stub().returns(false),
            connect: sandbox.stub().resolves(true),
            disconnect: sandbox.stub().resolves(),
            getConnectionInfo: sandbox.stub().resolves({
                credentials: { database: "TestDB" },
            }),
            getServerInfo: sandbox.stub().returns({ serverVersion: "15.0" }),
        } as any;

        mockTargetNode = {
            connectionProfile: {
                server: "test-server",
                database: "TestDB",
            },
        } as unknown as TreeNodeInfo;

        mockScriptingService = {
            scriptAsSelect: sandbox.stub().resolves(""),
            script: sandbox.stub().resolves("SELECT TOP (1000) * FROM [dbo].[Users]"),
            createScriptingRequestParams: sandbox.stub().returns({}),
        } as unknown as sinon.SinonStubbedInstance<ScriptingService>;
    });

    teardown(() => {
        sandbox.restore();
    });

    function createController(): GlobalSearchWebViewController {
        controller = new GlobalSearchWebViewController(
            mockContext,
            mockVscodeWrapper,
            mockMetadataService,
            mockConnectionManager,
            mockTargetNode,
            mockScriptingService,
        );
        return controller;
    }

    async function waitForInitialization(): Promise<void> {
        // Wait for async initialization to complete
        await new Promise((resolve) => setTimeout(resolve, 50));
    }

    suite("Search Reducers", () => {
        test("search reducer sets searchTerm and filters results", async () => {
            createController();
            await waitForInitialization();

            const searchReducer = controller["_reducerHandlers"].get("search");
            expect(searchReducer, "Search reducer was not registered").to.be.a("function");

            const result = await searchReducer!(controller.state, { searchTerm: "user" });

            expect(result.searchTerm).to.equal("user");
            expect(result.searchResults).to.be.an("array");
            const userResults = result.searchResults.filter(
                (r: SearchResultItem) =>
                    r.name.toLowerCase().includes("user") ||
                    r.schema.toLowerCase().includes("user"),
            );
            expect(userResults.length).to.be.greaterThan(0);
        });

        test("search reducer handles empty search term", async () => {
            createController();
            await waitForInitialization();

            const searchReducer = controller["_reducerHandlers"].get("search");
            const result = await searchReducer!(controller.state, { searchTerm: "" });

            expect(result.searchTerm).to.equal("");
            expect(result.searchResults).to.be.an("array");
        });

        test("search reducer is case-insensitive", async () => {
            createController();
            await waitForInitialization();

            const searchReducer = controller["_reducerHandlers"].get("search");
            const resultLower = await searchReducer!(controller.state, { searchTerm: "users" });
            const resultUpper = await searchReducer!(controller.state, { searchTerm: "USERS" });

            expect(resultLower.searchResults.length).to.equal(resultUpper.searchResults.length);
        });

        test("clearSearch reducer resets searchTerm", async () => {
            createController();
            await waitForInitialization();

            // First set a search term
            const searchReducer = controller["_reducerHandlers"].get("search");
            await searchReducer!(controller.state, { searchTerm: "test" });

            // Then clear it
            const clearReducer = controller["_reducerHandlers"].get("clearSearch");
            expect(clearReducer, "ClearSearch reducer was not registered").to.be.a("function");

            const result = await clearReducer!(controller.state, {});

            expect(result.searchTerm).to.equal("");
        });
    });

    suite("Filter Reducers", () => {
        test("setDatabase reducer changes selected database", async () => {
            createController();
            await waitForInitialization();

            const setDatabaseReducer = controller["_reducerHandlers"].get("setDatabase");
            expect(setDatabaseReducer, "SetDatabase reducer was not registered").to.be.a(
                "function",
            );

            const result = await setDatabaseReducer!(controller.state, {
                database: "AdventureWorks",
            });

            expect(result.selectedDatabase).to.equal("AdventureWorks");
            expect(result.searchResults).to.be.an("array");
        });

        test("setDatabase reducer does not change if same database selected", async () => {
            createController();
            await waitForInitialization();

            const setDatabaseReducer = controller["_reducerHandlers"].get("setDatabase");
            const result = await setDatabaseReducer!(controller.state, { database: "TestDB" });

            expect(result.selectedDatabase).to.equal("TestDB");
        });

        test("toggleObjectTypeFilter reducer toggles tables filter", async () => {
            createController();
            await waitForInitialization();

            const toggleReducer = controller["_reducerHandlers"].get("toggleObjectTypeFilter");
            expect(toggleReducer, "ToggleObjectTypeFilter reducer was not registered").to.be.a(
                "function",
            );

            // Initially tables should be true
            let result = await toggleReducer!(controller.state, { objectType: "tables" });
            expect(result.objectTypeFilters.tables).to.be.false;

            // Toggle again should make it true
            result = await toggleReducer!(result, { objectType: "tables" });
            expect(result.objectTypeFilters.tables).to.be.true;
        });

        test("toggleObjectTypeFilter reducer toggles views filter", async () => {
            createController();
            await waitForInitialization();

            const toggleReducer = controller["_reducerHandlers"].get("toggleObjectTypeFilter");

            let result = await toggleReducer!(controller.state, { objectType: "views" });
            expect(result.objectTypeFilters.views).to.be.false;

            result = await toggleReducer!(result, { objectType: "views" });
            expect(result.objectTypeFilters.views).to.be.true;
        });

        test("toggleObjectTypeFilter reducer toggles storedProcedures filter", async () => {
            createController();
            await waitForInitialization();

            const toggleReducer = controller["_reducerHandlers"].get("toggleObjectTypeFilter");

            let result = await toggleReducer!(controller.state, { objectType: "storedProcedures" });
            expect(result.objectTypeFilters.storedProcedures).to.be.false;

            result = await toggleReducer!(result, { objectType: "storedProcedures" });
            expect(result.objectTypeFilters.storedProcedures).to.be.true;
        });

        test("toggleObjectTypeFilter reducer toggles functions filter", async () => {
            createController();
            await waitForInitialization();

            const toggleReducer = controller["_reducerHandlers"].get("toggleObjectTypeFilter");

            let result = await toggleReducer!(controller.state, { objectType: "functions" });
            expect(result.objectTypeFilters.functions).to.be.false;

            result = await toggleReducer!(result, { objectType: "functions" });
            expect(result.objectTypeFilters.functions).to.be.true;
        });

        test("toggleObjectTypeFilter filters results accordingly", async () => {
            createController();
            await waitForInitialization();

            const toggleReducer = controller["_reducerHandlers"].get("toggleObjectTypeFilter");

            // Disable all filters except tables
            let result = await toggleReducer!(controller.state, { objectType: "views" });
            result = await toggleReducer!(result, { objectType: "storedProcedures" });
            result = await toggleReducer!(result, { objectType: "functions" });

            // Only tables should be in results
            const nonTableResults = result.searchResults.filter(
                (r: SearchResultItem) => r.type !== MetadataType.Table,
            );
            expect(nonTableResults.length).to.equal(0);
        });

        test("setObjectTypeFilters reducer sets all filters at once", async () => {
            createController();
            await waitForInitialization();

            const setFiltersReducer = controller["_reducerHandlers"].get("setObjectTypeFilters");
            expect(setFiltersReducer, "SetObjectTypeFilters reducer was not registered").to.be.a(
                "function",
            );

            const newFilters = {
                tables: false,
                views: true,
                storedProcedures: false,
                functions: true,
            };

            const result = await setFiltersReducer!(controller.state, { filters: newFilters });

            expect(result.objectTypeFilters).to.deep.equal(newFilters);
        });

        test("setObjectTypeFilters reducer filters results accordingly", async () => {
            createController();
            await waitForInitialization();

            const setFiltersReducer = controller["_reducerHandlers"].get("setObjectTypeFilters");

            const newFilters = {
                tables: false,
                views: true,
                storedProcedures: false,
                functions: false,
            };

            const result = await setFiltersReducer!(controller.state, { filters: newFilters });

            // Only views should be in results
            const nonViewResults = result.searchResults.filter(
                (r: SearchResultItem) => r.type !== MetadataType.View,
            );
            expect(nonViewResults.length).to.equal(0);

            // Verify at least one view exists
            const viewResults = result.searchResults.filter(
                (r: SearchResultItem) => r.type === MetadataType.View,
            );
            expect(viewResults.length).to.be.greaterThan(0);
        });

        test("toggleSchemaFilter reducer adds schema when not selected", async () => {
            createController();
            await waitForInitialization();

            const toggleReducer = controller["_reducerHandlers"].get("toggleSchemaFilter");
            expect(toggleReducer, "ToggleSchemaFilter reducer was not registered").to.be.a(
                "function",
            );

            // First clear all schemas to have a clean state
            const clearReducer = controller["_reducerHandlers"].get("clearSchemaSelection");
            let result = await clearReducer!(controller.state, {});

            // Toggle a schema to add it
            result = await toggleReducer!(result, { schema: "dbo" });
            expect(result.selectedSchemas).to.include("dbo");
        });

        test("toggleSchemaFilter reducer removes schema when already selected", async () => {
            createController();
            await waitForInitialization();

            const toggleReducer = controller["_reducerHandlers"].get("toggleSchemaFilter");

            // Initially all schemas are selected, so toggle should remove
            const result = await toggleReducer!(controller.state, { schema: "dbo" });
            expect(result.selectedSchemas).to.not.include("dbo");
        });

        test("selectAllSchemas reducer selects all available schemas", async () => {
            createController();
            await waitForInitialization();

            const selectAllReducer = controller["_reducerHandlers"].get("selectAllSchemas");
            expect(selectAllReducer, "SelectAllSchemas reducer was not registered").to.be.a(
                "function",
            );

            // First clear schemas
            const clearReducer = controller["_reducerHandlers"].get("clearSchemaSelection");
            let result = await clearReducer!(controller.state, {});
            expect(result.selectedSchemas.length).to.equal(0);

            // Then select all
            result = await selectAllReducer!(result, {});
            expect(result.selectedSchemas.length).to.equal(result.availableSchemas.length);
            expect(result.selectedSchemas).to.deep.equal(result.availableSchemas);
        });

        test("clearSchemaSelection reducer clears all selected schemas", async () => {
            createController();
            await waitForInitialization();

            const clearReducer = controller["_reducerHandlers"].get("clearSchemaSelection");
            expect(clearReducer, "ClearSchemaSelection reducer was not registered").to.be.a(
                "function",
            );

            // Initially schemas are selected
            expect(controller.state.selectedSchemas.length).to.be.greaterThan(0);

            const result = await clearReducer!(controller.state, {});
            expect(result.selectedSchemas.length).to.equal(0);
        });

        test("clearSchemaSelection filters out all results", async () => {
            createController();
            await waitForInitialization();

            const clearReducer = controller["_reducerHandlers"].get("clearSchemaSelection");

            const result = await clearReducer!(controller.state, {});
            expect(result.searchResults.length).to.equal(0);
        });

        test("setSchemaFilters reducer sets selected schemas", async () => {
            createController();
            await waitForInitialization();

            const setSchemaFiltersReducer = controller["_reducerHandlers"].get("setSchemaFilters");
            expect(setSchemaFiltersReducer, "SetSchemaFilters reducer was not registered").to.be.a(
                "function",
            );

            const schemasToSet = ["dbo", "sales"];
            const result = await setSchemaFiltersReducer!(controller.state, {
                schemas: schemasToSet,
            });

            expect(result.selectedSchemas).to.deep.equal(schemasToSet);
        });

        test("setSchemaFilters reducer filters results by selected schemas", async () => {
            createController();
            await waitForInitialization();

            const setSchemaFiltersReducer = controller["_reducerHandlers"].get("setSchemaFilters");

            // Set only 'dbo' schema
            const result = await setSchemaFiltersReducer!(controller.state, { schemas: ["dbo"] });

            // All results should be from dbo schema
            const nonDboResults = result.searchResults.filter(
                (r: SearchResultItem) => r.schema !== "dbo",
            );
            expect(nonDboResults.length).to.equal(0);

            // Verify at least one dbo result exists
            const dboResults = result.searchResults.filter(
                (r: SearchResultItem) => r.schema === "dbo",
            );
            expect(dboResults.length).to.be.greaterThan(0);
        });

        test("setSchemaFilters reducer with empty array shows no results", async () => {
            createController();
            await waitForInitialization();

            const setSchemaFiltersReducer = controller["_reducerHandlers"].get("setSchemaFilters");

            const result = await setSchemaFiltersReducer!(controller.state, { schemas: [] });

            expect(result.selectedSchemas).to.deep.equal([]);
            expect(result.searchResults.length).to.equal(0);
        });
    });

    suite("Object Action Reducers", () => {
        test("scriptObject reducer generates SELECT script for table", async () => {
            createController();
            await waitForInitialization();

            const scriptReducer = controller["_reducerHandlers"].get("scriptObject");
            expect(scriptReducer, "ScriptObject reducer was not registered").to.be.a("function");

            const testObject: SearchResultItem = {
                name: "Users",
                schema: "dbo",
                type: MetadataType.Table,
                typeName: "Table",
                metadataTypeName: "Table",
                fullName: "dbo.Users",
            };

            openTextDocumentStub.resolves({
                uri: vscode.Uri.file("/tmp/script.sql"),
            } as unknown as vscode.TextDocument);

            await scriptReducer!(controller.state, { object: testObject, scriptType: "SELECT" });

            expect(mockScriptingService.script).to.have.been.calledOnce;
            expect(openTextDocumentStub).to.have.been.calledOnce;
            expect(showTextDocumentStub).to.have.been.calledOnce;
        });

        test("scriptObject reducer generates CREATE script for table", async () => {
            createController();
            await waitForInitialization();

            const scriptReducer = controller["_reducerHandlers"].get("scriptObject");

            const testObject: SearchResultItem = {
                name: "Users",
                schema: "dbo",
                type: MetadataType.Table,
                typeName: "Table",
                metadataTypeName: "Table",
                fullName: "dbo.Users",
            };

            openTextDocumentStub.resolves({
                uri: vscode.Uri.file("/tmp/script.sql"),
            } as unknown as vscode.TextDocument);

            await scriptReducer!(controller.state, { object: testObject, scriptType: "CREATE" });

            expect(mockScriptingService.script).to.have.been.called;
        });

        test("scriptObject reducer generates DROP script for table", async () => {
            createController();
            await waitForInitialization();

            const scriptReducer = controller["_reducerHandlers"].get("scriptObject");

            const testObject: SearchResultItem = {
                name: "Users",
                schema: "dbo",
                type: MetadataType.Table,
                typeName: "Table",
                metadataTypeName: "Table",
                fullName: "dbo.Users",
            };

            openTextDocumentStub.resolves({
                uri: vscode.Uri.file("/tmp/script.sql"),
            } as unknown as vscode.TextDocument);

            await scriptReducer!(controller.state, { object: testObject, scriptType: "DROP" });

            expect(mockScriptingService.script).to.have.been.called;
        });

        test("copyObjectName reducer copies full object name to clipboard", async () => {
            createController();
            await waitForInitialization();

            const copyReducer = controller["_reducerHandlers"].get("copyObjectName");
            expect(copyReducer, "CopyObjectName reducer was not registered").to.be.a("function");

            const testObject: SearchResultItem = {
                name: "Users",
                schema: "dbo",
                type: MetadataType.Table,
                typeName: "Table",
                metadataTypeName: "Table",
                fullName: "dbo.Users",
            };

            writeTextStub.resolves();

            await copyReducer!(controller.state, { object: testObject });

            expect(writeTextStub).to.have.been.calledOnceWith("dbo.Users");
            expect(showInformationMessageStub).to.have.been.calledOnceWith(
                'Copied "dbo.Users" to clipboard',
            );
        });

        test("editData reducer executes tableExplorer command for table", async () => {
            createController();
            await waitForInitialization();

            const editDataReducer = controller["_reducerHandlers"].get("editData");
            expect(editDataReducer, "EditData reducer was not registered").to.be.a("function");

            const executeCommandStub = sandbox.stub(vscode.commands, "executeCommand").resolves();

            const testObject: SearchResultItem = {
                name: "Users",
                schema: "dbo",
                type: MetadataType.Table,
                typeName: "Table",
                metadataTypeName: "Table",
                fullName: "dbo.Users",
            };

            await editDataReducer!(controller.state, { object: testObject });

            expect(executeCommandStub).to.have.been.calledOnce;
            expect(executeCommandStub.firstCall.args[0]).to.equal("mssql.tableExplorer");
        });

        test("editData reducer creates synthetic node with correct metadata", async () => {
            createController();
            await waitForInitialization();

            const editDataReducer = controller["_reducerHandlers"].get("editData");
            const executeCommandStub = sandbox.stub(vscode.commands, "executeCommand").resolves();

            const testObject: SearchResultItem = {
                name: "Products",
                schema: "sales",
                type: MetadataType.Table,
                typeName: "Table",
                metadataTypeName: "Table",
                fullName: "sales.Products",
            };

            await editDataReducer!(controller.state, { object: testObject });

            const syntheticNode = executeCommandStub.firstCall.args[1];
            expect(syntheticNode.metadata.name).to.equal("Products");
            expect(syntheticNode.metadata.schema).to.equal("sales");
            expect(syntheticNode.nodeType).to.equal("Table");
        });

        test("modifyTable reducer executes editTable command for table", async () => {
            createController();
            await waitForInitialization();

            const modifyTableReducer = controller["_reducerHandlers"].get("modifyTable");
            expect(modifyTableReducer, "ModifyTable reducer was not registered").to.be.a(
                "function",
            );

            const executeCommandStub = sandbox.stub(vscode.commands, "executeCommand").resolves();

            const testObject: SearchResultItem = {
                name: "Users",
                schema: "dbo",
                type: MetadataType.Table,
                typeName: "Table",
                metadataTypeName: "Table",
                fullName: "dbo.Users",
            };

            await modifyTableReducer!(controller.state, { object: testObject });

            expect(executeCommandStub).to.have.been.calledOnce;
            expect(executeCommandStub.firstCall.args[0]).to.equal("mssql.editTable");
        });

        test("modifyTable reducer creates synthetic node with correct metadata and label", async () => {
            createController();
            await waitForInitialization();

            const modifyTableReducer = controller["_reducerHandlers"].get("modifyTable");
            const executeCommandStub = sandbox.stub(vscode.commands, "executeCommand").resolves();

            const testObject: SearchResultItem = {
                name: "Products",
                schema: "sales",
                type: MetadataType.Table,
                typeName: "Table",
                metadataTypeName: "Table",
                fullName: "sales.Products",
            };

            await modifyTableReducer!(controller.state, { object: testObject });

            const syntheticNode = executeCommandStub.firstCall.args[1];
            expect(syntheticNode.metadata.name).to.equal("Products");
            expect(syntheticNode.metadata.schema).to.equal("sales");
            expect(syntheticNode.nodeType).to.equal("Table");
            expect(syntheticNode.label).to.equal("Products");
        });

        test("modifyTable reducer creates synthetic node with updateConnectionProfile method", async () => {
            createController();
            await waitForInitialization();

            const modifyTableReducer = controller["_reducerHandlers"].get("modifyTable");
            const executeCommandStub = sandbox.stub(vscode.commands, "executeCommand").resolves();

            const testObject: SearchResultItem = {
                name: "Users",
                schema: "dbo",
                type: MetadataType.Table,
                typeName: "Table",
                metadataTypeName: "Table",
                fullName: "dbo.Users",
            };

            await modifyTableReducer!(controller.state, { object: testObject });

            const syntheticNode = executeCommandStub.firstCall.args[1];
            expect(syntheticNode.updateConnectionProfile).to.be.a("function");

            // Test that the method works correctly
            const newProfile = { server: "new-server", database: "NewDB" };
            syntheticNode.updateConnectionProfile(newProfile);
            expect(syntheticNode.connectionProfile).to.deep.equal(newProfile);
        });
    });

    suite("Data Refresh Reducers", () => {
        test("refreshDatabases reducer reloads database list", async () => {
            createController();
            await waitForInitialization();

            const refreshReducer = controller["_reducerHandlers"].get("refreshDatabases");
            expect(refreshReducer, "RefreshDatabases reducer was not registered").to.be.a(
                "function",
            );

            // Reset stub to track new calls
            (mockMetadataService.getDatabases as sinon.SinonStub).resetHistory();

            await refreshReducer!(controller.state, {});

            expect(mockMetadataService.getDatabases).to.have.been.called;
        });

        test("refreshResults reducer clears cache and reloads metadata", async () => {
            createController();
            await waitForInitialization();

            const refreshReducer = controller["_reducerHandlers"].get("refreshResults");
            expect(refreshReducer, "RefreshResults reducer was not registered").to.be.a("function");

            // Reset stub to track new calls
            (mockMetadataService.getMetadata as sinon.SinonStub).resetHistory();

            await refreshReducer!(controller.state, {});

            expect(mockMetadataService.getMetadata).to.have.been.called;
        });
    });

    suite("Controller Initialization", () => {
        test("creates webview panel with correct title", () => {
            createController();

            const createPanelStub = vscode.window.createWebviewPanel as sinon.SinonStub;
            expect(createPanelStub).to.have.been.calledOnce;

            const callArgs = createPanelStub.firstCall.args;
            expect(callArgs[1]).to.include("test-server");
        });

        test("registers all reducers", () => {
            createController();

            expect(controller["_reducerHandlers"].has("search")).to.be.true;
            expect(controller["_reducerHandlers"].has("clearSearch")).to.be.true;
            expect(controller["_reducerHandlers"].has("setDatabase")).to.be.true;
            expect(controller["_reducerHandlers"].has("toggleObjectTypeFilter")).to.be.true;
            expect(controller["_reducerHandlers"].has("setObjectTypeFilters")).to.be.true;
            expect(controller["_reducerHandlers"].has("toggleSchemaFilter")).to.be.true;
            expect(controller["_reducerHandlers"].has("setSchemaFilters")).to.be.true;
            expect(controller["_reducerHandlers"].has("selectAllSchemas")).to.be.true;
            expect(controller["_reducerHandlers"].has("clearSchemaSelection")).to.be.true;
            expect(controller["_reducerHandlers"].has("scriptObject")).to.be.true;
            expect(controller["_reducerHandlers"].has("editData")).to.be.true;
            expect(controller["_reducerHandlers"].has("modifyTable")).to.be.true;
            expect(controller["_reducerHandlers"].has("copyObjectName")).to.be.true;
            expect(controller["_reducerHandlers"].has("refreshDatabases")).to.be.true;
            expect(controller["_reducerHandlers"].has("refreshResults")).to.be.true;
        });

        test("loads databases on initialization", async () => {
            createController();
            await waitForInitialization();

            expect(mockMetadataService.getDatabases).to.have.been.called;
        });

        test("loads metadata on initialization", async () => {
            createController();
            await waitForInitialization();

            expect(mockMetadataService.getMetadata).to.have.been.called;
        });
    });

    suite("Error Handling", () => {
        test("handles metadata service error gracefully", async () => {
            (mockMetadataService.getMetadata as sinon.SinonStub).rejects(
                new Error("Connection failed"),
            );

            createController();
            await waitForInitialization();

            // Controller should still have reducers registered
            expect(controller["_reducerHandlers"].has("search")).to.be.true;
        });

        test("handles database list error gracefully", async () => {
            (mockMetadataService.getDatabases as sinon.SinonStub).rejects(
                new Error("Permission denied"),
            );

            createController();
            await waitForInitialization();

            // Controller should still have reducers registered
            expect(controller["_reducerHandlers"].has("search")).to.be.true;
        });
    });
});
