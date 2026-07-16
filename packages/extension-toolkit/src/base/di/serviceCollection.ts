/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

//!!! DO NOT modify directly. This file contains stable DI primitives copied from microsoft/vscode.
// Source: https://github.com/microsoft/vscode/blob/1f01c15f70c50c8a6f6e9e17acca9d7cae9bbd5c/src/vs/platform/instantiation/common/serviceCollection.ts
// Reference: https://github.com/microsoft/vscode-copilot-chat/blob/5863f5a7088958050792b5dccbe8b46c6e13eccc/src/util/vs/platform/instantiation/common/serviceCollection.ts
// Extension-specific behavior should live outside src/base/di.

import type { ServiceDescriptor } from "./serviceDescriptor";
import type { ServiceIdentifier } from "./serviceIdentifier";

export class ServiceCollection {
    private readonly _services = new Map<ServiceIdentifier<unknown>, unknown>();

    constructor(entries?: readonly [ServiceIdentifier<unknown>, unknown][]) {
        for (const [id, service] of entries ?? []) {
            this.set(id, service);
        }
    }

    set<T>(id: ServiceIdentifier<T>, instanceOrDescriptor: T | ServiceDescriptor<T>): void {
        this._services.set(id, instanceOrDescriptor);
    }

    get<T>(id: ServiceIdentifier<T>): T | ServiceDescriptor<T> | undefined {
        return this._services.get(id) as T | ServiceDescriptor<T> | undefined;
    }
}
