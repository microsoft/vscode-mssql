/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

import { RequestType } from 'vscode-languageclient';


export class MetadataQueryParams {
    /**
     * Owner URI of the connection that changed.
     */
    public ownerUri: string;
}

export enum MetadataType {
    Table = 0,
    View = 1,
    SProc = 2,
    Function = 3
}

// tslint:disable-next-line:interface-name
export interface ObjectMetadata {
    metadataType: MetadataType;

    metadataTypeName: string;

    urn: string;

    name: string;

    schema: string;
}

export class MetadataQueryResult {
    public metadata: ObjectMetadata[];
}


// ------------------------------- < Metadata Events > ------------------------------------

export namespace MetadataQueryRequest {
    export const type = new RequestType<MetadataQueryParams, MetadataQueryResult, void, void>('metadata/list');
}
