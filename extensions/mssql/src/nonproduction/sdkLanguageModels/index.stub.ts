/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Channel stub for the sdkLanguageModels non-production area. Build channels
 * that exclude the area (see src/nonproduction/channels.json) bundle THIS
 * file in place of index.ts, so none of the direct-API SDK provider code —
 * or its SDK dependencies — reaches the bundle or VSIX. The export surface
 * must stay identical to index.ts; test/unit/nonproductionChannels.test.ts
 * enforces the parity.
 */

import * as vscode from "vscode";

export function registerSdkLanguageModelProviders(context: vscode.ExtensionContext): void {
    void context; // Direct SDK language-model providers are not part of this build channel.
}
