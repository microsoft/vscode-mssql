/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { SchemaDesigner } from "../sharedInterfaces/schemaDesigner";
import SqlToolsServiceClient from "../languageservice/serviceclient";
import { SchemaDesignerRequests } from "../models/contracts/schemaDesigner";

export class SchemaDesignerService implements SchemaDesigner.ISchemaDesignerService {
    private _modelReadyListeners: ((modelReady: SchemaDesigner.SchemaDesignerSession) => void)[] =
        [];

    constructor(private _sqlToolsClient: SqlToolsServiceClient) {}

    async createSession(
        request: SchemaDesigner.CreateSessionRequest,
    ): Promise<SchemaDesigner.CreateSessionResponse> {
        try {
            const { connectionString, accessToken, databaseName } = request;
            return await this._sqlToolsClient.sendRequest(
                SchemaDesignerRequests.CreateSession.type,
                {
                    connectionString,
                    accessToken,
                    databaseName,
                },
            );
        } catch (e) {
            this._sqlToolsClient.logger.error(e);
            throw e;
        }
    }

    async disposeSession(request: SchemaDesigner.DisposeSessionRequest): Promise<void> {
        try {
            await this._sqlToolsClient.sendRequest(
                SchemaDesignerRequests.DisposeSession.type,
                request,
            );
        } catch (e) {
            this._sqlToolsClient.logger.error(e);
            throw e;
        }
    }

    async getDefinition(
        request: SchemaDesigner.GetDefinitionRequest,
    ): Promise<SchemaDesigner.GetDefinitionResponse> {
        try {
            return await this._sqlToolsClient.sendRequest(
                SchemaDesignerRequests.GetDefinition.type,
                request,
            );
        } catch (e) {
            this._sqlToolsClient.logger.error(e);
            throw e;
        }
    }

    async generateScript(
        request: SchemaDesigner.GenerateScriptRequest,
    ): Promise<SchemaDesigner.GenerateScriptResponse> {
        try {
            return await this._sqlToolsClient.sendRequest(
                SchemaDesignerRequests.GenerateScript.type,
                request,
            );
        } catch (e) {
            this._sqlToolsClient.logger.error(e);
            throw e;
        }
    }

    async publishSession(request: SchemaDesigner.PublishSessionRequest): Promise<void> {
        try {
            const { sessionId } = request;
            await this._sqlToolsClient.sendRequest(
                SchemaDesignerRequests.PublishSession.type,
                {
                    sessionId,
                },
            );
        } catch (e) {
            this._sqlToolsClient.logger.error(e);
            throw e;
        }
    }

    async getReport(
        request: SchemaDesigner.GetReportRequest,
    ): Promise<SchemaDesigner.GetReportResponse> {
        try {
            return await this._sqlToolsClient.sendRequest(
                SchemaDesignerRequests.GetReport.type,
                request,
            );
        } catch (e) {
            this._sqlToolsClient.logger.error(e);
            throw e;
        }
    }

    onSchemaReady(listener: (model: SchemaDesigner.SchemaDesignerSession) => void): void {
        this._modelReadyListeners.push(listener);
    }
}
