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
    EditSubsetRequest,
    EditUpdateCellRequest,
} from "../models/contracts/editData";
import * as ed from "../sharedInterfaces/editData";

export class EditDataService {
    constructor(private _sqlToolsClient: SqlToolsServiceClient) {}

    get sqlToolsClient(): SqlToolsServiceClient {
        return this._sqlToolsClient;
    }

    async createRow(ownerUri: string): Promise<ed.EditCreateRowResult> {
        try {
            const params: ed.EditCreateRowParams = {
                ownerUri: ownerUri,
            };

            const result = await this._sqlToolsClient.sendRequest(
                EditCreateRowRequest.type,
                params,
            );

            return result;
        } catch (e) {
            this._sqlToolsClient.logger.error(e);
            throw e;
        }
    }

    async deleteRow(
        ownerUri: string,
        rowId: number,
    ): Promise<ed.EditDeleteRowResult> {
        try {
            const params: ed.EditDeleteRowParams = {
                ownerUri: ownerUri,
                rowId: rowId,
            };

            const result = await this._sqlToolsClient.sendRequest(
                EditDeleteRowRequest.type,
                params,
            );

            return result;
        } catch (e) {
            this._sqlToolsClient.logger.error(e);
            throw e;
        }
    }

    async dispose(ownerUri: string): Promise<ed.EditDisposeResult> {
        try {
            const params: ed.EditDisposeParams = {
                ownerUri: ownerUri,
            };

            const result = await this._sqlToolsClient.sendRequest(
                EditDisposeRequest.type,
                params,
            );

            return result;
        } catch (e) {
            this._sqlToolsClient.logger.error(e);
            throw e;
        }
    }

    async Initialize(
        ownerUri: string,
        objectName: string,
        schemaName: string,
        objectType: string,
        queryString: string | undefined,
        limitResults?: number | undefined,
    ): Promise<ed.EditInitializeResult> {
        try {
            const filters: ed.EditInitializeFiltering = {
                LimitResults: limitResults,
            };

            const params: ed.EditInitializeParams = {
                ownerUri: ownerUri,
                filters: filters,
                objectName: objectName,
                schemaName: schemaName,
                objectType: objectType,
                queryString: queryString,
            };

            const result = await this._sqlToolsClient.sendRequest(
                EditInitializeRequest.type,
                params,
            );

            return result;
        } catch (e) {
            this._sqlToolsClient.logger.error(e);
            throw e;
        }
    }

    async revertCell(
        ownerUri: string,
        rowId: number,
        columnId: number,
    ): Promise<ed.EditRevertCellResult> {
        try {
            const params: ed.EditRevertCellParams = {
                ownerUri: ownerUri,
                rowId: rowId,
                columnId: columnId,
            };

            const result = await this._sqlToolsClient.sendRequest(
                EditRevertCellRequest.type,
                params,
            );

            return result;
        } catch (e) {
            this._sqlToolsClient.logger.error(e);
            throw e;
        }
    }

    async revertRow(
        ownerUri: string,
        rowId: number,
    ): Promise<ed.EditRevertRowResult> {
        try {
            const params: ed.EditRevertRowParams = {
                ownerUri: ownerUri,
                rowId: rowId,
            };

            const result = await this._sqlToolsClient.sendRequest(
                EditRevertRowRequest.type,
                params,
            );

            return result;
        } catch (e) {
            this._sqlToolsClient.logger.error(e);
            throw e;
        }
    }

    async subset(
        ownerUri: string,
        rowStartIndex: number,
        rowCount: number,
    ): Promise<ed.EditSubsetResult> {
        try {
            const params: ed.EditSubsetParams = {
                ownerUri: ownerUri,
                rowStartIndex: rowStartIndex,
                rowCount: rowCount,
            };

            const result = await this._sqlToolsClient.sendRequest(
                EditSubsetRequest.type,
                params,
            );

            return result;
        } catch (e) {
            this._sqlToolsClient.logger.error(e);
            throw e;
        }
    }

    async updateCell(
        ownerUri: string,
        rowId: number,
        columnId: number,
        newValue: string,
    ): Promise<ed.EditUpdateCellResult> {
        try {
            const params: ed.EditUpdateCellParams = {
                ownerUri: ownerUri,
                rowId: rowId,
                columnId: columnId,
                newValue: newValue,
            };

            const result = await this._sqlToolsClient.sendRequest(
                EditUpdateCellRequest.type,
                params,
            );

            return result;
        } catch (e) {
            this._sqlToolsClient.logger.error(e);
            throw e;
        }
    }

    async commit(ownerUri: string): Promise<ed.EditCommitResult> {
        try {
            const params: ed.EditCommitParams = {
                ownerUri: ownerUri,
            };

            const result = await this._sqlToolsClient.sendRequest(
                EditCommitRequest.type,
                params,
            );

            return result;
        } catch (e) {
            this._sqlToolsClient.logger.error(e);
            throw e;
        }
    }
}
