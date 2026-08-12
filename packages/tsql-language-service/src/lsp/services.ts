/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { DefaultTsqlDocumentService } from "./documentService.js";
import type { TsqlDocumentFactoryOptions, TsqlServiceModule, TsqlServices } from "./types.js";

/** Creates the document store and lazily composes optional host services without a DI framework. */
export function createTsqlServices<T extends object = Record<never, never>>(
    options: TsqlDocumentFactoryOptions,
    providerModule?: TsqlServiceModule<T>,
): TsqlServices & T {
    const services = {
        documents: new DefaultTsqlDocumentService(options),
    } as TsqlServices & T;
    if (!providerModule) {
        return services;
    }

    for (const key of Object.keys(providerModule) as (keyof T & string)[]) {
        const factory = providerModule[key];
        let state: "uninitialized" | "initializing" | "ready" = "uninitialized";
        let value: T[typeof key];
        Object.defineProperty(services, key, {
            configurable: false,
            enumerable: true,
            get: () => {
                if (state === "initializing") {
                    throw new Error(`Circular T-SQL service dependency while creating '${key}'`);
                }
                if (state === "uninitialized") {
                    state = "initializing";
                    try {
                        value = factory(services);
                        state = "ready";
                    } catch (error) {
                        state = "uninitialized";
                        throw error;
                    }
                }
                return value;
            },
        });
    }
    return services;
}
