/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { inject, type Module } from "./langiumRuntime.mjs";
import { DefaultTsqlDocumentService } from "./documentService.js";
import type {
    TsqlDocumentFactoryOptions,
    TsqlLangiumModule,
    TsqlLangiumServices,
} from "./types.js";

export function createTsqlLangiumModule(
    options: TsqlDocumentFactoryOptions,
): Module<TsqlLangiumServices> {
    return { documents: () => new DefaultTsqlDocumentService(options) };
}

export function createTsqlLangiumServices<T extends object = Record<never, never>>(
    options: TsqlDocumentFactoryOptions,
    providerModule?: TsqlLangiumModule<T>,
): TsqlLangiumServices & T {
    const defaults = createTsqlLangiumModule(options) as Module<
        TsqlLangiumServices & T,
        TsqlLangiumServices
    >;
    return providerModule ? inject(defaults, providerModule) : inject(defaults);
}
