/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { AstNode, LangiumDocument, Module, TextDocument, URI } from "./langiumRuntime.mjs";
import type {
    SqlAnalysisEngine,
    SqlAnalysisSnapshot,
    SqlCatalogProvider,
} from "../analysis/contracts.js";
import type { CancellationTokenLike } from "../core/cancellation.js";

export interface TsqlDocumentRoot extends AstNode {
    readonly $type: "TsqlDocument";
    readonly length: number;
}

export interface TsqlCatalogMetadata {
    readonly provider?: SqlCatalogProvider;
    readonly revision?: string | number;
    readonly connectionId?: string;
    readonly database?: string;
}

export interface TsqlLangiumDocument extends LangiumDocument<TsqlDocumentRoot> {
    readonly version: number;
    readonly generation: number;
    readonly analysis: SqlAnalysisSnapshot;
    readonly catalog: Readonly<TsqlCatalogMetadata>;
}

export interface TsqlDocumentSource {
    readonly uri: URI;
    readonly languageId: string;
    readonly version: number;
    getText(): string;
}

export interface TsqlWorkContext {
    readonly document: TsqlLangiumDocument;
    readonly signal: AbortSignal;
    readonly cancellationToken: CancellationTokenLike;
    throwIfCancelled(): void;
}

export type TsqlDocumentWork<T> = (context: TsqlWorkContext) => T | Promise<T>;

export interface TsqlDocumentFactoryOptions {
    readonly engine: SqlAnalysisEngine;
    readonly defaultCatalog?: TsqlCatalogMetadata;
}

export interface TsqlDocumentUpdateOptions {
    readonly catalog?: TsqlCatalogMetadata;
    readonly parseText?: string;
    /** Adopts an analysis snapshot already produced by a host integration. */
    readonly analysis?: SqlAnalysisSnapshot;
    readonly cancellationToken?: CancellationTokenLike;
}

export interface TsqlLangiumServices {
    readonly documents: TsqlDocumentService;
}

export type TsqlLangiumModule<T extends object> = Module<TsqlLangiumServices & T, T>;

export interface TsqlDocumentService {
    readonly all: readonly TsqlLangiumDocument[];
    get(uri: URI | string): TsqlLangiumDocument | undefined;
    isCurrent(document: TsqlLangiumDocument): boolean;
    update(source: TsqlDocumentSource, options?: TsqlDocumentUpdateOptions): TsqlLangiumDocument;
    compute<T>(
        document: TsqlLangiumDocument,
        key: string | symbol,
        work: TsqlDocumentWork<T>,
        cancellationToken?: CancellationTokenLike,
    ): Promise<T>;
    delete(uri: URI | string): TsqlLangiumDocument | undefined;
    clear(): void;
}

export type TsqlTextDocument = TextDocument;
