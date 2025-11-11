/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ExpandParams } from "./expandNodeRequest";
import { RequestType } from "vscode-languageclient";

/**
 * Parameters to the RefreshRequest.
 */
export class RefreshParams extends ExpandParams {}

// ------------------------------- < Refresh Session Request > ----------------------------------------------

export namespace RefreshRequest {
    /**
     * Returns children of a given node as a NodeInfo array.
     */
    export const type = new RequestType<RefreshParams, boolean, void, void>(
        "objectexplorer/refresh",
    );
}
