/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

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
