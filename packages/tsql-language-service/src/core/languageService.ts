/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type {
    SqlAnalysisEngine,
    SqlAnalysisInput,
    SqlAnalysisSnapshot,
} from "../analysis/contracts.js";
import { createTsqlServices } from "../lsp/services.js";
import type { TsqlCatalogMetadata, TsqlDocumentService, TsqlServiceModule } from "../lsp/types.js";

export interface TsqlLanguageServiceOptions<T extends object = Record<never, never>> {
    readonly defaultCatalog?: TsqlCatalogMetadata;
    readonly providerModule?: TsqlServiceModule<T>;
}

/** Facade over an analysis strategy and its generation-aware document store. */
export class TsqlLanguageService<T extends object = Record<never, never>> {
    public readonly documents: TsqlDocumentService;
    public readonly services: { readonly documents: TsqlDocumentService } & T;

    public constructor(
        public readonly engine: SqlAnalysisEngine,
        options: TsqlLanguageServiceOptions<T> = {},
    ) {
        this.services = createTsqlServices(
            { engine, defaultCatalog: options.defaultCatalog },
            options.providerModule,
        );
        this.documents = this.services.documents;
    }

    public analyze(input: SqlAnalysisInput, previous?: SqlAnalysisSnapshot): SqlAnalysisSnapshot {
        return previous?.engineId === this.engine.id
            ? this.engine.updateSnapshot(previous, {
                  text: input.text,
                  uri: input.uri,
                  catalog: input.catalog ?? null,
              })
            : this.engine.createSnapshot(input);
    }
}

export function createTsqlLanguageService<T extends object = Record<never, never>>(
    engine: SqlAnalysisEngine,
    options: TsqlLanguageServiceOptions<T> = {},
): TsqlLanguageService<T> {
    return new TsqlLanguageService(engine, options);
}
