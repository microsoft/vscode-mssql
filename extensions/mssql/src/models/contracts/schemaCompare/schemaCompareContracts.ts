/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { RequestType } from "vscode-languageclient";
import * as mssql from "vscode-mssql";

export namespace SchemaCompareRequest {
    export const type = new RequestType<
        mssql.SchemaCompareParams,
        mssql.SchemaCompareResult,
        void,
        void
    >("schemaCompare/compare");
}

export namespace SchemaCompareGenerateScriptRequest {
    export const type = new RequestType<
        mssql.SchemaCompareGenerateScriptParams,
        mssql.ResultStatus,
        void,
        void
    >("schemaCompare/generateScript");
}

export namespace SchemaComparePublishDatabaseChangesRequest {
    export const type = new RequestType<
        mssql.SchemaComparePublishDatabaseChangesParams,
        mssql.ResultStatus,
        void,
        void
    >("schemaCompare/publishDatabase");
}

export namespace SchemaComparePublishProjectChangesRequest {
    export const type = new RequestType<
        mssql.SchemaComparePublishProjectChangesParams,
        mssql.SchemaComparePublishProjectResult,
        void,
        void
    >("schemaCompare/publishProject");
}

export namespace SchemaCompareIncludeExcludeAllNodesRequest {
    export const type = new RequestType<
        mssql.SchemaCompareIncludeExcludeAllNodesParams,
        mssql.SchemaCompareIncludeExcludeAllResult,
        void,
        void
    >("schemaCompare/includeExcludeAllNodes");
}

export namespace SchemaCompareIncludeExcludeNodeRequest {
    export const type = new RequestType<
        mssql.SchemaCompareNodeParams,
        mssql.SchemaCompareIncludeExcludeResult,
        void,
        void
    >("schemaCompare/includeExcludeNode");
}

export namespace SchemaCompareOpenScmpRequest {
    export const type = new RequestType<
        mssql.SchemaCompareOpenScmpParams,
        mssql.SchemaCompareOpenScmpResult,
        void,
        void
    >("schemaCompare/openScmp");
}

export namespace SchemaCompareSaveScmpRequest {
    export const type = new RequestType<
        mssql.SchemaCompareSaveScmpParams,
        mssql.ResultStatus,
        void,
        void
    >("schemaCompare/saveScmp");
}

export namespace SchemaCompareCancellationRequest {
    export const type = new RequestType<
        mssql.SchemaCompareCancelParams,
        mssql.ResultStatus,
        void,
        void
    >("schemaCompare/cancel");
}
