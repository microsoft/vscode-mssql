/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { CancellationTokenLike } from "../core/cancellation.js";
import { TsqlDocumentFactory } from "./documentFactory.js";
import { StaleTsqlDocumentError } from "./errors.js";
import type {
    TsqlDocumentFactoryOptions,
    TsqlDocumentService,
    TsqlDocumentSource,
    TsqlDocumentUpdateOptions,
    TsqlDocumentWork,
    TsqlDocument,
} from "./types.js";
import { TsqlDocumentWorkCache } from "./workCache.js";

/** Owns the current immutable document generation for every URI. */
export class DefaultTsqlDocumentService implements TsqlDocumentService {
    private readonly documents = new Map<string, TsqlDocument>();
    private readonly factory: TsqlDocumentFactory;
    private readonly workCache: TsqlDocumentWorkCache;
    private nextGeneration = 1;

    public constructor(options: TsqlDocumentFactoryOptions) {
        this.factory = new TsqlDocumentFactory(options);
        this.workCache = new TsqlDocumentWorkCache((document) => this.isCurrent(document));
    }

    public get all(): readonly TsqlDocument[] {
        return [...this.documents.values()];
    }

    public get(uri: string): TsqlDocument | undefined {
        return this.documents.get(uri);
    }

    public isCurrent(document: TsqlDocument): boolean {
        return this.get(document.uri) === document;
    }

    public update(
        source: TsqlDocumentSource,
        options: TsqlDocumentUpdateOptions = {},
    ): TsqlDocument {
        const key = source.uri;
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
            this.workCache.invalidate(previous);
        }
        return document;
    }

    public compute<T>(
        document: TsqlDocument,
        key: string | symbol,
        work: TsqlDocumentWork<T>,
        cancellationToken?: CancellationTokenLike,
    ): Promise<T> {
        return this.isCurrent(document)
            ? this.workCache.compute(document, key, work, cancellationToken)
            : Promise.reject(new StaleTsqlDocumentError(document.uri.toString(), document.version));
    }

    public delete(uri: string): TsqlDocument | undefined {
        const document = this.documents.get(uri);
        if (document) {
            this.documents.delete(uri);
            this.workCache.invalidate(document);
        }
        return document;
    }

    public clear(): void {
        for (const document of this.documents.values()) {
            this.workCache.invalidate(document);
        }
        this.documents.clear();
    }
}
