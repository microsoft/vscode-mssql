/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as sinon from "sinon";
import { expect } from "chai";
import { TableExplorerService } from "../../src/services/tableExplorerService";
import SqlToolsServiceClient from "../../src/languageservice/serviceclient";
import {
  EditCommitRequest,
  EditCreateRowRequest,
  EditDeleteRowRequest,
  EditDisposeRequest,
  EditInitializeRequest,
  EditRevertCellRequest,
  EditRevertRowRequest,
  EditScriptRequest,
  EditSubsetRequest,
  EditUpdateCellRequest,
} from "../../src/models/contracts/tableExplorer";
import {
  EditCommitResult,
  EditCreateRowResult,
  EditDeleteRowResult,
  EditDisposeResult,
  EditInitializeResult,
  EditRevertCellResult,
  EditRevertRowResult,
  EditRowState,
  EditScriptResult,
  EditSubsetResult,
  EditUpdateCellResult,
} from "../../src/sharedInterfaces/tableExplorer";
import { Logger } from "../../src/models/logger";

suite("TableExplorerService Tests", () => {
  let sandbox: sinon.SinonSandbox;
  let mockClient: sinon.SinonStubbedInstance<SqlToolsServiceClient>;
  let mockLogger: sinon.SinonStubbedInstance<Logger>;
  let tableExplorerService: TableExplorerService;

  setup(() => {
    sandbox = sinon.createSandbox();
    mockClient = sandbox.createStubInstance(SqlToolsServiceClient);
    mockLogger = sandbox.createStubInstance(Logger);

    sandbox.stub(mockClient, "logger").get(() => mockLogger);

    tableExplorerService = new TableExplorerService(mockClient);
  });

  teardown(() => {
    sandbox.restore();
  });

  suite("constructor and properties", () => {
    test("should initialize with SqlToolsServiceClient", () => {
      expect(tableExplorerService).to.not.be.undefined;
      expect(tableExplorerService.sqlToolsClient).to.equal(mockClient);
    });

    test("sqlToolsClient getter should return the client instance", () => {
      const client = tableExplorerService.sqlToolsClient;
      expect(client).to.equal(mockClient);
    });
  });

  suite("initialize", () => {
    const ownerUri = "test-owner-uri";
    const objectName = "TestTable";
    const schemaName = "dbo";
    const objectType = "Table";
    const queryString = "SELECT * FROM TestTable";
    const limitResults = 100;

    test("should successfully initialize with all parameters", async () => {
      const mockResult: EditInitializeResult = {};

      mockClient.sendRequest
        .withArgs(EditInitializeRequest.type, sinon.match.any)
        .resolves(mockResult);

      const result = await tableExplorerService.initialize(
        ownerUri,
        objectName,
        schemaName,
        objectType,
        queryString,
        limitResults,
      );

      expect(result).to.equal(mockResult);
      expect(mockClient.sendRequest.calledOnce).to.be.true;

      const callArgs = mockClient.sendRequest.firstCall.args;
      expect(callArgs[0]).to.equal(EditInitializeRequest.type);
      expect(callArgs[1]).to.deep.equal({
        ownerUri: ownerUri,
        filters: { LimitResults: limitResults },
        objectName: objectName,
        schemaName: schemaName,
        objectType: objectType,
        queryString: queryString,
      });
    });

    test("should initialize without limit results", async () => {
      const mockResult: EditInitializeResult = {};

      mockClient.sendRequest
        .withArgs(EditInitializeRequest.type, sinon.match.any)
        .resolves(mockResult);

      const result = await tableExplorerService.initialize(
        ownerUri,
        objectName,
        schemaName,
        objectType,
        queryString,
      );

      expect(result).to.equal(mockResult);

      const callArgs = mockClient.sendRequest.firstCall.args;
      expect((callArgs[1] as any).filters.LimitResults).to.be.undefined;
    });

    test("should initialize without query string", async () => {
      const mockResult: EditInitializeResult = {};

      mockClient.sendRequest
        .withArgs(EditInitializeRequest.type, sinon.match.any)
        .resolves(mockResult);

      const result = await tableExplorerService.initialize(
        ownerUri,
        objectName,
        schemaName,
        objectType,
        undefined,
        limitResults,
      );

      expect(result).to.equal(mockResult);

      const callArgs = mockClient.sendRequest.firstCall.args;
      expect((callArgs[1] as any).queryString).to.be.undefined;
    });

    test("should handle initialization error and log it", async () => {
      const error = new Error("Initialization failed");
      mockClient.sendRequest
        .withArgs(EditInitializeRequest.type, sinon.match.any)
        .rejects(error);

      try {
        await tableExplorerService.initialize(
          ownerUri,
          objectName,
          schemaName,
          objectType,
          queryString,
          limitResults,
        );
        expect.fail("Should have thrown an error");
      } catch (err) {
        expect(err).to.equal(error);
        expect(mockLogger.error.calledOnce).to.be.true;
        expect(mockLogger.error.firstCall.args[0]).to.equal(
          "Initialization failed",
        );
      }
    });
  });

  suite("subset", () => {
    const ownerUri = "test-owner-uri";
    const rowStartIndex = 0;
    const rowCount = 50;

    test("should successfully retrieve subset of rows", async () => {
      const mockResult: EditSubsetResult = {
        rowCount: 50,
        subset: [
          {
            cells: [
              {
                displayValue: "1",
                isNull: false,
                invariantCultureDisplayValue: "1",
              },
              {
                displayValue: "Test",
                isNull: false,
                invariantCultureDisplayValue: "Test",
              },
            ],
            id: 0,
            isDirty: false,
            state: EditRowState.clean,
          },
        ],
        columnInfo: [
          { name: "Id", isEditable: true },
          { name: "Name", isEditable: true },
        ],
      };

      mockClient.sendRequest
        .withArgs(EditSubsetRequest.type, sinon.match.any)
        .resolves(mockResult);

      const result = await tableExplorerService.subset(
        ownerUri,
        rowStartIndex,
        rowCount,
      );

      expect(result).to.equal(mockResult);
      expect(mockClient.sendRequest.calledOnce).to.be.true;

      const callArgs = mockClient.sendRequest.firstCall.args;
      expect(callArgs[0]).to.equal(EditSubsetRequest.type);
      expect(callArgs[1]).to.deep.equal({
        ownerUri: ownerUri,
        rowStartIndex: rowStartIndex,
        rowCount: rowCount,
      });
    });

    test("should handle subset request with different row indices", async () => {
      const mockResult: EditSubsetResult = {
        rowCount: 25,
        subset: [],
        columnInfo: [],
      };

      mockClient.sendRequest
        .withArgs(EditSubsetRequest.type, sinon.match.any)
        .resolves(mockResult);

      const result = await tableExplorerService.subset(ownerUri, 100, 25);

      expect(result).to.equal(mockResult);

      await tableExplorerService.subset(ownerUri, 100, 25);

      const callArgs = mockClient.sendRequest.firstCall.args;
      expect((callArgs[1] as any).rowStartIndex).to.equal(100);
      expect((callArgs[1] as any).rowCount).to.equal(25);
    });

    test("should handle subset error and log it", async () => {
      const error = new Error("Subset request failed");
      mockClient.sendRequest
        .withArgs(EditSubsetRequest.type, sinon.match.any)
        .rejects(error);

      try {
        await tableExplorerService.subset(ownerUri, rowStartIndex, rowCount);
        expect.fail("Should have thrown an error");
      } catch (err) {
        expect(err).to.equal(error);
        expect(mockLogger.error.calledOnce).to.be.true;
        expect(mockLogger.error.firstCall.args[0]).to.equal(
          "Subset request failed",
        );
      }
    });
  });

  suite("commit", () => {
    const ownerUri = "test-owner-uri";

    test("should successfully commit changes", async () => {
      const mockResult: EditCommitResult = {};

      mockClient.sendRequest
        .withArgs(EditCommitRequest.type, sinon.match.any)
        .resolves(mockResult);

      const result = await tableExplorerService.commit(ownerUri);

      expect(result).to.equal(mockResult);
      expect(mockClient.sendRequest.calledOnce).to.be.true;

      const callArgs = mockClient.sendRequest.firstCall.args;
      expect(callArgs[0]).to.equal(EditCommitRequest.type);
      expect(callArgs[1]).to.deep.equal({
        ownerUri: ownerUri,
      });
    });

    test("should handle commit error and log it", async () => {
      const error = new Error("Commit failed");
      mockClient.sendRequest
        .withArgs(EditCommitRequest.type, sinon.match.any)
        .rejects(error);

      try {
        await tableExplorerService.commit(ownerUri);
        expect.fail("Should have thrown an error");
      } catch (err) {
        expect(err).to.equal(error);
        expect(mockLogger.error.calledOnce).to.be.true;
        expect(mockLogger.error.firstCall.args[0]).to.equal("Commit failed");
      }
    });
  });

  suite("createRow", () => {
    const ownerUri = "test-owner-uri";

    test("should successfully create a new row", async () => {
      const mockResult: EditCreateRowResult = {
        defaultValues: ["NULL", "Default Value"],
        newRowId: 42,
        row: {
          cells: [
            {
              displayValue: "NULL",
              isNull: true,
              invariantCultureDisplayValue: "NULL",
            },
            {
              displayValue: "Default Value",
              isNull: false,
              invariantCultureDisplayValue: "Default Value",
            },
          ],
          id: 42,
          isDirty: true,
          state: EditRowState.dirtyInsert,
        },
      };

      mockClient.sendRequest
        .withArgs(EditCreateRowRequest.type, sinon.match.any)
        .resolves(mockResult);

      const result = await tableExplorerService.createRow(ownerUri);

      expect(result).to.equal(mockResult);
      expect(mockClient.sendRequest.calledOnce).to.be.true;

      const callArgs = mockClient.sendRequest.firstCall.args;
      expect(callArgs[0]).to.equal(EditCreateRowRequest.type);
      expect(callArgs[1]).to.deep.equal({
        ownerUri: ownerUri,
      });
    });

    test("should handle createRow error and log it", async () => {
      const error = new Error("Create row failed");
      mockClient.sendRequest
        .withArgs(EditCreateRowRequest.type, sinon.match.any)
        .rejects(error);

      try {
        await tableExplorerService.createRow(ownerUri);
        expect.fail("Should have thrown an error");
      } catch (err) {
        expect(err).to.equal(error);
        expect(mockLogger.error.calledOnce).to.be.true;
        expect(mockLogger.error.firstCall.args[0]).to.equal(
          "Create row failed",
        );
      }
    });
  });

  suite("deleteRow", () => {
    const ownerUri = "test-owner-uri";
    const rowId = 5;

    test("should successfully delete a row", async () => {
      const mockResult: EditDeleteRowResult = {};

      mockClient.sendRequest
        .withArgs(EditDeleteRowRequest.type, sinon.match.any)
        .resolves(mockResult);

      const result = await tableExplorerService.deleteRow(ownerUri, rowId);

      expect(result).to.equal(mockResult);
      expect(mockClient.sendRequest.calledOnce).to.be.true;

      const callArgs = mockClient.sendRequest.firstCall.args;
      expect(callArgs[0]).to.equal(EditDeleteRowRequest.type);
      expect(callArgs[1]).to.deep.equal({
        ownerUri: ownerUri,
        rowId: rowId,
      });
    });

    test("should handle deleteRow with different row IDs", async () => {
      const mockResult: EditDeleteRowResult = {};
      mockClient.sendRequest
        .withArgs(EditDeleteRowRequest.type, sinon.match.any)
        .resolves(mockResult);

      await tableExplorerService.deleteRow(ownerUri, 999);

      const callArgs = mockClient.sendRequest.firstCall.args;
      expect((callArgs[1] as any).rowId).to.equal(999);
    });

    test("should handle deleteRow error and log it", async () => {
      const error = new Error("Delete row failed");
      mockClient.sendRequest
        .withArgs(EditDeleteRowRequest.type, sinon.match.any)
        .rejects(error);

      try {
        await tableExplorerService.deleteRow(ownerUri, rowId);
        expect.fail("Should have thrown an error");
      } catch (err) {
        expect(err).to.equal(error);
        expect(mockLogger.error.calledOnce).to.be.true;
        expect(mockLogger.error.firstCall.args[0]).to.equal(
          "Delete row failed",
        );
      }
    });
  });

  suite("revertRow", () => {
    const ownerUri = "test-owner-uri";
    const rowId = 3;

    test("should successfully revert a row", async () => {
      const mockResult: EditRevertRowResult = {
        row: {
          cells: [
            {
              displayValue: "Original",
              isNull: false,
              invariantCultureDisplayValue: "Original",
            },
          ],
          id: rowId,
          isDirty: false,
          state: EditRowState.clean,
        },
      };

      mockClient.sendRequest
        .withArgs(EditRevertRowRequest.type, sinon.match.any)
        .resolves(mockResult);

      const result = await tableExplorerService.revertRow(ownerUri, rowId);

      expect(result).to.equal(mockResult);
      expect(mockClient.sendRequest.calledOnce).to.be.true;

      const callArgs = mockClient.sendRequest.firstCall.args;
      expect(callArgs[0]).to.equal(EditRevertRowRequest.type);
      expect(callArgs[1]).to.deep.equal({
        ownerUri: ownerUri,
        rowId: rowId,
      });
    });

    test("should handle revertRow error and log it", async () => {
      const error = new Error("Revert row failed");
      mockClient.sendRequest
        .withArgs(EditRevertRowRequest.type, sinon.match.any)
        .rejects(error);

      try {
        await tableExplorerService.revertRow(ownerUri, rowId);
        expect.fail("Should have thrown an error");
      } catch (err) {
        expect(err).to.equal(error);
        expect(mockLogger.error.calledOnce).to.be.true;
        expect(mockLogger.error.firstCall.args[0]).to.equal(
          "Revert row failed",
        );
      }
    });
  });

  suite("updateCell", () => {
    const ownerUri = "test-owner-uri";
    const rowId = 2;
    const columnId = 1;
    const newValue = "Updated Value";

    test("should successfully update a cell", async () => {
      const mockResult: EditUpdateCellResult = {
        cell: {
          displayValue: newValue,
          isNull: false,
          invariantCultureDisplayValue: newValue,
          isDirty: true,
        },
        isRowDirty: true,
      };

      mockClient.sendRequest
        .withArgs(EditUpdateCellRequest.type, sinon.match.any)
        .resolves(mockResult);

      const result = await tableExplorerService.updateCell(
        ownerUri,
        rowId,
        columnId,
        newValue,
      );

      expect(result).to.equal(mockResult);
      expect(mockClient.sendRequest.calledOnce).to.be.true;

      const callArgs = mockClient.sendRequest.firstCall.args;
      expect(callArgs[0]).to.equal(EditUpdateCellRequest.type);
      expect(callArgs[1]).to.deep.equal({
        ownerUri: ownerUri,
        rowId: rowId,
        columnId: columnId,
        newValue: newValue,
      });
    });

    test("should handle updateCell with empty string value", async () => {
      const mockResult: EditUpdateCellResult = {
        cell: {
          displayValue: "",
          isNull: false,
          invariantCultureDisplayValue: "",
          isDirty: true,
        },
        isRowDirty: true,
      };

      mockClient.sendRequest
        .withArgs(EditUpdateCellRequest.type, sinon.match.any)
        .resolves(mockResult);

      const result = await tableExplorerService.updateCell(
        ownerUri,
        rowId,
        columnId,
        "",
      );

      expect(result).to.equal(mockResult);

      const callArgs = mockClient.sendRequest.firstCall.args;
      expect((callArgs[1] as any).newValue).to.equal("");
    });

    test("should handle updateCell error and log it", async () => {
      const error = new Error("Update cell failed");
      mockClient.sendRequest
        .withArgs(EditUpdateCellRequest.type, sinon.match.any)
        .rejects(error);

      try {
        await tableExplorerService.updateCell(
          ownerUri,
          rowId,
          columnId,
          newValue,
        );
        expect.fail("Should have thrown an error");
      } catch (err) {
        expect(err).to.equal(error);
        expect(mockLogger.error.calledOnce).to.be.true;
        expect(mockLogger.error.firstCall.args[0]).to.equal(
          "Update cell failed",
        );
      }
    });
  });

  suite("revertCell", () => {
    const ownerUri = "test-owner-uri";
    const rowId = 4;
    const columnId = 2;

    test("should successfully revert a cell", async () => {
      const mockResult: EditRevertCellResult = {
        cell: {
          displayValue: "Original Value",
          isNull: false,
          invariantCultureDisplayValue: "Original Value",
          isDirty: false,
        },
        isRowDirty: false,
      };

      mockClient.sendRequest
        .withArgs(EditRevertCellRequest.type, sinon.match.any)
        .resolves(mockResult);

      const result = await tableExplorerService.revertCell(
        ownerUri,
        rowId,
        columnId,
      );

      expect(result).to.equal(mockResult);
      expect(mockClient.sendRequest.calledOnce).to.be.true;

      const callArgs = mockClient.sendRequest.firstCall.args;
      expect(callArgs[0]).to.equal(EditRevertCellRequest.type);
      expect(callArgs[1]).to.deep.equal({
        ownerUri: ownerUri,
        rowId: rowId,
        columnId: columnId,
      });
    });

    test("should handle revertCell with different row and column IDs", async () => {
      const mockResult: EditRevertCellResult = {
        cell: {
          displayValue: "Value",
          isNull: false,
          invariantCultureDisplayValue: "Value",
          isDirty: false,
        },
        isRowDirty: true,
      };

      mockClient.sendRequest
        .withArgs(EditRevertCellRequest.type, sinon.match.any)
        .resolves(mockResult);

      await tableExplorerService.revertCell(ownerUri, 10, 5);

      const callArgs = mockClient.sendRequest.firstCall.args;
      expect((callArgs[1] as any).rowId).to.equal(10);
      expect((callArgs[1] as any).columnId).to.equal(5);
    });

    test("should handle revertCell error and log it", async () => {
      const error = new Error("Revert cell failed");
      mockClient.sendRequest
        .withArgs(EditRevertCellRequest.type, sinon.match.any)
        .rejects(error);

      try {
        await tableExplorerService.revertCell(ownerUri, rowId, columnId);
        expect.fail("Should have thrown an error");
      } catch (err) {
        expect(err).to.equal(error);
        expect(mockLogger.error.calledOnce).to.be.true;
        expect(mockLogger.error.firstCall.args[0]).to.equal(
          "Revert cell failed",
        );
      }
    });
  });

  suite("dispose", () => {
    const ownerUri = "test-owner-uri";

    test("should successfully dispose resources", async () => {
      const mockResult: EditDisposeResult = {};

      mockClient.sendRequest
        .withArgs(EditDisposeRequest.type, sinon.match.any)
        .resolves(mockResult);

      const result = await tableExplorerService.dispose(ownerUri);

      expect(result).to.equal(mockResult);
      expect(mockClient.sendRequest.calledOnce).to.be.true;

      const callArgs = mockClient.sendRequest.firstCall.args;
      expect(callArgs[0]).to.equal(EditDisposeRequest.type);
      expect(callArgs[1]).to.deep.equal({
        ownerUri: ownerUri,
      });
    });

    test("should handle dispose error and log it", async () => {
      const error = new Error("Dispose failed");
      mockClient.sendRequest
        .withArgs(EditDisposeRequest.type, sinon.match.any)
        .rejects(error);

      try {
        await tableExplorerService.dispose(ownerUri);
        expect.fail("Should have thrown an error");
      } catch (err) {
        expect(err).to.equal(error);
        expect(mockLogger.error.calledOnce).to.be.true;
        expect(mockLogger.error.firstCall.args[0]).to.equal("Dispose failed");
      }
    });
  });

  suite("generateScripts", () => {
    const ownerUri = "test-owner-uri";

    test("should successfully generate scripts", async () => {
      const mockResult: EditScriptResult = {
        scripts: ["UPDATE TestTable SET Name = 'Updated' WHERE Id = 1;"],
      };

      mockClient.sendRequest
        .withArgs(EditScriptRequest.type, sinon.match.any)
        .resolves(mockResult);

      const result = await tableExplorerService.generateScripts(ownerUri);

      expect(result).to.equal(mockResult);
      expect(mockClient.sendRequest.calledOnce).to.be.true;

      const callArgs = mockClient.sendRequest.firstCall.args;
      expect(callArgs[0]).to.equal(EditScriptRequest.type);
      expect(callArgs[1]).to.deep.equal({
        ownerUri: ownerUri,
      });
    });

    test("should return empty script when no changes exist", async () => {
      const mockResult: EditScriptResult = {
        scripts: [],
      };

      mockClient.sendRequest
        .withArgs(EditScriptRequest.type, sinon.match.any)
        .resolves(mockResult);

      const result = await tableExplorerService.generateScripts(ownerUri);

      expect(result.scripts).to.deep.equal([]);
    });

    test("should handle generateScripts error and log it", async () => {
      const error = new Error("Generate scripts failed");
      mockClient.sendRequest
        .withArgs(EditScriptRequest.type, sinon.match.any)
        .rejects(error);

      try {
        await tableExplorerService.generateScripts(ownerUri);
        expect.fail("Should have thrown an error");
      } catch (err) {
        expect(err).to.equal(error);
        expect(mockLogger.error.calledOnce).to.be.true;
        expect(mockLogger.error.firstCall.args[0]).to.equal(
          "Generate scripts failed",
        );
      }
    });
  });

  suite("error handling", () => {
    test("should log error with proper message format", async () => {
      const errorMessage = "Connection timeout";
      const error = new Error(errorMessage);
      mockClient.sendRequest.rejects(error);

      try {
        await tableExplorerService.initialize(
          "uri",
          "table",
          "schema",
          "type",
          undefined,
        );
        expect.fail("Should have thrown an error");
      } catch (err) {
        expect(mockLogger.error.calledOnce).to.be.true;
        expect(mockLogger.error.firstCall.args[0]).to.contain(errorMessage);
      }
    });

    test("should handle non-Error objects thrown", async () => {
      const errorString = "String error";
      mockClient.sendRequest.rejects(errorString);

      try {
        await tableExplorerService.commit("uri");
        expect.fail("Should have thrown an error");
      } catch (err) {
        expect(mockLogger.error.calledOnce).to.be.true;
      }
    });
  });

  suite("integration scenarios", () => {
    test("should handle complete edit session workflow", async () => {
      const ownerUri = "session-uri";

      // Initialize
      const initResult: EditInitializeResult = {};
      mockClient.sendRequest
        .withArgs(EditInitializeRequest.type, sinon.match.any)
        .resolves(initResult);
      await tableExplorerService.initialize(
        ownerUri,
        "Table",
        "dbo",
        "Table",
        undefined,
      );

      // Load subset
      const subsetResult: EditSubsetResult = {
        rowCount: 1,
        subset: [],
        columnInfo: [
          { name: "Id", isEditable: true },
          { name: "Name", isEditable: true },
        ],
      };
      mockClient.sendRequest
        .withArgs(EditSubsetRequest.type, sinon.match.any)
        .resolves(subsetResult);
      await tableExplorerService.subset(ownerUri, 0, 50);

      // Update cell
      const updateResult: EditUpdateCellResult = {
        cell: {
          displayValue: "New",
          isNull: false,
          invariantCultureDisplayValue: "New",
          isDirty: true,
        },
        isRowDirty: true,
      };
      mockClient.sendRequest
        .withArgs(EditUpdateCellRequest.type, sinon.match.any)
        .resolves(updateResult);
      await tableExplorerService.updateCell(ownerUri, 0, 1, "New");

      // Commit
      const commitResult: EditCommitResult = {};
      mockClient.sendRequest
        .withArgs(EditCommitRequest.type, sinon.match.any)
        .resolves(commitResult);
      await tableExplorerService.commit(ownerUri);

      // Dispose
      const disposeResult: EditDisposeResult = {};
      mockClient.sendRequest
        .withArgs(EditDisposeRequest.type, sinon.match.any)
        .resolves(disposeResult);
      await tableExplorerService.dispose(ownerUri);

      expect(mockClient.sendRequest.callCount).to.equal(5);
    });

    test("should handle row operations in sequence", async () => {
      const ownerUri = "row-ops-uri";

      // Create row
      const createResult: EditCreateRowResult = {
        defaultValues: [],
        newRowId: 1,
        row: {
          cells: [],
          id: 1,
          isDirty: true,
          state: EditRowState.dirtyInsert,
        },
      };
      mockClient.sendRequest
        .withArgs(EditCreateRowRequest.type, sinon.match.any)
        .resolves(createResult);
      const newRow = await tableExplorerService.createRow(ownerUri);

      // Update cell in new row
      const updateResult: EditUpdateCellResult = {
        cell: {
          displayValue: "Value",
          isNull: false,
          invariantCultureDisplayValue: "Value",
          isDirty: true,
        },
        isRowDirty: true,
      };
      mockClient.sendRequest
        .withArgs(EditUpdateCellRequest.type, sinon.match.any)
        .resolves(updateResult);
      await tableExplorerService.updateCell(
        ownerUri,
        newRow.newRowId,
        0,
        "Value",
      );

      // Revert row
      const revertResult: EditRevertRowResult = {
        row: { cells: [], id: 1, isDirty: false, state: EditRowState.clean },
      };
      mockClient.sendRequest
        .withArgs(EditRevertRowRequest.type, sinon.match.any)
        .resolves(revertResult);
      await tableExplorerService.revertRow(ownerUri, newRow.newRowId);

      expect(mockClient.sendRequest.callCount).to.equal(3);
    });
  });
});
