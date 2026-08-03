/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

//!!! DO NOT modify directly. This file contains stable DI primitives copied from microsoft/vscode.
// Source: https://github.com/microsoft/vscode/blob/1f01c15f70c50c8a6f6e9e17acca9d7cae9bbd5c/src/vs/platform/instantiation/common/descriptors.ts
// Reference: https://github.com/microsoft/vscode-copilot-chat/blob/5863f5a7088958050792b5dccbe8b46c6e13eccc/src/util/vs/platform/instantiation/common/descriptors.ts
// Extension-specific behavior should live outside src/base/di.

import type { Constructor } from "./serviceIdentifier";

export class ServiceDescriptor<T> {
    constructor(
        readonly ctor: Constructor<T>,
        readonly staticArguments: readonly unknown[] = [],
    ) {}
}
