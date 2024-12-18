/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    ISchema,
    ISchemaDesignerService,
} from "../sharedInterfaces/schemaDesigner";
import SqlToolsServiceClient from "../languageservice/serviceclient";
import { GetSchemaModelRequest } from "../models/contracts/schemaDesigner";

export class SchemaDesignerService implements ISchemaDesignerService {
    constructor(private _sqlToolsClient: SqlToolsServiceClient) {}
    async getSchemaModel(connectionUri: string): Promise<ISchema> {
        try {
            return await this._sqlToolsClient.sendRequest(
                GetSchemaModelRequest.type,
                connectionUri,
            );
        } catch (e) {
            this._sqlToolsClient.logger.error(e);
            throw e;
        }
    }
}
