/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    GetSchemaModelRequestParams,
    ISchema,
    ISchemaDesignerService,
    PublishSchemaRequestParams,
} from "../sharedInterfaces/schemaDesigner";
import SqlToolsServiceClient from "../languageservice/serviceclient";
import {
    GetSchemaModelRequest,
    ModelReadyNotification,
    PublishSchemaRequest,
} from "../models/contracts/schemaDesigner";

export class SchemaDesignerService implements ISchemaDesignerService {
    private _modelReadyListeners: (() => void)[] = [];

    constructor(private _sqlToolsClient: SqlToolsServiceClient) {
        this._sqlToolsClient.onNotification(
            ModelReadyNotification.type,
            (result) => {
                console.log("result", result);
                this._modelReadyListeners.forEach((listener) => listener());
            },
        );
    }

    async getSchemaModel(
        request: GetSchemaModelRequestParams,
    ): Promise<ISchema> {
        try {
            return await this._sqlToolsClient.sendRequest(
                GetSchemaModelRequest.type,
                request,
            );
        } catch (e) {
            this._sqlToolsClient.logger.error(e);
            throw e;
        }
    }

    async publishSchema(request: PublishSchemaRequestParams): Promise<void> {
        try {
            return await this._sqlToolsClient.sendRequest(
                PublishSchemaRequest.type,
                request,
            );
        } catch (e) {
            this._sqlToolsClient.logger.error(e);
            throw e;
        }
    }

    onModelReady(listener: () => void): void {
        this._modelReadyListeners.push(listener);
    }
}
