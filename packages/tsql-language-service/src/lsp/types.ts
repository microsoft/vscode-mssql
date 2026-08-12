/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type {
    SqlAnalysisEngine,
    SqlAnalysisSnapshot,
    SqlCatalogProvider,
} from "../analysis/contracts.js";
import type { CancellationTokenLike } from "../core/cancellation.js";

export interface TsqlTextPosition {
    readonly line: number;
    readonly character: number;
}

export interface TsqlTextRange {
    readonly start: TsqlTextPosition;
    readonly end: TsqlTextPosition;
}

export interface TsqlTextDocument {
    readonly uri: string;
    readonly languageId: string;
    readonly version: number;
    readonly lineCount: number;
    getText(range?: TsqlTextRange): string;
    positionAt(offset: number): TsqlTextPosition;
    offsetAt(position: TsqlTextPosition): number;
}

export interface TsqlCatalogMetadata {
    readonly provider?: SqlCatalogProvider;
    readonly revision?: string | number;
    readonly connectionId?: string;
    readonly database?: string;
}

/** Immutable editor text and analysis bound to one document generation. */
export interface TsqlDocument {
    readonly uri: string;
    readonly textDocument: TsqlTextDocument;
    readonly version: number;
    readonly generation: number;
    readonly analysis: SqlAnalysisSnapshot;
    readonly catalog: Readonly<TsqlCatalogMetadata>;
}

export interface TsqlDocumentSource {
    readonly uri: string;
    readonly languageId: string;
    readonly version: number;
    getText(): string;
}

export interface TsqlWorkContext {
    readonly document: TsqlDocument;
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

export interface TsqlServices {
    readonly documents: TsqlDocumentService;
}

/** Lazy service factories receive the complete service graph and are evaluated at most once. */
export type TsqlServiceModule<T extends object> = {
    readonly [K in keyof T]: (services: TsqlServices & T) => T[K];
};

export interface TsqlDocumentService {
    readonly all: readonly TsqlDocument[];
    get(uri: string): TsqlDocument | undefined;
    isCurrent(document: TsqlDocument): boolean;
    update(source: TsqlDocumentSource, options?: TsqlDocumentUpdateOptions): TsqlDocument;
    compute<T>(
        document: TsqlDocument,
        key: string | symbol,
        work: TsqlDocumentWork<T>,
        cancellationToken?: CancellationTokenLike,
    ): Promise<T>;
    delete(uri: string): TsqlDocument | undefined;
    clear(): void;
}
