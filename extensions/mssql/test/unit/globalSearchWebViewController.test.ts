/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import * as sinon from "sinon";
import { expect } from "chai";
import { GlobalSearchWebViewController } from "../../src/globalSearch/globalSearchWebViewController";
import ConnectionManager from "../../src/controllers/connectionManager";
import { IMetadataService } from "../../src/services/metadataService";
import { MetadataType, ObjectMetadata } from "../../src/sharedInterfaces/metadata";
import { SearchResultItem } from "../../src/sharedInterfaces/globalSearch";
import { TreeNodeInfo } from "../../src/objectExplorer/nodes/treeNodeInfo";
import { stubTelemetry, stubVscodeWrapper } from "./utils";
import VscodeWrapper from "../../src/controllers/vscodeWrapper";

suite("GlobalSearchWebViewController", () => {
    let sandbox: sinon.SinonSandbox;
    let mockContext: vscode.ExtensionContext;
    let mockVscodeWrapper: VscodeWrapper;
    let mockMetadataService: sinon.SinonStubbedInstance<IMetadataService>;
    let mockConnectionManager: sinon.SinonStubbedInstance<ConnectionManager>;
    let mockTargetNode: TreeNodeInfo;
    let controller: GlobalSearchWebViewController;
    let mockWebview: vscode.Webview;
    let mockPanel: vscode.WebviewPanel;
    let showInformationMessageStub: sinon.SinonStub;
    let showErrorMessageStub: sinon.SinonStub;
    let openTextDocumentStub: sinon.SinonStub;
    let showTextDocumentStub: sinon.SinonStub;
    let writeTextStub: sinon.SinonStub;

    const mockMetadata: ObjectMetadata[] = [
        { name: "Users", schema: "dbo", metadataType: MetadataType.Table, metadataTypeName: "Table" },
        { name: "Orders", schema: "dbo", metadataType: MetadataType.Table, metadataTypeName: "Table" },
        { name: "Products", schema: "sales", metadataType: MetadataType.Table, metadataTypeName: "Table" },
        { name: "vw_UserOrders", schema: "dbo", metadataType: MetadataType.View, metadataTypeName: "View" },
        { name: "sp_GetUsers", schema: "dbo", metadataType: MetadataType.SProc, metadataTypeName: "StoredProcedure" },
        { name: "fn_CalculateTotal", schema: "dbo", metadataType: MetadataType.Function, metadataTypeName: "Function" },
    ];

    setup(() => {
        sandbox = sinon.createSandbox();
        stubTelemetry(sandbox);

        // Mock vscode.window methods
        showInformationMessageStub = sandbox.stub(vscode.window, "showInformationMessage");
        showErrorMessageStub = sandbox.stub(vscode.window, "showErrorMessage");
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
        } as any;

        mockTargetNode = {
            connectionProfile: {
                server: "test-server",
                database: "TestDB",
            },
        } as unknown as TreeNodeInfo;
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
            expect(setDatabaseReducer, "SetDatabase reducer was not registered").to.be.a("function");

            const result = await setDatabaseReducer!(controller.state, { database: "AdventureWorks" });

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
            expect(toggleReducer, "ToggleObjectTypeFilter reducer was not registered").to.be.a("function");

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
                fullName: "dbo.Users",
            };

            openTextDocumentStub.resolves({
                uri: vscode.Uri.file("/tmp/script.sql"),
            } as unknown as vscode.TextDocument);

            await scriptReducer!(controller.state, { object: testObject, scriptType: "SELECT" });

            expect(openTextDocumentStub.calledOnce).to.be.true;
            expect(openTextDocumentStub.firstCall.args[0]).to.deep.include({
                content: "SELECT TOP (1000) * FROM [dbo].[Users]",
                language: "sql",
            });
            expect(showTextDocumentStub.calledOnce).to.be.true;
        });

        test("scriptObject reducer shows message for CREATE script (not yet implemented)", async () => {
            createController();
            await waitForInitialization();

            const scriptReducer = controller["_reducerHandlers"].get("scriptObject");

            const testObject: SearchResultItem = {
                name: "Users",
                schema: "dbo",
                type: MetadataType.Table,
                typeName: "Table",
                fullName: "dbo.Users",
            };

            await scriptReducer!(controller.state, { object: testObject, scriptType: "CREATE" });

            expect(showInformationMessageStub.calledOnceWith("Script as CREATE not yet implemented")).to.be.true;
        });

        test("scriptObject reducer shows message for DROP script (not yet implemented)", async () => {
            createController();
            await waitForInitialization();

            const scriptReducer = controller["_reducerHandlers"].get("scriptObject");

            const testObject: SearchResultItem = {
                name: "Users",
                schema: "dbo",
                type: MetadataType.Table,
                typeName: "Table",
                fullName: "dbo.Users",
            };

            await scriptReducer!(controller.state, { object: testObject, scriptType: "DROP" });

            expect(showInformationMessageStub.calledOnceWith("Script as DROP not yet implemented")).to.be.true;
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
                fullName: "dbo.Users",
            };

            writeTextStub.resolves();

            await copyReducer!(controller.state, { object: testObject });

            expect(writeTextStub.calledOnceWith("dbo.Users")).to.be.true;
            expect(showInformationMessageStub.calledOnceWith('Copied "dbo.Users" to clipboard')).to.be.true;
        });
    });

    suite("Data Refresh Reducers", () => {
        test("refreshDatabases reducer reloads database list", async () => {
            createController();
            await waitForInitialization();

            const refreshReducer = controller["_reducerHandlers"].get("refreshDatabases");
            expect(refreshReducer, "RefreshDatabases reducer was not registered").to.be.a("function");

            // Reset stub to track new calls
            (mockMetadataService.getDatabases as sinon.SinonStub).resetHistory();

            await refreshReducer!(controller.state, {});

            expect(mockMetadataService.getDatabases.called).to.be.true;
        });

        test("refreshResults reducer clears cache and reloads metadata", async () => {
            createController();
            await waitForInitialization();

            const refreshReducer = controller["_reducerHandlers"].get("refreshResults");
            expect(refreshReducer, "RefreshResults reducer was not registered").to.be.a("function");

            // Reset stub to track new calls
            (mockMetadataService.getMetadata as sinon.SinonStub).resetHistory();

            await refreshReducer!(controller.state, {});

            expect(mockMetadataService.getMetadata.called).to.be.true;
        });
    });

    suite("Controller Initialization", () => {
        test("creates webview panel with correct title", () => {
            createController();

            const createPanelStub = vscode.window.createWebviewPanel as sinon.SinonStub;
            expect(createPanelStub.calledOnce).to.be.true;

            const callArgs = createPanelStub.firstCall.args;
            expect(callArgs[1]).to.include("test-server");
        });

        test("registers all reducers", () => {
            createController();

            expect(controller["_reducerHandlers"].has("search")).to.be.true;
            expect(controller["_reducerHandlers"].has("clearSearch")).to.be.true;
            expect(controller["_reducerHandlers"].has("setDatabase")).to.be.true;
            expect(controller["_reducerHandlers"].has("toggleObjectTypeFilter")).to.be.true;
            expect(controller["_reducerHandlers"].has("scriptObject")).to.be.true;
            expect(controller["_reducerHandlers"].has("copyObjectName")).to.be.true;
            expect(controller["_reducerHandlers"].has("refreshDatabases")).to.be.true;
            expect(controller["_reducerHandlers"].has("refreshResults")).to.be.true;
        });

        test("loads databases on initialization", async () => {
            createController();
            await waitForInitialization();

            expect(mockMetadataService.getDatabases.called).to.be.true;
        });

        test("loads metadata on initialization", async () => {
            createController();
            await waitForInitialization();

            expect(mockMetadataService.getMetadata.called).to.be.true;
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
