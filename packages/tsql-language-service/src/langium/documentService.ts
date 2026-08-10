/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { DocumentState, type URI } from "./langiumRuntime.mjs";
import type { CancellationTokenLike } from "../core/cancellation.js";
import { TsqlLangiumDocumentFactory } from "./documentFactory.js";
import { StaleTsqlDocumentError } from "./errors.js";
import type {
    TsqlDocumentFactoryOptions,
    TsqlDocumentService,
    TsqlDocumentSource,
    TsqlDocumentUpdateOptions,
    TsqlDocumentWork,
    TsqlLangiumDocument,
} from "./types.js";
import { TsqlDocumentWorkCache } from "./workCache.js";

/** Owns the current immutable Langium document generation for every URI. */
export class DefaultTsqlDocumentService implements TsqlDocumentService {
    private readonly documents = new Map<string, TsqlLangiumDocument>();
    private readonly factory: TsqlLangiumDocumentFactory;
    private readonly workCache: TsqlDocumentWorkCache;
    private nextGeneration = 1;

    public constructor(options: TsqlDocumentFactoryOptions) {
        this.factory = new TsqlLangiumDocumentFactory(options);
        this.workCache = new TsqlDocumentWorkCache((document) => this.isCurrent(document));
    }

    public get all(): readonly TsqlLangiumDocument[] {
        return [...this.documents.values()];
    }

    public get(uri: URI | string): TsqlLangiumDocument | undefined {
        return this.documents.get(uriKey(uri));
    }

    public isCurrent(document: TsqlLangiumDocument): boolean {
        return this.get(document.uri) === document;
    }

    public update(
        source: TsqlDocumentSource,
        options: TsqlDocumentUpdateOptions = {},
    ): TsqlLangiumDocument {
        const key = uriKey(source.uri);
        const previous = this.documents.get(key);
        if (previous && source.version < previous.version) {
            return previous;
        }

        const text = source.getText();
        const parseText = options.parseText ?? text;
        if (
            previous &&
            source.version === previous.version &&
            text === previous.textDocument.getText() &&
            parseText === previous.analysis.text &&
            this.factory.isCatalogCurrent(previous.catalog, options.catalog)
        ) {
            return previous;
        }
        const captured: TsqlDocumentSource = {
            uri: source.uri,
            languageId: source.languageId,
            version: source.version,
            getText: () => text,
        };
        const document = this.factory.create(captured, options, this.nextGeneration++, previous);
        this.documents.set(key, document);
        if (previous) {
            previous.state = DocumentState.Changed;
            this.workCache.invalidate(previous);
        }
        return document;
    }

    public compute<T>(
        document: TsqlLangiumDocument,
        key: string | symbol,
        work: TsqlDocumentWork<T>,
        cancellationToken?: CancellationTokenLike,
    ): Promise<T> {
        return this.isCurrent(document)
            ? this.workCache.compute(document, key, work, cancellationToken)
            : Promise.reject(new StaleTsqlDocumentError(document.uri.toString(), document.version));
    }

    public delete(uri: URI | string): TsqlLangiumDocument | undefined {
        const key = uriKey(uri);
        const document = this.documents.get(key);
        if (document) {
            this.documents.delete(key);
            document.state = DocumentState.Changed;
            this.workCache.invalidate(document);
        }
        return document;
    }

    public clear(): void {
        for (const document of this.documents.values()) {
            document.state = DocumentState.Changed;
            this.workCache.invalidate(document);
        }
        this.documents.clear();
    }
}

function uriKey(uri: URI | string): string {
    return typeof uri === "string" ? uri : uri.toString();
}
