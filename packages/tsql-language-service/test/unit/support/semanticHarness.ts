/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from "node:assert/strict";

import {
    CatalogSemanticBinder,
    InMemoryMetadataProvider,
    InProcessLanguageServiceRuntime,
    LezerSyntaxService,
    type DocumentAnalysisSnapshot,
    type InMemoryMetadataInput,
    type MetadataProvider,
    type ObjectMetadata,
    type SemanticDiagnostic,
} from "../../../src/index.ts";

interface AnalyzeSqlOptions {
    readonly allowSyntaxDiagnostics?: boolean;
    readonly snapshot?: false;
    readonly uri?: string;
}

interface AnalyzeSqlSnapshotOptions extends Omit<AnalyzeSqlOptions, "snapshot"> {
    readonly snapshot: true;
}

export function analyzeSql(
    sql: string,
    provider?: MetadataProvider,
    options?: AnalyzeSqlOptions,
): Promise<readonly SemanticDiagnostic[]>;
export function analyzeSql(
    sql: string,
    provider: MetadataProvider | undefined,
    options: AnalyzeSqlSnapshotOptions,
): Promise<DocumentAnalysisSnapshot>;
/** Runs public syntax and semantic analysis against one immutable metadata provider. */
export async function analyzeSql(
    sql: string,
    provider: MetadataProvider = createMetadata(),
    options: AnalyzeSqlOptions | AnalyzeSqlSnapshotOptions = {},
): Promise<readonly SemanticDiagnostic[] | DocumentAnalysisSnapshot> {
    const runtime = new InProcessLanguageServiceRuntime(
        new LezerSyntaxService(),
        new CatalogSemanticBinder(),
        provider,
    );
    const snapshot = await runtime.open(options.uri ?? "file:///semantic-diagnostics.sql", 1, sql);
    if (!options.allowSyntaxDiagnostics) assert.deepEqual(snapshot.syntax.diagnostics, []);
    return options.snapshot ? snapshot : snapshot.semantics.diagnostics;
}

interface SemanticHarnessOptions {
    readonly metadata?: InMemoryMetadataInput;
    readonly provider?: MetadataProvider;
    readonly uri?: string;
}

interface SemanticHarnessRunOptions {
    readonly allowSyntaxDiagnostics?: boolean;
    readonly snapshot?: false;
}

interface SemanticHarnessSnapshotRunOptions extends Omit<SemanticHarnessRunOptions, "snapshot"> {
    readonly snapshot: true;
}

export interface SemanticHarness {
    analyze(
        sql: string,
        options?: SemanticHarnessRunOptions,
    ): Promise<readonly SemanticDiagnostic[]>;
    analyze(
        sql: string,
        options: SemanticHarnessSnapshotRunOptions,
    ): Promise<DocumentAnalysisSnapshot>;
    open(sql: string): Promise<DocumentAnalysisSnapshot>;
    readonly provider: MetadataProvider;
}

/** Creates stable analyze/open helpers for one diagnostic domain without duplicating runtime setup. */
export function createSemanticHarness(options: SemanticHarnessOptions = {}): SemanticHarness {
    const provider = options.provider ?? createMetadata(options.metadata);
    const uri = options.uri ?? "file:///semantic-diagnostics.sql";

    function analyze(
        sql: string,
        runOptions?: SemanticHarnessRunOptions,
    ): Promise<readonly SemanticDiagnostic[]>;
    function analyze(
        sql: string,
        runOptions: SemanticHarnessSnapshotRunOptions,
    ): Promise<DocumentAnalysisSnapshot>;
    function analyze(
        sql: string,
        runOptions: SemanticHarnessRunOptions | SemanticHarnessSnapshotRunOptions = {},
    ): Promise<readonly SemanticDiagnostic[] | DocumentAnalysisSnapshot> {
        if (runOptions.snapshot) {
            return analyzeSql(sql, provider, { ...runOptions, uri });
        }
        return analyzeSql(sql, provider, { ...runOptions, uri });
    }

    return Object.freeze({
        analyze,
        open(sql: string) {
            return analyzeSql(sql, provider, {
                allowSyntaxDiagnostics: true,
                snapshot: true,
                uri,
            });
        },
        provider,
    });
}

/** Builds the standard complete, case-insensitive database catalog used by diagnostic tests. */
export function createMetadata(input: InMemoryMetadataInput = {}): InMemoryMetadataProvider {
    return new InMemoryMetadataProvider({
        environment: { currentDatabase: "db", defaultSchema: "dbo" },
        schemas: [{ database: "db", name: "dbo" }],
        databases: [{ name: "db" }],
        ...input,
    });
}

export function table(id: string, schema: string, name: string, database = "db"): ObjectMetadata {
    return { ref: { id, database }, database, schema, name, kind: "table" };
}

export function messages(diagnostics: readonly SemanticDiagnostic[]): string[] {
    return diagnostics.map(({ message }) => message);
}
