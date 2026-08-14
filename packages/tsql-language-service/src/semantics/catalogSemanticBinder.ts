/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { ObjectMetadata } from "../metadata/index.js";
import type { SyntaxNode } from "../syntax/index.js";
import type { TextRange } from "../text/index.js";
import type {
    BindInput,
    BoundReference,
    BoundUnit,
    SemanticBinder,
    SemanticDiagnostic,
    SemanticSnapshot,
    SemanticSymbol,
    SymbolId,
} from "./contracts.js";
import { vectorSemanticDiagnostics } from "./vectorSemanticDiagnostics.js";

/**
 * Binds catalog-backed object references without constructing an eager typed AST. The binder walks
 * only structural table/target nodes and keeps metadata pinned for the lifetime of the snapshot.
 */
export class CatalogSemanticBinder implements SemanticBinder {
    public bind(input: BindInput): SemanticSnapshot {
        const started = performance.now();
        const symbols = new Map<SymbolId, SemanticSymbol>();
        const referencesBySymbol = new Map<SymbolId, BoundReference[]>();
        const referenceSymbols: { readonly range: TextRange; readonly symbol: SymbolId }[] = [];
        const declarationSymbols: { readonly range: TextRange; readonly symbol: SymbolId }[] = [];
        const units: BoundUnit[] = [];
        const diagnostics: SemanticDiagnostic[] = [];
        const batches = [...input.syntax.root().children()].filter((node) => node.kind === "Batch");

        for (const batch of batches) {
            const unitReferences: BoundReference[] = [];
            const unitSymbols = new Map<SymbolId, SemanticSymbol>();
            const dependencies = new Set<string>();
            const declarationRanges = new Set<string>();
            const columnsBySource = new Map<SymbolId, Map<string, SymbolId>>();
            const sourceByQualifier = new Map<string, SymbolId>();
            const unitDiagnostics = vectorSemanticDiagnostics(input.syntax, batch);
            diagnostics.push(...unitDiagnostics);
            const registerSymbol = (symbol: SemanticSymbol): void => {
                symbols.set(symbol.id, symbol);
                unitSymbols.set(symbol.id, symbol);
                if (symbol.declaration) {
                    declarationRanges.add(rangeKey(symbol.declaration));
                    declarationSymbols.push({ range: symbol.declaration, symbol: symbol.id });
                }
            };
            const registerReference = (reference: BoundReference): void => {
                unitReferences.push(reference);
                if (!reference.symbol) return;
                const references = referencesBySymbol.get(reference.symbol) ?? [];
                references.push(reference);
                referencesBySymbol.set(reference.symbol, references);
                referenceSymbols.push({ range: reference, symbol: reference.symbol });
            };
            const registerColumns = (owner: SemanticSymbol, root: SyntaxNode): void => {
                const members = new Map<string, SymbolId>();
                for (const column of descendants(root, "ColumnDefinition")) {
                    const nameNode = firstDescendant(column, "IdentifierName");
                    if (!nameNode) continue;
                    const name = normalizeIdentifier(
                        input.syntax.document.text.slice(nameNode.start, nameNode.end),
                    );
                    const typeNode = firstDescendant(column, "DataType");
                    const source = input.syntax.document.text.slice(column.start, column.end);
                    const symbol: SemanticSymbol = {
                        id: `${owner.id}:column:${name.toLocaleLowerCase()}`,
                        name,
                        kind: "column",
                        declaration: { start: nameNode.start, end: nameNode.end },
                        ...(typeNode
                            ? {
                                  type: {
                                      displayName: input.syntax.document.text.slice(
                                          typeNode.start,
                                          typeNode.end,
                                      ),
                                      nullable: !/\bNOT\s+NULL\b/iu.test(source),
                                  },
                              }
                            : {}),
                    };
                    registerSymbol(symbol);
                    members.set(name.toLocaleLowerCase(), symbol.id);
                }
                columnsBySource.set(owner.id, members);
            };
            const registerProjectedColumns = (owner: SemanticSymbol, root: SyntaxNode): void => {
                const explicit = directChild(root, "ColumnNameList");
                const names = explicit
                    ? descendants(explicit, "IdentifierName")
                    : descendants(firstDescendant(root, "SelectList") ?? root, "SelectElement")
                          .filter((element) => !firstDescendant(element, "Star"))
                          .flatMap((element) => {
                              const identifiers = descendants(element, "IdentifierName");
                              return identifiers.length > 0 ? [identifiers.at(-1)!] : [];
                          });
                const members = new Map<string, SymbolId>();
                for (const nameNode of names) {
                    const name = normalizeIdentifier(
                        input.syntax.document.text.slice(nameNode.start, nameNode.end),
                    );
                    const symbol: SemanticSymbol = {
                        id: `${owner.id}:column:${name.toLocaleLowerCase()}`,
                        name,
                        kind: "column",
                        declaration: { start: nameNode.start, end: nameNode.end },
                    };
                    registerSymbol(symbol);
                    members.set(name.toLocaleLowerCase(), symbol.id);
                }
                columnsBySource.set(owner.id, members);
            };

            // Local declarations are indexed before references so aliases, variables, CTEs, and
            // temporary tables remain available even when the cursor precedes their textual use.
            visit(batch, (node) => {
                if (node.kind === "VariableDeclaration" || node.kind === "ProcedureParameter") {
                    const variable = firstDescendant(node, "Variable");
                    if (!variable) return;
                    const name = input.syntax.document.text.slice(variable.start, variable.end);
                    const typeNode =
                        firstDescendant(node, "DataType") ?? firstDescendant(node, "Cursor");
                    const displayName =
                        typeNode && input.syntax.document.text.slice(typeNode.start, typeNode.end);
                    const symbol: SemanticSymbol = {
                        id: `variable:${batch.start}:${normalizeIdentifier(name).toLocaleLowerCase()}`,
                        name,
                        kind: "variable",
                        declaration: { start: variable.start, end: variable.end },
                        ...(displayName ? { type: { displayName, nullable: true } } : {}),
                    };
                    registerSymbol(symbol);
                    const tableDefinition = firstDescendant(node, "TableDefinition");
                    if (tableDefinition) registerColumns(symbol, tableDefinition);
                } else if (node.kind === "CommonTableExpression") {
                    const nameNode = firstDescendant(node, "IdentifierName");
                    if (!nameNode) return;
                    const name = normalizeIdentifier(
                        input.syntax.document.text.slice(nameNode.start, nameNode.end),
                    );
                    const symbol: SemanticSymbol = {
                        id: `cte:${batch.start}:${name.toLocaleLowerCase()}`,
                        name,
                        kind: "cte",
                        declaration: { start: nameNode.start, end: nameNode.end },
                    };
                    registerSymbol(symbol);
                    registerProjectedColumns(symbol, node);
                } else if (node.kind === "CreateTableStatement") {
                    const nameNode = firstDescendant(node, "MultipartIdentifier");
                    if (!nameNode) return;
                    const parts = multipartIdentifierParts(
                        input.syntax.document.text.slice(nameNode.start, nameNode.end),
                    );
                    const name = parts.at(-1);
                    if (!name) return;
                    const symbol: SemanticSymbol = {
                        id: `local-table:${batch.start}:${name.toLocaleLowerCase()}`,
                        name,
                        kind: name.startsWith("#") ? "tempTable" : "localTable",
                        declaration: { start: nameNode.start, end: nameNode.end },
                    };
                    registerSymbol(symbol);
                    const definition = firstDescendant(node, "TableDefinition");
                    if (definition) registerColumns(symbol, definition);
                }
            });

            visit(batch, (node) => {
                if (node.kind !== "NamedTableSource" && node.kind !== "DmlTarget") return;
                const name = firstDescendant(node, "MultipartIdentifier");
                if (!name) return;
                const parts = multipartIdentifierParts(
                    input.syntax.document.text.slice(name.start, name.end),
                );
                if (parts.length === 0) return;
                const resolution = input.metadata.resolveObject(parts);
                const local = [...unitSymbols.values()].find(
                    (symbol) =>
                        (symbol.kind === "cte" ||
                            symbol.kind === "tempTable" ||
                            symbol.kind === "localTable") &&
                        normalizeIdentifier(symbol.name).toLocaleLowerCase() ===
                            normalizeIdentifier(parts.at(-1)!).toLocaleLowerCase(),
                );
                if (resolution.kind !== "resolved" && !local) {
                    registerReference({
                        start: name.start,
                        end: name.end,
                        unresolvedName: parts,
                        write: node.kind === "DmlTarget",
                    });
                    return;
                }
                const symbol =
                    resolution.kind === "resolved" ? catalogSymbol(resolution.object) : local!;
                if (resolution.kind === "resolved") {
                    symbols.set(symbol.id, symbol);
                    unitSymbols.set(symbol.id, symbol);
                    dependencies.add(resolution.object.ref.id);
                }
                sourceByQualifier.set(
                    normalizeIdentifier(parts.at(-1)!).toLocaleLowerCase(),
                    symbol.id,
                );
                if (resolution.kind === "resolved") {
                    const columnState = input.metadata.columnState(resolution.object.ref);
                    if (columnState.kind === "loaded") {
                        const members = new Map<string, SymbolId>();
                        for (const column of columnState.value) {
                            const columnSymbol: SemanticSymbol = {
                                id: `${symbol.id}:column:${column.name.toLocaleLowerCase()}`,
                                name: column.name,
                                kind: "column",
                                object: resolution.object.ref,
                                type: {
                                    displayName: column.typeDisplay ?? "column",
                                    nullable: column.nullable ?? true,
                                },
                            };
                            registerSymbol(columnSymbol);
                            members.set(column.name.toLocaleLowerCase(), columnSymbol.id);
                        }
                        columnsBySource.set(symbol.id, members);
                    }
                }
                const reference: BoundReference = {
                    start: name.start,
                    end: name.end,
                    symbol: symbol.id,
                    write: node.kind === "DmlTarget",
                };
                registerReference(reference);

                if (node.kind === "NamedTableSource") {
                    const alias = firstDescendant(node, "TableAlias");
                    const aliasName = alias && lastDescendant(alias, "IdentifierName");
                    if (aliasName) {
                        const text = input.syntax.document.text.slice(
                            aliasName.start,
                            aliasName.end,
                        );
                        const aliasSymbol: SemanticSymbol = {
                            id: `alias:${aliasName.start}:${normalizeIdentifier(text)}`,
                            name: normalizeIdentifier(text),
                            kind: "alias",
                            declaration: { start: aliasName.start, end: aliasName.end },
                            ...(resolution.kind === "resolved"
                                ? { object: resolution.object.ref }
                                : {}),
                        };
                        registerSymbol(aliasSymbol);
                        sourceByQualifier.set(aliasSymbol.name.toLocaleLowerCase(), symbol.id);
                    }
                }
            });

            // Bind local variable uses and alias qualifiers after declarations and sources exist.
            visit(batch, (node) => {
                if (node.kind === "Variable" && !declarationRanges.has(rangeKey(node))) {
                    const name = input.syntax.document.text.slice(node.start, node.end);
                    const symbol = [...unitSymbols.values()].find(
                        (candidate) =>
                            candidate.kind === "variable" &&
                            candidate.name.toLocaleLowerCase() === name.toLocaleLowerCase(),
                    );
                    if (symbol) {
                        registerReference({
                            start: node.start,
                            end: node.end,
                            symbol: symbol.id,
                            write: false,
                        });
                    }
                } else if (node.kind === "ColumnReference") {
                    const text = input.syntax.document.text.slice(node.start, node.end);
                    const dot = text.indexOf(".");
                    if (dot <= 0) return;
                    const qualifier = normalizeIdentifier(text.slice(0, dot).trim());
                    const symbol = [...unitSymbols.values()].find(
                        (candidate) =>
                            candidate.kind === "alias" &&
                            candidate.name.toLocaleLowerCase() === qualifier.toLocaleLowerCase(),
                    );
                    if (symbol) {
                        registerReference({
                            start: node.start,
                            end: node.start + dot,
                            symbol: symbol.id,
                            write: false,
                        });
                    }
                    const parts = multipartIdentifierParts(text);
                    const columnName = parts.at(-1)?.toLocaleLowerCase();
                    const sourceId = sourceByQualifier.get(qualifier.toLocaleLowerCase());
                    const columnId =
                        sourceId && columnName && columnsBySource.get(sourceId)?.get(columnName);
                    if (columnId) {
                        const columnStart = lastIdentifierStart(node, text);
                        registerReference({
                            start: columnStart,
                            end: node.end,
                            symbol: columnId,
                            write: false,
                        });
                    }
                }
            });
            units.push({
                kind: "batch",
                range: { start: batch.start, end: batch.end },
                syntaxFingerprint: `${batch.start}:${batch.end}:${hashText(
                    input.syntax.document.text.slice(batch.start, batch.end),
                )}`,
                incomingEnvironmentVersion: `${input.metadata.generation}`,
                exportedEnvironmentVersion: `${input.metadata.generation}`,
                metadataDependencies: Object.freeze([...dependencies]),
                symbols: Object.freeze([...unitSymbols.values()]),
                references: Object.freeze(unitReferences),
                diagnostics: Object.freeze([...unitDiagnostics]),
            });
        }

        return new CatalogSemanticSnapshot(
            input.syntax.document.version,
            input.metadata.generation,
            Object.freeze(units),
            symbols,
            referencesBySymbol,
            referenceSymbols,
            declarationSymbols,
            Object.freeze(diagnostics),
            performance.now() - started,
        );
    }

    public update(_previous: SemanticSnapshot, input: BindInput): SemanticSnapshot {
        return this.bind(input);
    }
}

class CatalogSemanticSnapshot implements SemanticSnapshot {
    public readonly statistics;

    public constructor(
        public readonly documentVersion: number,
        public readonly metadataGeneration: number,
        public readonly units: readonly BoundUnit[],
        private readonly _symbols: ReadonlyMap<SymbolId, SemanticSymbol>,
        private readonly _references: ReadonlyMap<SymbolId, readonly BoundReference[]>,
        private readonly _referenceSymbols: readonly {
            readonly range: TextRange;
            readonly symbol: SymbolId;
        }[],
        private readonly _declarationSymbols: readonly {
            readonly range: TextRange;
            readonly symbol: SymbolId;
        }[],
        public readonly diagnostics: readonly SemanticDiagnostic[],
        elapsedMs: number,
    ) {
        this.statistics = Object.freeze({
            unitsExamined: units.length,
            unitsReused: 0,
            unitsRebound: units.length,
            elapsedMs,
        });
    }

    public symbolAt(offset: number): SemanticSymbol | undefined {
        const occurrence = [...this._declarationSymbols, ...this._referenceSymbols].find(
            ({ range }) => range.start <= offset && offset <= range.end,
        );
        return occurrence ? this._symbols.get(occurrence.symbol) : undefined;
    }

    public references(symbol: SymbolId): readonly BoundReference[] {
        return this._references.get(symbol) ?? [];
    }

    public visibleSymbols(offset: number): readonly SemanticSymbol[] {
        const unit = this.units.find(
            (candidate) => candidate.range.start <= offset && offset <= candidate.range.end,
        );
        return (
            unit?.symbols.filter(
                (symbol) =>
                    symbol.kind !== "variable" ||
                    !symbol.declaration ||
                    symbol.declaration.start <= offset,
            ) ?? []
        );
    }
}

function catalogSymbol(object: ObjectMetadata): SemanticSymbol {
    return {
        id: `catalog:${object.ref.id}`,
        name: `${object.schema}.${object.name}`,
        kind: object.kind,
        object: object.ref,
    };
}

function visit(node: SyntaxNode, callback: (node: SyntaxNode) => void): void {
    callback(node);
    for (const child of node.children()) visit(child, callback);
}

function firstDescendant(node: SyntaxNode, kind: string): SyntaxNode | undefined {
    for (const child of node.children()) {
        if (child.kind === kind) return child;
        const nested = firstDescendant(child, kind);
        if (nested) return nested;
    }
    return undefined;
}

function lastDescendant(node: SyntaxNode, kind: string): SyntaxNode | undefined {
    let result: SyntaxNode | undefined;
    visit(node, (candidate) => {
        if (candidate.kind === kind) result = candidate;
    });
    return result;
}

function descendants(node: SyntaxNode, kind: string): SyntaxNode[] {
    const result: SyntaxNode[] = [];
    visit(node, (candidate) => {
        if (candidate !== node && candidate.kind === kind) result.push(candidate);
    });
    return result;
}

function directChild(node: SyntaxNode, kind: string): SyntaxNode | undefined {
    return [...node.children()].find((child) => child.kind === kind);
}

function lastIdentifierStart(node: SyntaxNode, text: string): number {
    const match = /(?:\[(?:[^\]]|\]\])*\]|"(?:[^"]|"")*"|[\p{L}_#][\p{L}\p{N}_$#@]*)\s*$/u.exec(
        text,
    );
    return match?.index === undefined ? node.start : node.start + match.index;
}

export function multipartIdentifierParts(text: string): readonly string[] {
    const parts: string[] = [];
    const matcher = /\[(?:[^\]]|\]\])*\]|"(?:[^"]|"")*"|[^.\s]+/gu;
    for (const match of text.matchAll(matcher)) parts.push(normalizeIdentifier(match[0]));
    return parts;
}

export function normalizeIdentifier(value: string): string {
    if (value.startsWith("[") && value.endsWith("]")) {
        return value.slice(1, -1).replaceAll("]]", "]");
    }
    if (value.startsWith('"') && value.endsWith('"')) {
        return value.slice(1, -1).replaceAll('""', '"');
    }
    return value;
}

function hashText(text: string): string {
    let hash = 2166136261;
    for (let index = 0; index < text.length; index++) {
        hash ^= text.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(16);
}

function rangeKey(range: TextRange): string {
    return `${range.start}:${range.end}`;
}
