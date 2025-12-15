/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
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
import { ApiStatus } from "../../src/sharedInterfaces/webview";

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
    let showSaveDialogStub: sinon.SinonStub;
    let writeFileStub: sinon.SinonStub;

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
        showSaveDialogStub = sandbox.stub(vscode.window, "showSaveDialog");
        writeFileStub = sandbox.stub();
        sandbox.stub(vscode.workspace, "fs").value({
            writeFile: writeFileStub,
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
            expect(mockTableExplorerService.commit.calledOnceWith("test-owner-uri")).to.be.true;
            expect(
                showInformationMessageStub.calledOnceWith(
                    LocConstants.TableExplorer.changesSavedSuccessfully,
                ),
            ).to.be.true;
            expect(controller.state.newRows).to.have.length(0);
        });

        test("should show error message when commit fails", async () => {
            // Arrange
            controller.state.ownerUri = "test-owner-uri";
            const error = new Error("Commit failed");
            mockTableExplorerService.commit.rejects(error);

            // Act
            await controller["_reducerHandlers"].get("commitChanges")(controller.state, {});

            // Assert
            expect(mockTableExplorerService.commit.calledOnce).to.be.true;
            expect(showErrorMessageStub.calledOnce).to.be.true;
            expect(showErrorMessageStub.firstCall.args[0]).to.include("Failed to save changes");
        });
    });

    suite("loadSubset reducer", () => {
        test("should load subset with specified row count", async () => {
            // Arrange
            controller.state.ownerUri = "test-owner-uri";
            controller.state.newRows = [];
            controller.state.loadStatus = ApiStatus.Loaded;
            const mockResult = createMockSubsetResult(5);
            mockTableExplorerService.subset.resolves(mockResult);
            mockTableExplorerService.subset.resetHistory(); // Reset call history from initialization

            // Act
            await controller["_reducerHandlers"].get("loadSubset")(controller.state, {
                rowCount: 100,
            });

            // Assert
            expect(mockTableExplorerService.subset.calledOnce).to.be.true;
            expect(mockTableExplorerService.subset.calledWith("test-owner-uri", 0, 100)).to.be.true;
            expect(controller.state.currentRowCount).to.equal(100);
            expect(controller.state.resultSet?.rowCount).to.equal(2);
            expect(controller.state.loadStatus).to.equal(ApiStatus.Loaded);
        });

        test("should set loadStatus to Loading before loading and Loaded after", async () => {
            // Arrange
            controller.state.ownerUri = "test-owner-uri";
            controller.state.newRows = [];
            controller.state.loadStatus = ApiStatus.Loaded;
            const mockResult = createMockSubsetResult(2);

            let loadStatusDuringFetch: ApiStatus | undefined;
            mockTableExplorerService.subset.callsFake(async () => {
                loadStatusDuringFetch = controller.state.loadStatus;
                return mockResult;
            });

            // Act
            await controller["_reducerHandlers"].get("loadSubset")(controller.state, {
                rowCount: 50,
            });

            // Assert
            expect(loadStatusDuringFetch).to.equal(ApiStatus.Loading);
            expect(controller.state.loadStatus).to.equal(ApiStatus.Loaded);
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
            expect(controller.state.resultSet?.rowCount).to.equal(3); // 2 from DB + 1 new
            expect(controller.state.resultSet?.subset).to.have.length(3);
            expect(controller.state.resultSet?.subset[2].id).to.equal(100);
        });

        test("should show error message when loadSubset fails", async () => {
            // Arrange
            controller.state.ownerUri = "test-owner-uri";
            controller.state.loadStatus = ApiStatus.Loaded;
            const error = new Error("Load failed");
            mockTableExplorerService.subset.rejects(error);

            // Act
            await controller["_reducerHandlers"].get("loadSubset")(controller.state, {
                rowCount: 100,
            });

            // Assert
            expect(showErrorMessageStub.calledOnce).to.be.true;
            expect(showErrorMessageStub.firstCall.args[0]).to.include("Failed to load data");
            expect(controller.state.loadStatus).to.equal(ApiStatus.Error);
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
            expect(mockTableExplorerService.createRow.calledOnceWith("test-owner-uri")).to.be.true;
            expect(
                showInformationMessageStub.calledOnceWith(
                    LocConstants.TableExplorer.rowCreatedSuccessfully,
                ),
            ).to.be.true;
            expect(controller.state.newRows).to.have.length(1);
            expect(controller.state.newRows[0].id).to.equal(100);
            expect(controller.state.resultSet?.rowCount).to.equal(3);
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
            expect(mockTableExplorerService.generateScripts.calledOnce).to.be.true;
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
            expect(showErrorMessageStub.calledOnce).to.be.true;
            expect(showErrorMessageStub.firstCall.args[0]).to.include("Failed to create a new row");
        });
    });

    suite("deleteRow reducer", () => {
        test("should flag row for delete, but not remove from resultSet", async () => {
            // Arrange
            controller.state.ownerUri = "test-owner-uri";
            controller.state.resultSet = createMockSubsetResult(2);
            mockTableExplorerService.deleteRow.resolves({});

            // Act
            await controller["_reducerHandlers"].get("deleteRow")(controller.state, { rowId: 0 });

            // Assert
            expect(mockTableExplorerService.deleteRow.calledOnceWith("test-owner-uri", 0)).to.be
                .true;
            expect(
                showInformationMessageStub.calledOnceWith(
                    LocConstants.TableExplorer.rowMarkedForRemoval,
                ),
            ).to.be.true;
            // Row should still be in resultSet (not physically removed, just marked for deletion)
            expect(controller.state.resultSet?.rowCount).to.equal(2);
            expect(controller.state.resultSet?.subset).to.have.length(2);
            // Row should be tracked in deletedRows array
            expect(controller.state.deletedRows).to.include(0);
            expect(controller.state.deletedRows).to.have.length(1);
        });

        test("should completely remove newly created row from UI when deleted", async () => {
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
            // New row should be removed from newRows tracking array
            expect(controller.state.newRows).to.have.length(0);
            // Row should be completely removed from resultSet (not just marked for deletion)
            // because the backend completely removes newly created rows
            expect(controller.state.resultSet?.rowCount).to.equal(2);
            expect(controller.state.resultSet?.subset).to.have.length(2);
            // Row should NOT be tracked in deletedRows (it's gone, not pending deletion)
            expect(controller.state.deletedRows).to.not.include(100);
            expect(controller.state.deletedRows).to.have.length(0);
            // Should show "Row deleted" message instead of "Row marked for removal"
            expect(
                showInformationMessageStub.calledOnceWith(
                    LocConstants.TableExplorer.rowDeletedSuccessfully,
                ),
            ).to.be.true;
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
            expect(mockTableExplorerService.generateScripts.calledOnce).to.be.true;
        });

        test("should show error message when deleteRow fails", async () => {
            // Arrange
            controller.state.ownerUri = "test-owner-uri";
            const error = new Error("Delete row failed");
            mockTableExplorerService.deleteRow.rejects(error);

            // Act
            await controller["_reducerHandlers"].get("deleteRow")(controller.state, { rowId: 0 });

            // Assert
            expect(showErrorMessageStub.calledOnce).to.be.true;
            expect(showErrorMessageStub.firstCall.args[0]).to.include("Failed to remove row");
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
            expect(
                mockTableExplorerService.updateCell.calledOnceWith(
                    "test-owner-uri",
                    0,
                    1,
                    "Updated",
                ),
            ).to.be.true;
            expect(controller.state.resultSet?.subset[0].cells[1].displayValue).to.equal("Updated");
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
            expect(mockTableExplorerService.generateScripts.calledOnce).to.be.true;
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
            expect(showErrorMessageStub.calledOnce).to.be.true;
            expect(showErrorMessageStub.firstCall.args[0]).to.include("Failed to update cell");
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
            expect(mockTableExplorerService.revertCell.calledOnceWith("test-owner-uri", 0, 1)).to.be
                .true;
            expect(controller.state.resultSet?.subset[0].cells[1].displayValue).to.equal("John");
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
            expect(mockTableExplorerService.generateScripts.calledOnce).to.be.true;
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
            expect(showErrorMessageStub.calledOnce).to.be.true;
            expect(showErrorMessageStub.firstCall.args[0]).to.include("Failed to revert cell");
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
            expect(mockTableExplorerService.revertRow.calledOnceWith("test-owner-uri", 0)).to.be
                .true;
            expect(controller.state.resultSet?.subset[0].cells[1].displayValue).to.equal("John");
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
            expect(mockTableExplorerService.generateScripts.calledOnce).to.be.true;
        });

        test("should show error message when revertRow fails", async () => {
            // Arrange
            controller.state.ownerUri = "test-owner-uri";
            const error = new Error("Revert row failed");
            mockTableExplorerService.revertRow.rejects(error);

            // Act
            await controller["_reducerHandlers"].get("revertRow")(controller.state, { rowId: 0 });

            // Assert
            expect(showErrorMessageStub.calledOnce).to.be.true;
            expect(showErrorMessageStub.firstCall.args[0]).to.include("Failed to revert row");
        });

        test("should remove newly created row from UI when revert returns null", async () => {
            // Arrange
            controller.state.ownerUri = "test-owner-uri";
            const newRow = createMockRow(2, ["3", "New", "User"]);
            newRow.state = EditRowState.dirtyInsert;
            controller.state.newRows = [newRow];
            controller.state.resultSet = {
                ...createMockSubsetResult(3),
                subset: [
                    createMockRow(0, ["1", "John", "Doe"]),
                    createMockRow(1, ["2", "Jane", "Smith"]),
                    newRow,
                ],
                rowCount: 3,
            };

            // When reverting a newly created row, the server returns null
            const revertedRow: EditRevertRowResult = {
                row: undefined as any,
            };
            mockTableExplorerService.revertRow.resolves(revertedRow);

            // Act
            await controller["_reducerHandlers"].get("revertRow")(controller.state, { rowId: 2 });

            // Assert
            expect(mockTableExplorerService.revertRow.calledOnceWith("test-owner-uri", 2)).to.be
                .true;
            expect(controller.state.newRows.length).to.equal(0);
            expect(controller.state.resultSet?.subset.length).to.equal(2);
            expect(controller.state.resultSet?.rowCount).to.equal(2);
            expect(controller.state.resultSet?.subset.find((r) => r.id === 2)).to.be.undefined;
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
            expect(mockTableExplorerService.generateScripts.calledOnceWith("test-owner-uri")).to.be
                .true;
            expect(controller.state.updateScript).to.include("UPDATE TestTable");
            expect(controller.state.updateScript).to.include("DELETE FROM TestTable");
            expect(controller.state.showScriptPane).to.be.true;
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
            expect(controller.state.updateScript).to.equal("");
            expect(controller.state.showScriptPane).to.be.true;
        });

        test("should show error message when generateScript fails", async () => {
            // Arrange
            controller.state.ownerUri = "test-owner-uri";
            const error = new Error("Generate script failed");
            mockTableExplorerService.generateScripts.rejects(error);

            // Act
            await controller["_reducerHandlers"].get("generateScript")(controller.state, {});

            // Assert
            expect(showErrorMessageStub.calledOnce).to.be.true;
            expect(showErrorMessageStub.firstCall.args[0]).to.include("Failed to generate script");
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
            expect(openTextDocumentStub.calledOnce).to.be.true;
            const callArgs = openTextDocumentStub.firstCall.args[0];
            expect(callArgs.content).to.equal("SELECT * FROM TestTable;");
            expect(callArgs.language).to.equal("sql");
            expect(showTextDocumentStub.calledOnceWith(mockDocument)).to.be.true;
        });

        test("should show warning when no script to open", async () => {
            // Arrange
            controller.state.updateScript = undefined;

            // Act
            await controller["_reducerHandlers"].get("openScriptInEditor")(controller.state, {});

            // Assert
            expect(openTextDocumentStub.notCalled).to.be.true;
            expect(showWarningMessageStub.calledOnceWith(LocConstants.TableExplorer.noScriptToOpen))
                .to.be.true;
        });

        test("should show error message when opening script fails", async () => {
            // Arrange
            controller.state.updateScript = "SELECT * FROM TestTable;";
            const error = new Error("Open failed");
            openTextDocumentStub.rejects(error);

            // Act
            await controller["_reducerHandlers"].get("openScriptInEditor")(controller.state, {});

            // Assert
            expect(showErrorMessageStub.calledOnce).to.be.true;
            expect(showErrorMessageStub.firstCall.args[0]).to.include("Failed to open script");
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
            expect(writeTextStub.calledOnceWith("SELECT * FROM TestTable;")).to.be.true;
            expect(
                showInformationMessageStub.calledOnceWith(
                    LocConstants.TableExplorer.scriptCopiedToClipboard,
                ),
            ).to.be.true;
        });

        test("should show warning when no script to copy", async () => {
            // Arrange
            controller.state.updateScript = undefined;

            // Act
            await controller["_reducerHandlers"].get("copyScriptToClipboard")(controller.state, {});

            // Assert
            expect(writeTextStub.notCalled).to.be.true;
            expect(showWarningMessageStub.calledOnceWith(LocConstants.TableExplorer.noScriptToCopy))
                .to.be.true;
        });

        test("should show error message when copying script fails", async () => {
            // Arrange
            controller.state.updateScript = "SELECT * FROM TestTable;";
            const error = new Error("Copy failed");
            writeTextStub.rejects(error);

            // Act
            await controller["_reducerHandlers"].get("copyScriptToClipboard")(controller.state, {});

            // Assert
            expect(showErrorMessageStub.calledOnce).to.be.true;
            expect(showErrorMessageStub.firstCall.args[0]).to.include("Failed to copy script");
        });
    });

    suite("toggleScriptPane reducer", () => {
        test("should toggle script pane from false to true", async () => {
            // Arrange
            controller.state.showScriptPane = false;

            // Act
            await controller["_reducerHandlers"].get("toggleScriptPane")(controller.state, {});

            // Assert
            expect(controller.state.showScriptPane).to.be.true;
        });

        test("should toggle script pane from true to false", async () => {
            // Arrange
            controller.state.showScriptPane = true;

            // Act
            await controller["_reducerHandlers"].get("toggleScriptPane")(controller.state, {});

            // Assert
            expect(controller.state.showScriptPane).to.be.false;
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
            expect(controller.state.currentPage).to.equal(5);
        });

        test("should update page number multiple times", async () => {
            // Arrange
            controller.state.currentPage = 1;

            // Act & Assert
            await controller["_reducerHandlers"].get("setCurrentPage")(controller.state, {
                pageNumber: 2,
            });
            expect(controller.state.currentPage).to.equal(2);

            await controller["_reducerHandlers"].get("setCurrentPage")(controller.state, {
                pageNumber: 10,
            });
            expect(controller.state.currentPage).to.equal(10);
        });
    });

    suite("saveResults reducer", () => {
        const mockHeaders = ["id", "firstName", "lastName"];
        const mockRows = [
            ["1", "John", "Doe"],
            ["2", "Jane", "Smith"],
        ];

        test("should save results as CSV format", async () => {
            // Arrange
            controller.state.tableName = "TestTable";
            const mockUri = vscode.Uri.file("/path/to/export.csv");
            showSaveDialogStub.resolves(mockUri);
            writeFileStub.resolves();

            // Act
            await controller["_reducerHandlers"].get("saveResults")(controller.state, {
                format: "csv",
                data: { headers: mockHeaders, rows: mockRows },
            });

            // Assert
            expect(showSaveDialogStub.calledOnce).to.be.true;
            const saveDialogOptions = showSaveDialogStub.firstCall.args[0];
            expect(saveDialogOptions.filters).to.deep.equal({
                "CSV Files": ["csv"],
                "All Files": ["*"],
            });
            expect(writeFileStub.calledOnce).to.be.true;

            // Verify CSV content
            const writtenContent = writeFileStub.firstCall.args[1].toString();
            expect(writtenContent).to.include("id,firstName,lastName");
            expect(writtenContent).to.include("1,John,Doe");
            expect(writtenContent).to.include("2,Jane,Smith");

            expect(showInformationMessageStub.calledOnce).to.be.true;
        });

        test("should save results as JSON format", async () => {
            // Arrange
            controller.state.tableName = "TestTable";
            const mockUri = vscode.Uri.file("/path/to/export.json");
            showSaveDialogStub.resolves(mockUri);
            writeFileStub.resolves();

            // Act
            await controller["_reducerHandlers"].get("saveResults")(controller.state, {
                format: "json",
                data: { headers: mockHeaders, rows: mockRows },
            });

            // Assert
            expect(showSaveDialogStub.calledOnce).to.be.true;
            const saveDialogOptions = showSaveDialogStub.firstCall.args[0];
            expect(saveDialogOptions.filters).to.deep.equal({
                "JSON Files": ["json"],
                "All Files": ["*"],
            });
            expect(writeFileStub.calledOnce).to.be.true;

            // Verify JSON content
            const writtenContent = writeFileStub.firstCall.args[1].toString();
            const parsedJson = JSON.parse(writtenContent);
            expect(parsedJson).to.have.length(2);
            expect(parsedJson[0]).to.deep.equal({ id: "1", firstName: "John", lastName: "Doe" });
            expect(parsedJson[1]).to.deep.equal({ id: "2", firstName: "Jane", lastName: "Smith" });

            expect(showInformationMessageStub.calledOnce).to.be.true;
        });

        test("should save results as Excel format", async () => {
            // Arrange
            controller.state.tableName = "TestTable";
            const mockUri = vscode.Uri.file("/path/to/export.xlsx");
            showSaveDialogStub.resolves(mockUri);
            writeFileStub.resolves();

            // Act
            await controller["_reducerHandlers"].get("saveResults")(controller.state, {
                format: "excel",
                data: { headers: mockHeaders, rows: mockRows },
            });

            // Assert
            expect(showSaveDialogStub.calledOnce).to.be.true;
            const saveDialogOptions = showSaveDialogStub.firstCall.args[0];
            expect(saveDialogOptions.filters).to.deep.equal({
                "Excel Files": ["xlsx"],
                "All Files": ["*"],
            });
            expect(writeFileStub.calledOnce).to.be.true;

            // Verify that Excel file was written (should be binary data)
            const writtenContent = writeFileStub.firstCall.args[1];
            expect(writtenContent).to.be.instanceof(Uint8Array);
            expect(writtenContent.length).to.be.greaterThan(0);

            expect(showInformationMessageStub.calledOnce).to.be.true;
        });

        test("should handle user cancelling save dialog", async () => {
            // Arrange
            controller.state.tableName = "TestTable";
            showSaveDialogStub.resolves(undefined); // User cancelled

            // Act
            await controller["_reducerHandlers"].get("saveResults")(controller.state, {
                format: "csv",
                data: { headers: mockHeaders, rows: mockRows },
            });

            // Assert
            expect(showSaveDialogStub.calledOnce).to.be.true;
            expect(writeFileStub.notCalled).to.be.true;
            expect(showInformationMessageStub.notCalled).to.be.true;
            expect(showErrorMessageStub.notCalled).to.be.true;
        });

        test("should show error message when save fails", async () => {
            // Arrange
            controller.state.tableName = "TestTable";
            const mockUri = vscode.Uri.file("/path/to/export.csv");
            showSaveDialogStub.resolves(mockUri);
            const error = new Error("Write failed");
            writeFileStub.rejects(error);

            // Act
            await controller["_reducerHandlers"].get("saveResults")(controller.state, {
                format: "csv",
                data: { headers: mockHeaders, rows: mockRows },
            });

            // Assert
            expect(showSaveDialogStub.calledOnce).to.be.true;
            expect(writeFileStub.calledOnce).to.be.true;
            expect(showErrorMessageStub.calledOnce).to.be.true;
            expect(showErrorMessageStub.firstCall.args[0]).to.include("Write failed");
        });

        test("should escape CSV values containing commas", async () => {
            // Arrange
            controller.state.tableName = "TestTable";
            const mockUri = vscode.Uri.file("/path/to/export.csv");
            showSaveDialogStub.resolves(mockUri);
            writeFileStub.resolves();
            const headersWithComma = ["name", "address"];
            const rowsWithComma = [["John", "123 Main St, Apt 4"]];

            // Act
            await controller["_reducerHandlers"].get("saveResults")(controller.state, {
                format: "csv",
                data: { headers: headersWithComma, rows: rowsWithComma },
            });

            // Assert
            const writtenContent = writeFileStub.firstCall.args[1].toString();
            expect(writtenContent).to.include('"123 Main St, Apt 4"');
        });

        test("should escape CSV values containing quotes", async () => {
            // Arrange
            controller.state.tableName = "TestTable";
            const mockUri = vscode.Uri.file("/path/to/export.csv");
            showSaveDialogStub.resolves(mockUri);
            writeFileStub.resolves();
            const headers = ["name", "description"];
            const rowsWithQuotes = [["Product", 'He said "hello"']];

            // Act
            await controller["_reducerHandlers"].get("saveResults")(controller.state, {
                format: "csv",
                data: { headers: headers, rows: rowsWithQuotes },
            });

            // Assert
            const writtenContent = writeFileStub.firstCall.args[1].toString();
            expect(writtenContent).to.include('"He said ""hello"""');
        });

        test("should convert empty strings to null in JSON format", async () => {
            // Arrange
            controller.state.tableName = "TestTable";
            const mockUri = vscode.Uri.file("/path/to/export.json");
            showSaveDialogStub.resolves(mockUri);
            writeFileStub.resolves();
            const headers = ["name", "nickname"];
            const rowsWithEmpty = [["John", ""]];

            // Act
            await controller["_reducerHandlers"].get("saveResults")(controller.state, {
                format: "json",
                data: { headers: headers, rows: rowsWithEmpty },
            });

            // Assert
            const writtenContent = writeFileStub.firstCall.args[1].toString();
            const parsedJson = JSON.parse(writtenContent);
            expect(parsedJson[0].nickname).to.be.null;
        });
    });
});
