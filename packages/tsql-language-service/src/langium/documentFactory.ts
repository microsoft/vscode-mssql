/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { DocumentState } from "./langiumRuntime.mjs";
import { TsqlOperationCancelledError } from "./errors.js";
import { TsqlTextDocumentSnapshot } from "./textDocument.js";
import type {
    TsqlCatalogMetadata,
    TsqlDocumentFactoryOptions,
    TsqlDocumentRoot,
    TsqlDocumentSource,
    TsqlDocumentUpdateOptions,
    TsqlLangiumDocument,
} from "./types.js";

/** Factory that binds immutable parser snapshots to Langium document generations. */
export class TsqlLangiumDocumentFactory {
    private readonly defaultCatalog: Readonly<TsqlCatalogMetadata>;

    public constructor(private readonly options: TsqlDocumentFactoryOptions) {
        this.defaultCatalog = freezeCatalog(options.defaultCatalog);
    }

    public isCatalogCurrent(
        current: Readonly<TsqlCatalogMetadata>,
        requested: TsqlCatalogMetadata | undefined,
    ): boolean {
        return sameCatalogSnapshot(current, { ...this.defaultCatalog, ...requested });
    }

    public create(
        source: TsqlDocumentSource,
        update: TsqlDocumentUpdateOptions,
        generation: number,
        previous?: TsqlLangiumDocument,
    ): TsqlLangiumDocument {
        throwIfCancelled(update.cancellationToken);
        const text = source.getText();
        const parseText = update.parseText ?? text;
        const catalog = freezeCatalog({ ...this.defaultCatalog, ...update.catalog });
        const canIncrement =
            previous !== undefined &&
            previous.analysis.engineId === this.options.engine.id &&
            previous.catalog.provider === catalog.provider;
        const analysis =
            update.analysis ??
            (canIncrement
                ? this.options.engine.updateSnapshot(previous.analysis, {
                      text: parseText,
                      uri: source.uri.toString(),
                      catalog: catalog.provider ?? null,
                  })
                : this.options.engine.createSnapshot({
                      text: parseText,
                      uri: source.uri.toString(),
                      catalog: catalog.provider,
                  }));
        if (analysis.text !== parseText) {
            throw new Error("The supplied analysis snapshot does not match the parser text");
        }
        throwIfCancelled(update.cancellationToken);

        const root: TsqlDocumentRoot = { $type: "TsqlDocument", length: text.length };
        const document: TsqlLangiumDocument = {
            uri: source.uri,
            textDocument: new TsqlTextDocumentSnapshot(
                source.uri.toString(),
                source.languageId,
                source.version,
                text,
            ),
            state: DocumentState.Parsed,
            parseResult: { value: root, lexerErrors: [], parserErrors: [] },
            references: [],
            version: source.version,
            generation,
            analysis,
            catalog,
        };
        Object.defineProperty(root, "$document", { value: document, enumerable: false });
        return document;
    }
}

export function sameCatalogSnapshot(
    left: Readonly<TsqlCatalogMetadata>,
    right: TsqlCatalogMetadata | undefined,
): boolean {
    return (
        left.provider === right?.provider &&
        left.revision === right?.revision &&
        left.connectionId === right?.connectionId &&
        left.database === right?.database
    );
}

function freezeCatalog(catalog: TsqlCatalogMetadata | undefined): Readonly<TsqlCatalogMetadata> {
    return Object.freeze({
        provider: catalog?.provider,
        revision: catalog?.revision,
        connectionId: catalog?.connectionId,
        database: catalog?.database,
    });
}

function throwIfCancelled(token: { readonly isCancellationRequested: boolean } | undefined): void {
    if (token?.isCancellationRequested) {
        throw new TsqlOperationCancelledError();
    }
}
