/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { RequestType } from "vscode-languageclient";
import { ConnectionDetails } from "vscode-mssql";

/**
 * A unique session ID used for all Object Explorer connection subtree mappings.
 * Guaranteed to be unique if any property of the connection details differs (except password).
 */
export namespace GetSessionIdRequest {
  export const type = new RequestType<
    ConnectionDetails,
    GetSessionIdResponse,
    void,
    void
  >("objectexplorer/getsessionid");
}

/**
 * Contains a sessionId to be used when requesting
 * expansion of nodes
 */
export class GetSessionIdResponse {
  /**
   * Unique Id to use when sending any requests for objects in the tree
   * under the node
   */
  public sessionId: string;
}
