/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { RequestType } from "vscode-languageclient";
import type * as mssql from "vscode-mssql";

/**
 * Restore database request
 */
export namespace RestoreRequest {
    export const type = new RequestType<mssql.RestoreParams, mssql.RestoreResponse, void, void>(
        "restore/restore",
    );
}

/**
 * Get restore plan request
 */
export namespace RestorePlanRequest {
    export const type = new RequestType<mssql.RestoreParams, mssql.RestorePlanResponse, void, void>(
        "restore/restoreplan",
    );
}

/**
 * Cancel restore plan request
 */
export namespace CancelRestorePlanRequest {
    export const type = new RequestType<mssql.RestoreParams, boolean, void, void>(
        "restore/cancelrestoreplan",
    );
}

/**
 * Get restore configuration info request
 */
export namespace RestoreConfigInfoRequest {
    export const type = new RequestType<
        mssql.RestoreConfigInfoRequestParams,
        mssql.RestoreConfigInfoResponse,
        void,
        void
    >("restore/restoreconfiginfo");
}
