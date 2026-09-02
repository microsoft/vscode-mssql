/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    CatalogSemanticBinder,
    InMemoryMetadataProvider,
    InProcessLanguageServiceRuntime,
    LezerSyntaxService,
    NullMetadataProvider,
    TsqlColorizationService,
    type ColorizationEdit,
    type ColorizedToken,
    type InMemoryMetadataInput,
    type MetadataProvider,
    type ObjectMetadata,
    type SqlColorTokenModifier,
    type SqlColorTokenType,
    type SyntaxService,
    type TextRange,
} from "../../../src/index.ts";

export const uri = "file:///coloring.sql";

interface ColorizationOptions {
    readonly provider?: MetadataProvider;
    readonly range?: TextRange;
    readonly syntax?: SyntaxService;
}

/** Opens one document and colors it with the same snapshot the runtime published. */
export async function colorize(sql: string, options: ColorizationOptions = {}) {
    const session = await openColorizationSession(sql, options);
    return {
        ...session,
        tokens: session.result.tokens,
        described: describeTokens(session.result.tokens, sql),
    };
}

export async function openColorizationSession(sql: string, options: ColorizationOptions = {}) {
    const provider = options.provider ?? new NullMetadataProvider();
    const syntax = options.syntax ?? new LezerSyntaxService();
    const runtime = new InProcessLanguageServiceRuntime(
        syntax,
        new CatalogSemanticBinder(),
        provider,
    );
    const snapshot = await runtime.open(uri, 1, sql);
    const service = new TsqlColorizationService();
    const result = options.range
        ? service.provideRangeColors({ ...snapshot, range: options.range })
        : service.provideDocumentColors(snapshot);
    return { provider, runtime, service, snapshot, result, sql, uri };
}

/** Renders tokens as `text type modifier...` strings so assertions read like the source. */
export function describeTokens(tokens: readonly ColorizedToken[], sql: string): string[] {
    return tokens.map(
        (token) =>
            `${sql.slice(token.start, token.end)} ${token.tokenType}${token.modifiers
                .map((modifier) => ` ${modifier}`)
                .join("")}`,
    );
}

interface TokenClassification {
    readonly type: SqlColorTokenType;
    readonly modifiers: readonly SqlColorTokenModifier[];
}

/** The classification of the nth occurrence of `text`, or undefined when it is not classified. */
export function classificationOf(
    tokens: readonly ColorizedToken[],
    sql: string,
    text: string,
    occurrence = 0,
): TokenClassification | undefined {
    const matches = tokens.filter((token) => sql.slice(token.start, token.end) === text);
    const token = matches[occurrence];
    return token && { type: token.tokenType, modifiers: [...token.modifiers] };
}

/** The standard catalog used by bound-coloring tests. */
export function createColoringMetadata(
    input: InMemoryMetadataInput = {},
): InMemoryMetadataProvider {
    return new InMemoryMetadataProvider({
        environment: { currentDatabase: "db", defaultSchema: "dbo", caseSensitive: false },
        databases: [{ name: "db" }],
        schemas: [{ database: "db", name: "dbo" }],
        objects: [
            catalogObject("customers", "dbo", "Customers", "table"),
            catalogObject("orders", "dbo", "Orders", "table"),
            catalogObject("active", "dbo", "ActiveCustomers", "view"),
            catalogObject("refresh", "dbo", "usp_Refresh", "procedure"),
            catalogObject("rate", "dbo", "fn_Rate", "scalarFunction"),
            catalogObject("split", "dbo", "tvf_Split", "tableFunction"),
        ],
        columns: new Map([
            [
                "customers",
                [
                    { name: "Id", typeDisplay: "int", nullable: false },
                    { name: "Name", typeDisplay: "nvarchar(100)", nullable: true },
                ],
            ],
            ["orders", [{ name: "OrderId", typeDisplay: "int", nullable: false }]],
        ]),
        ...input,
    });
}

export function catalogObject(
    id: string,
    schema: string,
    name: string,
    kind: ObjectMetadata["kind"],
    database = "db",
): ObjectMetadata {
    return { ref: { id, database }, database, schema, name, kind };
}

/** Applies a token-array delta the way a host does, so edits can be compared with a fresh result. */
export function applyColorEdits(
    previous: readonly ColorizedToken[],
    edits: readonly ColorizationEdit[],
): ColorizedToken[] {
    const tokens = [...previous];
    for (const edit of edits) {
        tokens.splice(edit.start, edit.deleteCount, ...(edit.tokens ?? []));
    }
    return tokens;
}

/** Counts parses so coloring can be proven to consume the published snapshot only. */
export function countingSyntaxService(): {
    readonly counts: { parse: number; update: number };
    readonly service: SyntaxService;
} {
    const inner = new LezerSyntaxService();
    const counts = { parse: 0, update: 0 };
    return {
        counts,
        service: {
            parse(document) {
                counts.parse++;
                return inner.parse(document);
            },
            update(previous, document, changes) {
                counts.update++;
                return inner.update(previous, document, changes);
            },
        },
    };
}
