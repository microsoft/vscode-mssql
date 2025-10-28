/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from "assert";
import * as sinon from "sinon";
import * as vscode from "vscode";
import { TableExplorerWebViewController } from "../../src/tableExplorer/tableExplorerWebViewController";
import { ITableExplorerService } from "../../src/services/tableExplorerService";
import ConnectionManager from "../../src/controllers/connectionManager";
import VscodeWrapper from "../../src/controllers/vscodeWrapper";
import { TreeNodeInfo } from "../../src/objectExplorer/nodes/treeNodeInfo";
import {
    EditSubsetResult,
    EditRow,
    EditRowState,
    EditCreateRowResult,
    EditCellResult,
    EditRevertRowResult,
    EditScriptResult,
    EditSessionReadyParams,
    DbCellValue,
} from "../../src/sharedInterfaces/tableExplorer";
import { IConnectionProfile } from "../../src/models/interfaces";
import * as LocConstants from "../../src/constants/locConstants";
import { stubTelemetry, stubVscodeWrapper } from "./utils";

suite("TableExplorerWebViewController - Reducers", () => {
    let sandbox: sinon.SinonSandbox;
    let mockContext: vscode.ExtensionContext;
    let mockVscodeWrapper: VscodeWrapper;
    let mockTableExplorerService: sinon.SinonStubbedInstance<ITableExplorerService>;
    let mockConnectionManager: sinon.SinonStubbedInstance<ConnectionManager>;
    let mockTargetNode: TreeNodeInfo;
    let controller: TableExplorerWebViewController;
    let mockWebview: vscode.Webview;
    let mockPanel: vscode.WebviewPanel;
    let showInformationMessageStub: sinon.SinonStub;
    let showWarningMessageStub: sinon.SinonStub;
    let showErrorMessageStub: sinon.SinonStub;
    let openTextDocumentStub: sinon.SinonStub;
    let showTextDocumentStub: sinon.SinonStub;
    let writeTextStub: sinon.SinonStub;

    const mockConnectionProfile: IConnectionProfile = {
        server: "test-server",
        database: "test-db",
        authenticationType: "SqlLogin",
        user: "test-user",
        password: "test-password",
        connectionString: "",
        profileName: "test-profile",
        savePassword: true,
        emptyPasswordInput: false,
    } as IConnectionProfile;

    const createMockCell = (displayValue: string, isNull: boolean = false): DbCellValue => ({
        displayValue,
        isNull,
        invariantCultureDisplayValue: displayValue,
    });

    const createMockRow = (id: number, cellValues: string[]): EditRow => ({
        id,
        isDirty: false,
        state: EditRowState.clean,
        cells: cellValues.map((val) => createMockCell(val)),
    });

    const createMockSubsetResult = (rowCount: number = 2): EditSubsetResult => ({
        rowCount,
        subset: [createMockRow(0, ["1", "John", "Doe"]), createMockRow(1, ["2", "Jane", "Smith"])],
        columnInfo: [
            { name: "id", isEditable: false },
            { name: "firstName", isEditable: true },
            { name: "lastName", isEditable: true },
        ],
    });

    setup(() => {
        sandbox = sinon.createSandbox();

        // Mock vscode.window methods
        showInformationMessageStub = sandbox.stub(vscode.window, "showInformationMessage");
        showWarningMessageStub = sandbox.stub(vscode.window, "showWarningMessage");
        showErrorMessageStub = sandbox.stub(vscode.window, "showErrorMessage");
        openTextDocumentStub = sandbox.stub(vscode.workspace, "openTextDocument");
        showTextDocumentStub = sandbox.stub(vscode.window, "showTextDocument");
        writeTextStub = sandbox.stub();
        sandbox.stub(vscode.env, "clipboard").value({
            writeText: writeTextStub,
        });

        // Setup mock webview and panel
        mockWebview = {
            postMessage: sandbox.stub(),
            asWebviewUri: sandbox.stub().returns(vscode.Uri.parse("https://example.com/")),
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
        stubTelemetry(sandbox);

        // Setup mock context
        mockContext = {
            extensionUri: vscode.Uri.parse("file:///test"),
            extensionPath: "/test",
            subscriptions: [],
        } as unknown as vscode.ExtensionContext;

        // Setup mock services
        mockVscodeWrapper = stubVscodeWrapper(sandbox);
        mockTableExplorerService = {
            initialize: sandbox.stub().resolves(),
            subset: sandbox.stub().resolves(createMockSubsetResult()),
            commit: sandbox.stub().resolves({}),
            createRow: sandbox.stub().resolves(),
            deleteRow: sandbox.stub().resolves({}),
            updateCell: sandbox.stub().resolves(),
            revertCell: sandbox.stub().resolves(),
            revertRow: sandbox.stub().resolves(),
            generateScripts: sandbox.stub().resolves(),
            dispose: sandbox.stub().resolves({}),
            sqlToolsClient: {
                onNotification: sandbox.stub(),
            } as any,
        } as any;

        mockConnectionManager = {
            isConnected: sandbox.stub().returns(true),
            isConnecting: sandbox.stub().returns(false),
            connect: sandbox.stub().resolves(),
        } as any;

        mockTargetNode = {
            metadata: {
                name: "TestTable",
                schema: "dbo",
                metadataTypeName: "Table",
            },
            connectionProfile: mockConnectionProfile,
        } as any;

        // Create controller
        controller = new TableExplorerWebViewController(
            mockContext,
            mockVscodeWrapper,
            mockTableExplorerService,
            mockConnectionManager,
            mockTargetNode,
        );

        // Simulate edit session ready
        const notificationHandler = (mockTableExplorerService.sqlToolsClient.onNotification as any)
            .firstCall.args[1];
        notificationHandler({
            ownerUri: "test-owner-uri",
            success: true,
            message: "",
        } as EditSessionReadyParams);
    });

    teardown(() => {
        sandbox.restore();
    });

    suite("commitChanges reducer", () => {
        test("should commit changes successfully and clear newRows", async () => {
            // Arrange
            controller.state.ownerUri = "test-owner-uri";
            controller.state.newRows = [createMockRow(100, ["3", "New", "Row"])];
            mockTableExplorerService.commit.resolves({});

            // Act
            await controller["_reducerHandlers"].get("commitChanges")(controller.state, {});

            // Assert
            assert.ok(mockTableExplorerService.commit.calledOnceWith("test-owner-uri"));
            assert.ok(
                showInformationMessageStub.calledOnceWith(
                    LocConstants.TableExplorer.changesSavedSuccessfully,
                ),
            );
            assert.strictEqual(controller.state.newRows.length, 0);
        });

        test("should show error message when commit fails", async () => {
            // Arrange
            controller.state.ownerUri = "test-owner-uri";
            const error = new Error("Commit failed");
            mockTableExplorerService.commit.rejects(error);

            // Act
            await controller["_reducerHandlers"].get("commitChanges")(controller.state, {});

            // Assert
            assert.ok(mockTableExplorerService.commit.calledOnce);
            assert.ok(showErrorMessageStub.calledOnce);
            assert.ok(showErrorMessageStub.firstCall.args[0].includes("Failed to save changes"));
        });
    });

    suite("loadSubset reducer", () => {
        test("should load subset with specified row count", async () => {
            // Arrange
            controller.state.ownerUri = "test-owner-uri";
            controller.state.newRows = [];
            const mockResult = createMockSubsetResult(5);
            mockTableExplorerService.subset.resolves(mockResult);
            mockTableExplorerService.subset.resetHistory(); // Reset call history from initialization

            // Act
            await controller["_reducerHandlers"].get("loadSubset")(controller.state, {
                rowCount: 100,
            });

            // Assert
            sinon.assert.calledOnce(mockTableExplorerService.subset);
            sinon.assert.calledWith(mockTableExplorerService.subset, "test-owner-uri", 0, 100);
            assert.strictEqual(controller.state.currentRowCount, 100);
            assert.strictEqual(controller.state.resultSet?.rowCount, 5);
        });

        test("should append newRows to subset result", async () => {
            // Arrange
            controller.state.ownerUri = "test-owner-uri";
            const newRow = createMockRow(100, ["3", "New", "Row"]);
            controller.state.newRows = [newRow];
            const mockResult = createMockSubsetResult(2);
            mockTableExplorerService.subset.resolves(mockResult);

            // Act
            await controller["_reducerHandlers"].get("loadSubset")(controller.state, {
                rowCount: 50,
            });

            // Assert
            assert.strictEqual(controller.state.resultSet?.rowCount, 3); // 2 from DB + 1 new
            assert.strictEqual(controller.state.resultSet?.subset.length, 3);
            assert.strictEqual(controller.state.resultSet?.subset[2].id, 100);
        });

        test("should show error message when loadSubset fails", async () => {
            // Arrange
            controller.state.ownerUri = "test-owner-uri";
            const error = new Error("Load failed");
            mockTableExplorerService.subset.rejects(error);

            // Act
            await controller["_reducerHandlers"].get("loadSubset")(controller.state, {
                rowCount: 100,
            });

            // Assert
            assert.ok(showErrorMessageStub.calledOnce);
            assert.ok(showErrorMessageStub.firstCall.args[0].includes("Failed to load data"));
        });
    });

    suite("createRow reducer", () => {
        test("should create a new row and add it to resultSet", async () => {
            // Arrange
            controller.state.ownerUri = "test-owner-uri";
            controller.state.resultSet = createMockSubsetResult(2);
            const newRow = createMockRow(100, ["", "", ""]);
            const createRowResult: EditCreateRowResult = {
                newRowId: 100,
                row: newRow,
                defaultValues: ["", "", ""],
            };
            mockTableExplorerService.createRow.resolves(createRowResult);

            // Act
            await controller["_reducerHandlers"].get("createRow")(controller.state, {});

            // Assert
            assert.ok(mockTableExplorerService.createRow.calledOnceWith("test-owner-uri"));
            assert.ok(
                showInformationMessageStub.calledOnceWith(
                    LocConstants.TableExplorer.newRowCreatedSuccessfully,
                ),
            );
            assert.strictEqual(controller.state.newRows.length, 1);
            assert.strictEqual(controller.state.newRows[0].id, 100);
            assert.strictEqual(controller.state.resultSet?.rowCount, 3);
        });

        test("should regenerate script if script pane is visible", async () => {
            // Arrange
            controller.state.ownerUri = "test-owner-uri";
            controller.state.resultSet = createMockSubsetResult(2);
            controller.state.showScriptPane = true;
            const newRow = createMockRow(100, ["", "", ""]);
            const createRowResult: EditCreateRowResult = {
                newRowId: 100,
                row: newRow,
                defaultValues: ["", "", ""],
            };
            mockTableExplorerService.createRow.resolves(createRowResult);
            mockTableExplorerService.generateScripts.resolves({
                scripts: ["INSERT INTO TestTable VALUES (...)"],
            });

            // Act
            await controller["_reducerHandlers"].get("createRow")(controller.state, {});

            // Assert
            assert.ok(mockTableExplorerService.generateScripts.calledOnce);
        });

        test("should show error message when createRow fails", async () => {
            // Arrange
            controller.state.ownerUri = "test-owner-uri";
            controller.state.resultSet = createMockSubsetResult(2);
            const error = new Error("Create row failed");
            mockTableExplorerService.createRow.rejects(error);
            showErrorMessageStub.resetHistory(); // Reset call history from previous tests

            // Act
            await controller["_reducerHandlers"].get("createRow")(controller.state, {});

            // Assert
            sinon.assert.calledOnce(showErrorMessageStub);
            assert.ok(
                showErrorMessageStub.firstCall.args[0].includes("Failed to create a new row"),
            );
        });
    });

    suite("deleteRow reducer", () => {
        test("should delete a row from resultSet", async () => {
            // Arrange
            controller.state.ownerUri = "test-owner-uri";
            controller.state.resultSet = createMockSubsetResult(2);
            mockTableExplorerService.deleteRow.resolves({});

            // Act
            await controller["_reducerHandlers"].get("deleteRow")(controller.state, { rowId: 0 });

            // Assert
            assert.ok(mockTableExplorerService.deleteRow.calledOnceWith("test-owner-uri", 0));
            assert.ok(
                showInformationMessageStub.calledOnceWith(LocConstants.TableExplorer.rowRemoved),
            );
            assert.strictEqual(controller.state.resultSet?.rowCount, 1);
            assert.strictEqual(controller.state.resultSet?.subset.length, 1);
        });

        test("should remove row from newRows array if it's a new row", async () => {
            // Arrange
            controller.state.ownerUri = "test-owner-uri";
            const newRow = createMockRow(100, ["3", "New", "Row"]);
            controller.state.newRows = [newRow];
            controller.state.resultSet = {
                ...createMockSubsetResult(2),
                subset: [...createMockSubsetResult(2).subset, newRow],
                rowCount: 3,
            };
            mockTableExplorerService.deleteRow.resolves({});

            // Act
            await controller["_reducerHandlers"].get("deleteRow")(controller.state, { rowId: 100 });

            // Assert
            assert.strictEqual(controller.state.newRows.length, 0);
            assert.strictEqual(controller.state.resultSet?.rowCount, 2);
        });

        test("should regenerate script if script pane is visible", async () => {
            // Arrange
            controller.state.ownerUri = "test-owner-uri";
            controller.state.resultSet = createMockSubsetResult(2);
            controller.state.showScriptPane = true;
            mockTableExplorerService.deleteRow.resolves({});
            mockTableExplorerService.generateScripts.resolves({
                scripts: ["DELETE FROM TestTable WHERE id = 1"],
            });

            // Act
            await controller["_reducerHandlers"].get("deleteRow")(controller.state, { rowId: 0 });

            // Assert
            assert.ok(mockTableExplorerService.generateScripts.calledOnce);
        });

        test("should show error message when deleteRow fails", async () => {
            // Arrange
            controller.state.ownerUri = "test-owner-uri";
            const error = new Error("Delete row failed");
            mockTableExplorerService.deleteRow.rejects(error);

            // Act
            await controller["_reducerHandlers"].get("deleteRow")(controller.state, { rowId: 0 });

            // Assert
            assert.ok(showErrorMessageStub.calledOnce);
            assert.ok(showErrorMessageStub.firstCall.args[0].includes("Failed to remove row"));
        });
    });

    suite("updateCell reducer", () => {
        test("should update cell value in resultSet", async () => {
            // Arrange
            controller.state.ownerUri = "test-owner-uri";
            controller.state.resultSet = createMockSubsetResult(2);
            const updatedCell: EditCellResult = {
                cell: {
                    displayValue: "Updated",
                    isNull: false,
                    invariantCultureDisplayValue: "Updated",
                    isDirty: true,
                },
                isRowDirty: true,
            };
            mockTableExplorerService.updateCell.resolves(updatedCell);

            // Act
            await controller["_reducerHandlers"].get("updateCell")(controller.state, {
                rowId: 0,
                columnId: 1,
                newValue: "Updated",
            });

            // Assert
            assert.ok(
                mockTableExplorerService.updateCell.calledOnceWith(
                    "test-owner-uri",
                    0,
                    1,
                    "Updated",
                ),
            );
            assert.strictEqual(
                controller.state.resultSet?.subset[0].cells[1].displayValue,
                "Updated",
            );
        });

        test("should regenerate script if script pane is visible", async () => {
            // Arrange
            controller.state.ownerUri = "test-owner-uri";
            controller.state.resultSet = createMockSubsetResult(2);
            controller.state.showScriptPane = true;
            const updatedCell: EditCellResult = {
                cell: {
                    displayValue: "Updated",
                    isNull: false,
                    invariantCultureDisplayValue: "Updated",
                    isDirty: true,
                },
                isRowDirty: true,
            };
            mockTableExplorerService.updateCell.resolves(updatedCell);
            mockTableExplorerService.generateScripts.resolves({
                scripts: ["UPDATE TestTable SET firstName = 'Updated' WHERE id = 1"],
            });

            // Act
            await controller["_reducerHandlers"].get("updateCell")(controller.state, {
                rowId: 0,
                columnId: 1,
                newValue: "Updated",
            });

            // Assert
            assert.ok(mockTableExplorerService.generateScripts.calledOnce);
        });

        test("should show error message when updateCell fails", async () => {
            // Arrange
            controller.state.ownerUri = "test-owner-uri";
            const error = new Error("Update cell failed");
            mockTableExplorerService.updateCell.rejects(error);

            // Act
            await controller["_reducerHandlers"].get("updateCell")(controller.state, {
                rowId: 0,
                columnId: 1,
                newValue: "Updated",
            });

            // Assert
            assert.ok(showErrorMessageStub.calledOnce);
            assert.ok(showErrorMessageStub.firstCall.args[0].includes("Failed to update cell"));
        });
    });

    suite("revertCell reducer", () => {
        test("should revert cell to original value", async () => {
            // Arrange
            controller.state.ownerUri = "test-owner-uri";
            controller.state.resultSet = createMockSubsetResult(2);
            const revertedCell: EditCellResult = {
                cell: {
                    displayValue: "John",
                    isNull: false,
                    invariantCultureDisplayValue: "John",
                    isDirty: false,
                },
                isRowDirty: false,
            };
            mockTableExplorerService.revertCell.resolves(revertedCell);

            // Act
            await controller["_reducerHandlers"].get("revertCell")(controller.state, {
                rowId: 0,
                columnId: 1,
            });

            // Assert
            assert.ok(mockTableExplorerService.revertCell.calledOnceWith("test-owner-uri", 0, 1));
            assert.strictEqual(controller.state.resultSet?.subset[0].cells[1].displayValue, "John");
        });

        test("should regenerate script if script pane is visible", async () => {
            // Arrange
            controller.state.ownerUri = "test-owner-uri";
            controller.state.resultSet = createMockSubsetResult(2);
            controller.state.showScriptPane = true;
            const revertedCell: EditCellResult = {
                cell: {
                    displayValue: "John",
                    isNull: false,
                    invariantCultureDisplayValue: "John",
                    isDirty: false,
                },
                isRowDirty: false,
            };
            mockTableExplorerService.revertCell.resolves(revertedCell);
            mockTableExplorerService.generateScripts.resolves({ scripts: [] });

            // Act
            await controller["_reducerHandlers"].get("revertCell")(controller.state, {
                rowId: 0,
                columnId: 1,
            });

            // Assert
            assert.ok(mockTableExplorerService.generateScripts.calledOnce);
        });

        test("should show error message when revertCell fails", async () => {
            // Arrange
            controller.state.ownerUri = "test-owner-uri";
            const error = new Error("Revert cell failed");
            mockTableExplorerService.revertCell.rejects(error);

            // Act
            await controller["_reducerHandlers"].get("revertCell")(controller.state, {
                rowId: 0,
                columnId: 1,
            });

            // Assert
            assert.ok(showErrorMessageStub.calledOnce);
            assert.ok(showErrorMessageStub.firstCall.args[0].includes("Failed to revert cell"));
        });
    });

    suite("revertRow reducer", () => {
        test("should revert entire row to original values", async () => {
            // Arrange
            controller.state.ownerUri = "test-owner-uri";
            controller.state.resultSet = createMockSubsetResult(2);
            const revertedRow: EditRevertRowResult = {
                row: createMockRow(0, ["1", "John", "Doe"]),
            };
            mockTableExplorerService.revertRow.resolves(revertedRow);

            // Act
            await controller["_reducerHandlers"].get("revertRow")(controller.state, { rowId: 0 });

            // Assert
            assert.ok(mockTableExplorerService.revertRow.calledOnceWith("test-owner-uri", 0));
            assert.strictEqual(controller.state.resultSet?.subset[0].cells[1].displayValue, "John");
        });

        test("should regenerate script if script pane is visible", async () => {
            // Arrange
            controller.state.ownerUri = "test-owner-uri";
            controller.state.resultSet = createMockSubsetResult(2);
            controller.state.showScriptPane = true;
            const revertedRow: EditRevertRowResult = {
                row: createMockRow(0, ["1", "John", "Doe"]),
            };
            mockTableExplorerService.revertRow.resolves(revertedRow);
            mockTableExplorerService.generateScripts.resolves({ scripts: [] });

            // Act
            await controller["_reducerHandlers"].get("revertRow")(controller.state, { rowId: 0 });

            // Assert
            assert.ok(mockTableExplorerService.generateScripts.calledOnce);
        });

        test("should show error message when revertRow fails", async () => {
            // Arrange
            controller.state.ownerUri = "test-owner-uri";
            const error = new Error("Revert row failed");
            mockTableExplorerService.revertRow.rejects(error);

            // Act
            await controller["_reducerHandlers"].get("revertRow")(controller.state, { rowId: 0 });

            // Assert
            assert.ok(showErrorMessageStub.calledOnce);
            assert.ok(showErrorMessageStub.firstCall.args[0].includes("Failed to revert row"));
        });
    });

    suite("generateScript reducer", () => {
        test("should generate script and show script pane", async () => {
            // Arrange
            controller.state.ownerUri = "test-owner-uri";
            controller.state.showScriptPane = false;
            const scriptResult: EditScriptResult = {
                scripts: [
                    "UPDATE TestTable SET firstName = 'Updated' WHERE id = 1;",
                    "DELETE FROM TestTable WHERE id = 2;",
                ],
            };
            mockTableExplorerService.generateScripts.resolves(scriptResult);

            // Act
            await controller["_reducerHandlers"].get("generateScript")(controller.state, {});

            // Assert
            assert.ok(mockTableExplorerService.generateScripts.calledOnceWith("test-owner-uri"));
            assert.ok(controller.state.updateScript?.includes("UPDATE TestTable"));
            assert.ok(controller.state.updateScript?.includes("DELETE FROM TestTable"));
            assert.strictEqual(controller.state.showScriptPane, true);
        });

        test("should handle empty script array", async () => {
            // Arrange
            controller.state.ownerUri = "test-owner-uri";
            const scriptResult: EditScriptResult = {
                scripts: [],
            };
            mockTableExplorerService.generateScripts.resolves(scriptResult);

            // Act
            await controller["_reducerHandlers"].get("generateScript")(controller.state, {});

            // Assert
            assert.strictEqual(controller.state.updateScript, "");
            assert.strictEqual(controller.state.showScriptPane, true);
        });

        test("should show error message when generateScript fails", async () => {
            // Arrange
            controller.state.ownerUri = "test-owner-uri";
            const error = new Error("Generate script failed");
            mockTableExplorerService.generateScripts.rejects(error);

            // Act
            await controller["_reducerHandlers"].get("generateScript")(controller.state, {});

            // Assert
            assert.ok(showErrorMessageStub.calledOnce);
            assert.ok(showErrorMessageStub.firstCall.args[0].includes("Failed to generate script"));
        });
    });

    suite("openScriptInEditor reducer", () => {
        test("should open script in SQL editor", async () => {
            // Arrange
            controller.state.updateScript = "SELECT * FROM TestTable;";
            const mockDocument = {} as vscode.TextDocument;
            openTextDocumentStub.resolves(mockDocument);
            showTextDocumentStub.resolves();

            // Act
            await controller["_reducerHandlers"].get("openScriptInEditor")(controller.state, {});

            // Assert
            assert.ok(openTextDocumentStub.calledOnce);
            const callArgs = openTextDocumentStub.firstCall.args[0];
            assert.strictEqual(callArgs.content, "SELECT * FROM TestTable;");
            assert.strictEqual(callArgs.language, "sql");
            assert.ok(showTextDocumentStub.calledOnceWith(mockDocument));
        });

        test("should show warning when no script to open", async () => {
            // Arrange
            controller.state.updateScript = undefined;

            // Act
            await controller["_reducerHandlers"].get("openScriptInEditor")(controller.state, {});

            // Assert
            assert.ok(openTextDocumentStub.notCalled);
            assert.ok(
                showWarningMessageStub.calledOnceWith(LocConstants.TableExplorer.noScriptToOpen),
            );
        });

        test("should show error message when opening script fails", async () => {
            // Arrange
            controller.state.updateScript = "SELECT * FROM TestTable;";
            const error = new Error("Open failed");
            openTextDocumentStub.rejects(error);

            // Act
            await controller["_reducerHandlers"].get("openScriptInEditor")(controller.state, {});

            // Assert
            assert.ok(showErrorMessageStub.calledOnce);
            assert.ok(showErrorMessageStub.firstCall.args[0].includes("Failed to open script"));
        });
    });

    suite("copyScriptToClipboard reducer", () => {
        test("should copy script to clipboard", async () => {
            // Arrange
            controller.state.updateScript = "SELECT * FROM TestTable;";
            writeTextStub.resolves();

            // Act
            await controller["_reducerHandlers"].get("copyScriptToClipboard")(controller.state, {});

            // Assert
            assert.ok(writeTextStub.calledOnceWith("SELECT * FROM TestTable;"));
            assert.ok(
                showInformationMessageStub.calledOnceWith(
                    LocConstants.TableExplorer.scriptCopiedToClipboard,
                ),
            );
        });

        test("should show warning when no script to copy", async () => {
            // Arrange
            controller.state.updateScript = undefined;

            // Act
            await controller["_reducerHandlers"].get("copyScriptToClipboard")(controller.state, {});

            // Assert
            assert.ok(writeTextStub.notCalled);
            assert.ok(
                showWarningMessageStub.calledOnceWith(LocConstants.TableExplorer.noScriptToCopy),
            );
        });

        test("should show error message when copying script fails", async () => {
            // Arrange
            controller.state.updateScript = "SELECT * FROM TestTable;";
            const error = new Error("Copy failed");
            writeTextStub.rejects(error);

            // Act
            await controller["_reducerHandlers"].get("copyScriptToClipboard")(controller.state, {});

            // Assert
            assert.ok(showErrorMessageStub.calledOnce);
            assert.ok(showErrorMessageStub.firstCall.args[0].includes("Failed to copy script"));
        });
    });

    suite("toggleScriptPane reducer", () => {
        test("should toggle script pane from false to true", async () => {
            // Arrange
            controller.state.showScriptPane = false;

            // Act
            await controller["_reducerHandlers"].get("toggleScriptPane")(controller.state, {});

            // Assert
            assert.strictEqual(controller.state.showScriptPane, true);
        });

        test("should toggle script pane from true to false", async () => {
            // Arrange
            controller.state.showScriptPane = true;

            // Act
            await controller["_reducerHandlers"].get("toggleScriptPane")(controller.state, {});

            // Assert
            assert.strictEqual(controller.state.showScriptPane, false);
        });
    });

    suite("setCurrentPage reducer", () => {
        test("should set current page number", async () => {
            // Arrange
            controller.state.currentPage = 1;

            // Act
            await controller["_reducerHandlers"].get("setCurrentPage")(controller.state, {
                pageNumber: 5,
            });

            // Assert
            assert.strictEqual(controller.state.currentPage, 5);
        });

        test("should update page number multiple times", async () => {
            // Arrange
            controller.state.currentPage = 1;

            // Act & Assert
            await controller["_reducerHandlers"].get("setCurrentPage")(controller.state, {
                pageNumber: 2,
            });
            assert.strictEqual(controller.state.currentPage, 2);

            await controller["_reducerHandlers"].get("setCurrentPage")(controller.state, {
                pageNumber: 10,
            });
            assert.strictEqual(controller.state.currentPage, 10);
        });
    });
});
