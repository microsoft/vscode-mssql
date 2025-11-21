/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import { ToolBase } from "./toolBase";
import ConnectionManager from "../../controllers/connectionManager";
import * as Constants from "../../constants/constants";
import { MssqlChatAgent as loc } from "../../constants/locConstants";

export interface ServerProfile {
  profileId: string;
  profileName: string;
  server: string;
  database: string;
}

/** Result of the list servers request. */
export interface ListServersResult {
  servers: ServerProfile[];
}

/** Tool implementation for listing database servers from local profiles. */
export class ListServersTool extends ToolBase<undefined> {
  public readonly toolName = Constants.copilotListServersToolName;

  constructor(private _connectionManager: ConnectionManager) {
    super();
  }

  async call(
    _options: vscode.LanguageModelToolInvocationOptions<undefined>,
    _token: vscode.CancellationToken,
  ) {
    // Fetch all servers from the connection store
    const profiles =
      await this._connectionManager.connectionStore.readAllConnections(false);
    // Map to server profiles
    const servers: ServerProfile[] = profiles.map((p) => ({
      profileId: p.id,
      profileName: p.profileName,
      server: p.server,
      database: p.database,
    }));
    return JSON.stringify({ servers });
  }

  async prepareInvocation(
    _options: vscode.LanguageModelToolInvocationPrepareOptions<undefined>,
    _token: vscode.CancellationToken,
  ) {
    const confirmationMessages = {
      title: `${Constants.extensionName}: ${loc.listServersToolConfirmationTitle}`,
      message: new vscode.MarkdownString(
        loc.listServersToolConfirmationMessage,
      ),
    };

    return {
      invocationMessage: loc.listServersToolInvocationMessage,
      confirmationMessages,
    };
  }
}
