/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { NodeInfo } from "./nodeInfo";
import { RequestType, NotificationType } from "vscode-languageclient";
import * as vscodeMssql from "vscode-mssql";

// ------------------------------- < Expand Node Response > ----------------------------------------------

/**
 * Information returned from a "ExpandRequest"
 */
export class ExpandResponse {
    /**
     * Unique ID to use when sending any requests for objects in the
     * tree under the node
     */
    public sessionId: string;

    /**
     * Information describing the expanded nodes in the tree
     */
    public nodes: NodeInfo[];

    /**
     * Path identifying the node to expand.
     */
    public nodePath: string;

    /**
     * Error message returned from the engine for a object explorer expand failure reason, if any.
     */
    public errorMessage: string;
}

/**
 * Parameters to the ExpandRequest
 */
export class ExpandParams {
    /**
     * The Id returned from a "CreateSessionRequest". This
     * is used to disambiguate between different trees
     */
    public sessionId: string;

    /**
     * Path identifying the node to expand.
     */
    public nodePath: string;

    /**
     * Filters to apply to the child nodes being returned
     */
    filters?: vscodeMssql.NodeFilter[];
}

// ------------------------------- < Expand Node Request > ----------------------------------------------

/**
 * A request to expand a Node
 */
export namespace ExpandRequest {
    /**
     * Returns children of a given node as a NodeInfo array
     */
    export const type = new RequestType<ExpandParams, boolean, void, void>("objectexplorer/expand");
}

/**
 * Expand notification mapping entry
 */
export namespace ExpandCompleteNotification {
    export const type = new NotificationType<ExpandResponse, void>(
        "objectexplorer/expandCompleted",
    );
}
