/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { RequestType } from "vscode-languageclient";
import * as vscodeMssql from "vscode-mssql";

export class MetadataQueryParams {
    /**
     * Owner URI of the connection that changed.
     */
    public ownerUri: string;
}

export class MetadataQueryResult {
    public metadata: vscodeMssql.ObjectMetadata[];
}

// ------------------------------- < Metadata Events > ------------------------------------

export namespace MetadataQueryRequest {
    export const type = new RequestType<MetadataQueryParams, MetadataQueryResult, void, void>(
        "metadata/list",
    );
}
