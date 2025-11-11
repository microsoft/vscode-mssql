/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { NotificationType, RequestType } from "vscode-languageclient";
import { ConnectionDetails } from "vscode-mssql";
import { NodeInfo } from "./nodeInfo";

// ------------------------------- < Create Session Request > ----------------------------------------------

// Create session request message callback declaration
export namespace CreateSessionRequest {
    export const type = new RequestType<ConnectionDetails, CreateSessionResponse, void, void>(
        "objectexplorer/createsession",
    );
}

/**
 * Contains success information, a sessionId to be used when requesting
 * expansion of nodes, and a root node to display for this area
 */
export class CreateSessionResponse {
    /**
     * Unique Id to use when sending any requests for objects in the tree
     * under the node
     */
    public sessionId: string;
}

// ------------------------------- </ Create Session Request > ---------------------------------------------

// ------------------------------- < Create Session Complete Event > ---------------------------------------

/**
 * Information returned from a createSessionRequest. Contains success information, a sessionId to be used
 * when requesting expansion of nodes, and a root node to display for this area
 */
export class SessionCreatedParameters {
    /**
     * Boolean indicating if the connection was successful
     */
    public success: boolean;

    /**
     * Unique ID to use when sending any requests for objects in the
     * tree under the node
     */
    public sessionId: string;

    /**
     * Information describing the base node in the tree
     */
    public rootNode: NodeInfo;

    /**
     * Error number returned from the engine, if any.
     */
    public errorNumber: number | undefined;

    /**
     * Error message returned from the engine for an object explorer session
     * failure reason, if any
     */
    public errorMessage: string;
}

/**
 * Connection complete event callback declaration.
 */
export namespace CreateSessionCompleteNotification {
    export const type = new NotificationType<SessionCreatedParameters, void>(
        "objectexplorer/sessioncreated",
    );
}
