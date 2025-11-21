/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { RequestType, NotificationType } from "vscode-languageclient";

// ------------------------------- < Close Session Response > ----------------------------------------------

/**
 * Information returned from a CloseSessionRequest.
 * Contains success information, a SessionId to be used when
 * requesting closing an existing session.
 */
export class CloseSessionResponse {
  /**
   * Boolean indicating if the session was closed successfully
   */
  public success: boolean;

  /**
   * Unique ID to use when sending any requests for objects in the
   * tree under the node
   */
  public sessionId: string;
}

/**
 * Parameters to the CloseSessionRequest
 */
export class CloseSessionParams {
  /**
   * The Id returned from a CreateSessionRequest. This
   * is used to disambiguate between different trees.
   */
  public sessionId: string;
}

/**
 * Information returned when a session is disconnected.
 * Contains success information and a SessionId
 */
export class SessionDisconnectedParameters {
  /**
   * Boolean indicating if the connection was successful
   */
  public success: boolean;

  /**
   * Unique ID to use when sending any requests for objects in the
   * tree under the node
   */
  public sessionId: string;

  /*
   * Error message returned from the engine for a object explorer session failure reason, if any.
   */
  public errorMessage: string;
}

// ------------------------------- < Close Session Request > ----------------------------------------------

/**
 * Closes an Object Explorer tree session for a specific connection.
 * This will close a connection to a specific server or database
 */
export namespace CloseSessionRequest {
  export const type = new RequestType<
    CloseSessionParams,
    CloseSessionResponse,
    void,
    void
  >("objectexplorer/closesession");
}

/**
 * Session disconnected notification
 */
export namespace SessionDisconnectedNotification {
  export const type = new NotificationType<SessionDisconnectedParameters, void>(
    "objectexplorer/sessiondisconnected",
  );
}
