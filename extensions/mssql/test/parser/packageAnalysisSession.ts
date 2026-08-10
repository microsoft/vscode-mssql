/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    SaralSqlAnalysisEngine,
    type SqlAnalysisSnapshot,
    type SqlCatalogProvider,
    type SqlSymbol,
    type SqlType,
} from "@vscode-mssql/tsql-language-service";

const engine = new SaralSqlAnalysisEngine();

/** Small test facade preserving scenario readability while exercising only the package contract. */
export class PackageAnalysisSession {
    public readonly doc: {
        readonly statements: SqlAnalysisSnapshot["statements"];
        readonly version: number;
        readonly uri?: string;
    };

    private constructor(public readonly snapshot: SqlAnalysisSnapshot) {
        this.doc = {
            statements: snapshot.statements,
            version: snapshot.version,
            uri: snapshot.uri,
        };
    }

    public static create(
        text: string,
        options: { readonly schema?: SqlCatalogProvider; readonly uri?: string } = {},
    ): PackageAnalysisSession {
        return new PackageAnalysisSession(
            engine.createSnapshot({ text, catalog: options.schema, uri: options.uri }),
        );
    }

    public get text(): string {
        return this.snapshot.text;
    }

    public get tokens() {
        return this.snapshot.tokens;
    }

    public get syntaxDiagnostics() {
        return this.snapshot.syntaxDiagnostics;
    }

    public diagnostics() {
        return [...this.snapshot.syntaxDiagnostics, ...this.snapshot.semanticDiagnostics];
    }

    public completeAt(offset: number) {
        return this.snapshot.completeAt(offset).items;
    }

    public referencesAt(offset: number) {
        return this.snapshot.referencesAt(offset);
    }

    public deriveSymbols() {
        return this.snapshot.symbols();
    }

    public typeAt(offset: number) {
        return this.snapshot.typeAt(offset);
    }

    public signatureAt(offset: number) {
        return this.snapshot.signatureAt(offset);
    }
}

export function formatAnalysisType(type: SqlType): string {
    return type.display;
}

export function symbolAt(symbols: readonly SqlSymbol[], offset: number): SqlSymbol | undefined {
    return symbols
        .filter((symbol) => symbol.span.start <= offset && offset < symbol.span.end)
        .sort(
            (left, right) =>
                Number(Boolean(right.type)) - Number(Boolean(left.type)) ||
                Number(Boolean(right.definition)) - Number(Boolean(left.definition)) ||
                left.span.end - left.span.start - (right.span.end - right.span.start),
        )[0];
}
