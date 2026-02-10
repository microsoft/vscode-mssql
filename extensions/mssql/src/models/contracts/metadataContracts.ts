/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { RequestType } from "vscode-languageclient";
import * as metadata from "../../sharedInterfaces/metadata";

//#region metadata/list

export namespace MetadataListRequest {
    export const type = new RequestType<
        metadata.MetadataListParams,
        metadata.MetadataListResult,
        void,
        void
    >("metadata/list");
}

//#endregion

//#region metadata/table

export namespace TableMetadataRequest {
    export const type = new RequestType<
        metadata.TableMetadataParams,
        metadata.TableMetadataResult,
        void,
        void
    >("metadata/table");
}

//#endregion

//#region metadata/view

export namespace ViewMetadataRequest {
    export const type = new RequestType<
        metadata.ViewMetadataParams,
        metadata.ViewMetadataResult,
        void,
        void
    >("metadata/view");
}

//#endregion

//#region connection/listdatabases

export namespace ListDatabasesRequest {
    export const type = new RequestType<
        metadata.ListDatabasesParams,
        metadata.ListDatabasesResult,
        void,
        void
    >("connection/listdatabases");
}

//#endregion

//#region metadata/getServerContext

export namespace GetServerContextualizationRequest {
    export const type = new RequestType<
        metadata.GetServerContextualizationParams,
        metadata.GetServerContextualizationResult,
        void,
        void
    >("metadata/getServerContext");
}

//#endregion
