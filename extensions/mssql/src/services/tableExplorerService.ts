/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import SqlToolsServiceClient from "../languageservice/serviceclient";
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
} from "../models/contracts/tableExplorer";
import {
  EditCommitParams,
  EditCommitResult,
  EditCreateRowParams,
  EditCreateRowResult,
  EditDeleteRowParams,
  EditDeleteRowResult,
  EditDisposeParams,
  EditDisposeResult,
  EditInitializeFiltering,
  EditInitializeParams,
  EditInitializeResult,
  EditRevertCellParams,
  EditRevertCellResult,
  EditRevertRowParams,
  EditRevertRowResult,
  EditScriptParams,
  EditScriptResult,
  EditSubsetParams,
  EditSubsetResult,
  EditUpdateCellParams,
  EditUpdateCellResult,
} from "../sharedInterfaces/tableExplorer";
import { getErrorMessage } from "../utils/utils";

/**
 * Interface for the Table Explorer Service that handles table editing operations.
 */
export interface ITableExplorerService {
  /**
   * Gets the SQL Tools Service client instance.
   */
  readonly sqlToolsClient: SqlToolsServiceClient;

  /**
   * Initializes the table explorer service with the specified parameters.
   *
   * @param ownerUri - The URI identifying the owner/connection for the table
   * @param objectName - The name of the database object (table, view, etc.)
   * @param schemaName - The schema name containing the object
   * @param objectType - The type of database object being explored
   * @param queryString - Optional query string for filtering or custom queries
   * @param limitResults - Optional limit on the number of results to return
   * @returns A Promise that resolves to an EditInitializeResult containing initialization data
   */
  initialize(
    ownerUri: string,
    objectName: string,
    schemaName: string,
    objectType: string,
    queryString: string | undefined,
    limitResults?: number | undefined,
  ): Promise<EditInitializeResult>;

  /**
   * Retrieves a subset of rows from a table or query result set.
   *
   * @param ownerUri - The unique identifier for the connection or query session
   * @param rowStartIndex - The zero-based index of the first row to retrieve
   * @param rowCount - The number of rows to retrieve starting from the start index
   * @returns A promise that resolves to an EditSubsetResult containing the requested subset of data
   */
  subset(
    ownerUri: string,
    rowStartIndex: number,
    rowCount: number,
  ): Promise<EditSubsetResult>;

  /**
   * Commits pending changes for the specified owner URI.
   *
   * @param ownerUri - The unique identifier for the resource owner
   * @returns A promise that resolves to the commit result containing operation status and details
   */
  commit(ownerUri: string): Promise<EditCommitResult>;

  /**
   * Creates a new row for editing in the specified table.
   *
   * @param ownerUri - The URI identifying the connection and table context
   * @returns A Promise that resolves to the result of the create row operation
   */
  createRow(ownerUri: string): Promise<EditCreateRowResult>;

  /**
   * Deletes a row from a table in the database.
   *
   * @param ownerUri - The URI identifying the connection and database context
   * @param rowId - The unique identifier of the row to be deleted
   * @returns A promise that resolves to the result of the delete operation
   */
  deleteRow(ownerUri: string, rowId: number): Promise<EditDeleteRowResult>;

  /**
   * Reverts a row to its original state by discarding any pending changes.
   *
   * @param ownerUri - The unique identifier for the connection/document owner
   * @param rowId - The identifier of the row to revert
   * @returns A promise that resolves to the result of the revert operation
   */
  revertRow(ownerUri: string, rowId: number): Promise<EditRevertRowResult>;

  /**
   * Updates a single cell value in a table row.
   *
   * @param ownerUri - The URI identifier for the database connection or table owner
   * @param rowId - The identifier of the row containing the cell to update
   * @param columnId - The identifier of the column containing the cell to update
   * @param newValue - The new value to set for the specified cell
   * @returns A promise that resolves to the result of the cell update operation
   */
  updateCell(
    ownerUri: string,
    rowId: number,
    columnId: number,
    newValue: string,
  ): Promise<EditUpdateCellResult>;

  /**
   * Reverts a cell in the table editor to its original value.
   *
   * @param ownerUri - The unique identifier for the database connection/document
   * @param rowId - The identifier of the row containing the cell to revert
   * @param columnId - The identifier of the column containing the cell to revert
   * @returns A promise that resolves to the result of the revert cell operation
   */
  revertCell(
    ownerUri: string,
    rowId: number,
    columnId: number,
  ): Promise<EditRevertCellResult>;

  /**
   * Disposes of resources associated with the specified owner URI.
   *
   * @param ownerUri - The URI of the owner whose resources should be disposed
   * @returns A promise that resolves to the dispose result containing cleanup status
   */
  dispose(ownerUri: string): Promise<EditDisposeResult>;

  /**
   * Generates update scripts for the specified owner URI based on changes made during
   * the edit session.
   *
   * @param ownerUri - The URI identifying the owner for which to generate scripts
   * @returns A promise that resolves to an EditScriptResult containing the generated scripts
   */
  generateScripts(ownerUri: string): Promise<EditScriptResult>;
}

export class TableExplorerService implements ITableExplorerService {
  constructor(private _client: SqlToolsServiceClient) {}

  /**
   * Gets the SQL Tools Service client instance.
   * @returns {SqlToolsServiceClient} The SQL Tools Service client used for database operations.
   */
  public get sqlToolsClient(): SqlToolsServiceClient {
    return this._client;
  }

  /**
   * Initializes the table explorer service with the specified parameters.
   *
   * @param ownerUri - The URI identifying the owner/connection for the table
   * @param objectName - The name of the database object (table, view, etc.)
   * @param schemaName - The schema name containing the object
   * @param objectType - The type of database object being explored
   * @param queryString - Optional query string for filtering or custom queries
   * @param limitResults - Optional limit on the number of results to return
   * @returns A Promise that resolves to an EditInitializeResult containing initialization data
   * @throws Logs error and re-throws if the initialization request fails
   */
  public async initialize(
    ownerUri: string,
    objectName: string,
    schemaName: string,
    objectType: string,
    queryString: string | undefined,
    limitResults?: number | undefined,
  ): Promise<EditInitializeResult> {
    try {
      const filters: EditInitializeFiltering = {
        LimitResults: limitResults,
      };

      const params: EditInitializeParams = {
        ownerUri: ownerUri,
        filters: filters,
        objectName: objectName,
        schemaName: schemaName,
        objectType: objectType,
        queryString: queryString,
      };

      const result = await this._client.sendRequest(
        EditInitializeRequest.type,
        params,
      );

      return result;
    } catch (error) {
      this._client.logger.error(getErrorMessage(error));
      throw error;
    }
  }

  /**
   * Retrieves a subset of rows from a table or query result set.
   *
   * @param ownerUri - The unique identifier for the connection or query session
   * @param rowStartIndex - The zero-based index of the first row to retrieve
   * @param rowCount - The number of rows to retrieve starting from the start index
   * @returns A promise that resolves to an EditSubsetResult containing the requested subset of data
   * @throws Will throw an error if the subset request fails or if there are connection issues
   */
  public async subset(
    ownerUri: string,
    rowStartIndex: number,
    rowCount: number,
  ): Promise<EditSubsetResult> {
    try {
      const params: EditSubsetParams = {
        ownerUri: ownerUri,
        rowStartIndex: rowStartIndex,
        rowCount: rowCount,
      };

      const result = await this._client.sendRequest(
        EditSubsetRequest.type,
        params,
      );

      return result;
    } catch (error) {
      this._client.logger.error(getErrorMessage(error));
      throw error;
    }
  }

  /**
   * Commits pending changes for the specified owner URI.
   *
   * @param ownerUri - The unique identifier for the resource owner
   * @returns A promise that resolves to the commit result containing operation status and details
   * @throws Will throw an error if the commit operation fails or if there are communication issues with the client
   */
  public async commit(ownerUri: string): Promise<EditCommitResult> {
    try {
      const params: EditCommitParams = {
        ownerUri: ownerUri,
      };

      const result = await this._client.sendRequest(
        EditCommitRequest.type,
        params,
      );

      return result;
    } catch (error) {
      this._client.logger.error(getErrorMessage(error));
      throw error;
    }
  }

  /**
   * Creates a new row for editing in the specified table.
   *
   * @param ownerUri - The URI identifying the connection and table context
   * @returns A Promise that resolves to the result of the create row operation
   * @throws Will throw an error if the create row request fails
   */
  public async createRow(ownerUri: string): Promise<EditCreateRowResult> {
    try {
      const params: EditCreateRowParams = {
        ownerUri: ownerUri,
      };

      const result = await this._client.sendRequest(
        EditCreateRowRequest.type,
        params,
      );

      return result;
    } catch (error) {
      this._client.logger.error(getErrorMessage(error));
      throw error;
    }
  }

  /**
   * Deletes a row from a table in the database.
   *
   * @param ownerUri - The URI identifying the connection and database context
   * @param rowId - The unique identifier of the row to be deleted
   * @returns A promise that resolves to the result of the delete operation
   * @throws Will throw an error if the delete operation fails or if there are connection issues
   */
  public async deleteRow(
    ownerUri: string,
    rowId: number,
  ): Promise<EditDeleteRowResult> {
    try {
      const params: EditDeleteRowParams = {
        ownerUri: ownerUri,
        rowId: rowId,
      };

      const result = await this._client.sendRequest(
        EditDeleteRowRequest.type,
        params,
      );

      return result;
    } catch (error) {
      this._client.logger.error(getErrorMessage(error));
      throw error;
    }
  }

  /**
   * Reverts a row to its original state by discarding any pending changes.
   *
   * @param ownerUri - The unique identifier for the connection/document owner
   * @param rowId - The identifier of the row to revert
   * @returns A promise that resolves to the result of the revert operation
   * @throws Will throw an error if the revert operation fails or if there are communication issues with the client
   */
  public async revertRow(
    ownerUri: string,
    rowId: number,
  ): Promise<EditRevertRowResult> {
    try {
      const params: EditRevertRowParams = {
        ownerUri: ownerUri,
        rowId: rowId,
      };

      const result = await this._client.sendRequest(
        EditRevertRowRequest.type,
        params,
      );

      return result;
    } catch (error) {
      this._client.logger.error(getErrorMessage(error));
      throw error;
    }
  }

  /**
   * Updates a single cell value in a table row.
   *
   * @param ownerUri - The URI identifier for the database connection or table owner
   * @param rowId - The identifier of the row containing the cell to update
   * @param columnId - The identifier of the column containing the cell to update
   * @param newValue - The new value to set for the specified cell
   * @returns A promise that resolves to the result of the cell update operation
   * @throws Will throw an error if the update operation fails or if there are communication issues with the client
   */
  public async updateCell(
    ownerUri: string,
    rowId: number,
    columnId: number,
    newValue: string,
  ): Promise<EditUpdateCellResult> {
    try {
      const params: EditUpdateCellParams = {
        ownerUri: ownerUri,
        rowId: rowId,
        columnId: columnId,
        newValue: newValue,
      };

      const result = await this._client.sendRequest(
        EditUpdateCellRequest.type,
        params,
      );

      return result;
    } catch (error) {
      this._client.logger.error(getErrorMessage(error));
      throw error;
    }
  }

  /**
   * Reverts a cell in the table editor to its original value.
   *
   * @param ownerUri - The unique identifier for the database connection/document
   * @param rowId - The identifier of the row containing the cell to revert
   * @param columnId - The identifier of the column containing the cell to revert
   * @returns A promise that resolves to the result of the revert cell operation
   * @throws Will throw an error if the revert operation fails or if there's a communication issue with the client
   */
  public async revertCell(
    ownerUri: string,
    rowId: number,
    columnId: number,
  ): Promise<EditRevertCellResult> {
    try {
      const params: EditRevertCellParams = {
        ownerUri: ownerUri,
        rowId: rowId,
        columnId: columnId,
      };

      const result = await this._client.sendRequest(
        EditRevertCellRequest.type,
        params,
      );

      return result;
    } catch (error) {
      this._client.logger.error(getErrorMessage(error));
      throw error;
    }
  }

  /**
   * Disposes of resources associated with the specified owner URI.
   *
   * @param ownerUri - The URI of the owner whose resources should be disposed
   * @returns A promise that resolves to the dispose result containing cleanup status
   * @throws Will throw an error if the dispose request fails or if there's a communication error with the client
   */
  public async dispose(ownerUri: string): Promise<EditDisposeResult> {
    try {
      const params: EditDisposeParams = {
        ownerUri: ownerUri,
      };

      const result = await this._client.sendRequest(
        EditDisposeRequest.type,
        params,
      );

      return result;
    } catch (error) {
      this._client.logger.error(getErrorMessage(error));
      throw error;
    }
  }

  /**
   * Generates update scripts for the specified owner URI based on changes made during
   * the edit session.
   *
   * @param ownerUri - The URI identifying the owner for which to generate scripts
   * @returns A promise that resolves to an EditScriptResult containing the generated scripts
   * @throws Will throw an error if the script generation request fails
   */
  public async generateScripts(ownerUri: string): Promise<EditScriptResult> {
    try {
      const params: EditScriptParams = {
        ownerUri: ownerUri,
      };

      const result = await this._client.sendRequest(
        EditScriptRequest.type,
        params,
      );

      return result;
    } catch (error) {
      this._client.logger.error(getErrorMessage(error));
      throw error;
    }
  }
}
