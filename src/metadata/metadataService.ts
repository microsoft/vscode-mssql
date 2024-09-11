/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import SqlToolsServiceClient from "../languageservice/serviceclient";
import ConnectionManager from "../controllers/connectionManager";
import {
  MetadataQueryParams,
  MetadataQueryRequest,
} from "../models/contracts/metadata/metadataRequest";
import { ObjectMetadata } from "vscode-mssql";

export class MetadataService {
  private _client: SqlToolsServiceClient;

  constructor(private _connectionManager: ConnectionManager) {
    this._client = this._connectionManager.client;
  }

  public async getMetadata(uri: string): Promise<ObjectMetadata[]> {
    const metadataParams: MetadataQueryParams = { ownerUri: uri };
    const { metadata } = await this._client.sendRequest(
      MetadataQueryRequest.type,
      metadataParams,
    );
    return metadata;
  }
}
