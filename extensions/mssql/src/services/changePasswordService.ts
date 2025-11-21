/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import { IConnectionInfo } from "vscode-mssql";
import SqlToolsServiceClient from "../languageservice/serviceclient";
import VscodeWrapper from "../controllers/vscodeWrapper";
import { ConnectionCredentials } from "../models/connectionCredentials";
import { ChangePasswordWebviewController } from "../controllers/changePasswordWebviewController";
import { ChangePasswordRequest } from "../models/contracts/changePassword";
import { ChangePasswordResult } from "../sharedInterfaces/changePassword";
import { generateGuid } from "../models/utils";
import { getErrorMessage } from "../utils/utils";

export class ChangePasswordService {
  constructor(
    private _client: SqlToolsServiceClient,
    private _context?: vscode.ExtensionContext,
    private _vscodeWrapper?: VscodeWrapper,
  ) {}

  /**
   * Handles the change password operation. To be used in case of non UI based connection
   * flows where the password change prompt needs to be shown.
   * @param credentials The connection credentials.
   * @param error The error that triggered the password change prompt.
   * @returns A promise that resolves to the new password or undefined if the operation was canceled.
   */
  public async handleChangePassword(
    credentials: IConnectionInfo,
  ): Promise<string | undefined> {
    const webview = new ChangePasswordWebviewController(
      this._context,
      this._vscodeWrapper,
      credentials,
      this,
    );

    await webview.whenWebviewReady();
    webview.revealToForeground();
    return await webview.dialogResult.promise;
  }

  /**
   * Calls the change password request on the service client.
   * @param credentials The connection credentials.
   * @param newPassword The new password.
   * @returns A promise that resolves to the result of the change password operation.
   */
  public async changePassword(
    credentials: IConnectionInfo,
    newPassword: string,
  ): Promise<ChangePasswordResult> {
    const connectionDetails =
      ConnectionCredentials.createConnectionDetails(credentials);
    try {
      return await this._client.sendRequest(ChangePasswordRequest.type, {
        ownerUri: `changePassword:${generateGuid()}`,
        connection: connectionDetails,
        newPassword: newPassword,
      });
    } catch (error) {
      return { result: false, errorMessage: getErrorMessage(error) };
    }
  }
}
