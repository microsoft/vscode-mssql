/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { DiagnosticSeverity, type Diagnostic } from "vscode-languageserver-types";
import type { SqlDiagnostic } from "../../analysis/contracts.js";
import type { SqlFeatureDocument, SqlFeatureDocumentAccessor } from "./featureDocument.js";
import { offsetsToRange } from "./rangeUtils.js";

export interface SqlFullDocumentDiagnosticReport {
    readonly kind: "full";
    readonly resultId: string;
    readonly items: readonly Diagnostic[];
}

export interface SqlUnchangedDocumentDiagnosticReport {
    readonly kind: "unchanged";
    readonly resultId: string;
}

export type SqlDocumentDiagnosticReport =
    | SqlFullDocumentDiagnosticReport
    | SqlUnchangedDocumentDiagnosticReport;

/** LSP 3.17-style pull diagnostics over the same immutable snapshots used by push publication. */
export class SqlDiagnosticProvider {
    public constructor(private readonly documents: SqlFeatureDocumentAccessor) {}

    public async getDocumentDiagnostics(
        uri: string,
        previousResultId?: string,
    ): Promise<SqlDocumentDiagnosticReport> {
        const document = await this.documents.getDocument(uri);
        if (!document) {
            return { kind: "full", resultId: "missing", items: [] };
        }
        const diagnostics = [
            ...document.analysis.syntaxDiagnostics,
            ...document.analysis.semanticDiagnostics,
        ];
        const resultId = diagnosticResultId(document, diagnostics);
        if (previousResultId === resultId) {
            return { kind: "unchanged", resultId };
        }
        return {
            kind: "full",
            resultId,
            items: diagnostics.map((diagnostic) => mapDiagnostic(document, diagnostic)),
        };
    }
}

function mapDiagnostic(document: SqlFeatureDocument, diagnostic: SqlDiagnostic): Diagnostic {
    return {
        range: offsetsToRange(document, diagnostic.span.start, diagnostic.span.end),
        severity: severity(diagnostic.severity),
        code: diagnostic.code,
        source: "vscode-mssql",
        message: diagnostic.message,
    };
}

function severity(value: SqlDiagnostic["severity"]): DiagnosticSeverity {
    switch (value) {
        case "error":
            return DiagnosticSeverity.Error;
        case "warning":
            return DiagnosticSeverity.Warning;
        case "information":
            return DiagnosticSeverity.Information;
        case "hint":
            return DiagnosticSeverity.Hint;
    }
}

function diagnosticResultId(
    document: SqlFeatureDocument,
    diagnostics: readonly SqlDiagnostic[],
): string {
    let hash = 2_166_136_261;
    const add = (value: string): void => {
        for (let index = 0; index < value.length; index++) {
            hash = Math.imul(hash ^ value.charCodeAt(index), 16_777_619) >>> 0;
        }
    };
    add(String(document.version ?? document.analysis.version));
    for (const diagnostic of diagnostics) {
        add(
            `${diagnostic.kind}\0${diagnostic.code}\0${diagnostic.severity}\0${diagnostic.span.start}\0${diagnostic.span.end}\0${diagnostic.message}`,
        );
    }
    return `${document.version ?? document.analysis.version}:${hash.toString(16)}`;
}
