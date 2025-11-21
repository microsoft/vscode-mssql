/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { WebviewApi } from "vscode-webview";

class VsCodeApiFetcher {
  public vscodeApiInstance: WebviewApi<unknown>;

  constructor() {
    this.vscodeApiInstance = acquireVsCodeApi<unknown>();
  }
}

export const vsCodeApiInstance = new VsCodeApiFetcher();
