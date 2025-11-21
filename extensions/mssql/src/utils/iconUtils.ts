/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";

export class IconUtils {
  private static _extensionUri: vscode.Uri;
  public static initialize(extensionUri: vscode.Uri) {
    this._extensionUri = extensionUri;
  }

  /**
   * Gets the URI for an icon in the extension's media folder.
   * @param pathToIcon The path to the icon, relative to the media folder
   * @returns The URI for the icon
   */
  public static getIcon(...pathToIcon: string[]): vscode.Uri {
    return vscode.Uri.joinPath(this._extensionUri, "media", ...pathToIcon);
  }
}
