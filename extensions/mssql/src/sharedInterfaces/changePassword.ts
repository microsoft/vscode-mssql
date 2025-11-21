/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { NotificationType, RequestType } from "vscode-jsonrpc/browser";
import { ConnectionDetails } from "vscode-mssql";

/**
 * Parameters for changing password
 */
export interface ChangePasswordParams {
  /**
   * A URI that uniquely identifies the connection made to server.
   */
  ownerUri: string;
  /**
   * The connection details to the SQL Server instance.
   */
  connection: ConnectionDetails;
  /**
   * The new password for the SQL Server login.
   */
  newPassword: string;
}

export interface ChangePasswordResult {
  /**
   * True if the password was changed successfully, false otherwise.
   */
  result: boolean;
  /**
   * The error message if the password change failed.
   */
  errorMessage?: string;
  /**
   * The error number if the password change failed.
   */
  errorNumber?: number;
}

export interface ChangePasswordWebviewState {
  /**
   * The server name of the SQL Server instance.
   */
  server: string;
  /**
   * The user name of the SQL Server login.
   */
  userName?: string;
}

/**
 * Request sent from the webview to change the password.
 */
export namespace ChangePasswordWebviewRequest {
  export const type = new RequestType<string, ChangePasswordResult, void>(
    "changePasswordWebview/changePassword",
  );
}

/**
 * Notification sent from the webview to cancel the password change operation.
 */
export namespace CancelChangePasswordWebviewNotification {
  export const type = new NotificationType<void>(
    "changePasswordWebview/cancelChangePassword",
  );
}
