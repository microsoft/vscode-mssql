/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { analysisProfileKey, resolveAnalysisProfile } from "../common/analysisProfile.js";
import { lookupBuiltIn } from "../common/builtInRegistry.js";
import type { ColumnMetadata, ObjectMetadata, ObjectRef } from "../metadata/index.js";
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
import {
    collectTsqlSemanticDiagnosticsWithState,
    type TsqlSemanticDiagnosticState,
} from "./tsqlSemanticDiagnostics.js";
import { vectorSemanticDiagnostics } from "./vectorSemanticDiagnostics.js";

/**
 * Binds catalog-backed object references without constructing an eager typed AST. The binder walks
 * only structural table/target nodes and keeps metadata pinned for the lifetime of the snapshot.
 */
export class CatalogSemanticBinder implements SemanticBinder {
    public bind(input: BindInput): SemanticSnapshot {
        return this.bindCore(input);
    }

    private bindCore(input: BindInput, previous?: SemanticSnapshot): SemanticSnapshot {
        const started = performance.now();
        const symbols = new Map<SymbolId, SemanticSymbol>();
        const referencesBySymbol = new Map<SymbolId, BoundReference[]>();
        const referenceSymbols: { readonly range: TextRange; readonly symbol: SymbolId }[] = [];
        const declarationSymbols: { readonly range: TextRange; readonly symbol: SymbolId }[] = [];
        const units: BoundUnit[] = [];
        const diagnostics: SemanticDiagnostic[] = [];
        const batches = [...input.syntax.root().children()].filter((node) => node.kind === "Batch");
        const reusePlan = planReusableUnits(input, batches, previous);
        const reboundRanges = batches
            .filter((_batch, index) => !reusePlan.units[index])
            .map((batch) => ({ start: batch.start, end: batch.end }));
        const priorSnapshot = previous instanceof CatalogSemanticSnapshot ? previous : undefined;
        const reusableDiagnosticState =
            priorSnapshot && semanticEnvironmentIsPositionStable(batches, reusePlan, priorSnapshot)
                ? priorSnapshot.diagnosticState
                : undefined;
        const diagnosticResult =
            reboundRanges.length === 0
                ? { diagnostics: [], state: priorSnapshot?.diagnosticState }
                : collectTsqlSemanticDiagnosticsWithState(
                      input.syntax,
                      input.metadata,
                      reboundRanges.length === batches.length ? undefined : reboundRanges,
                      reusableDiagnosticState
                          ? batches.filter((_batch, index) => !reusePlan.units[index])
                          : undefined,
                      reusableDiagnosticState,
                      resolveAnalysisProfile(input.profile),
                  );
        const tsqlDiagnostics = diagnosticResult.diagnostics;
        let unitsReused = 0;

        const appendReusedUnit = (unit: BoundUnit): void => {
            units.push(unit);
            diagnostics.push(...unit.diagnostics);
            for (const symbol of unit.symbols) {
                symbols.set(symbol.id, symbol);
                if (symbol.declaration) {
                    declarationSymbols.push({ range: symbol.declaration, symbol: symbol.id });
                }
            }
            for (const reference of unit.references) {
                if (!reference.symbol) continue;
                const references = referencesBySymbol.get(reference.symbol) ?? [];
                references.push(reference);
                referencesBySymbol.set(reference.symbol, references);
                referenceSymbols.push({ range: reference, symbol: reference.symbol });
            }
        };

        for (const [batchIndex, batch] of batches.entries()) {
            const reused = reusePlan.units[batchIndex];
            if (reused) {
                appendReusedUnit(reused);
                unitsReused++;
                continue;
            }
            const unitReferences: BoundReference[] = [];
            const unitSymbols = new Map<SymbolId, SemanticSymbol>();
            const dependencies = new Set<string>();
            const declarationRanges = new Set<string>();
            const columnsBySource = new Map<SymbolId, Map<string, SymbolId>>();
            const dmlTargets = new Map<string, SymbolId>();
            const sourcesByQuery = new Map<string, Map<string, QuerySourceBinding>>();
            const fold = (value: string): string =>
                input.metadata.environment.caseSensitive
                    ? normalizeIdentifier(value)
                    : normalizeIdentifier(value).toLocaleLowerCase();
            const unitDiagnostics = [
                ...vectorSemanticDiagnostics(input.syntax, batch),
                ...tsqlDiagnostics.filter(
                    (diagnostic) =>
                        batch.start <= diagnostic.range.start && diagnostic.range.end <= batch.end,
                ),
            ];
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
            const registerQuerySource = (
                node: SyntaxNode,
                qualifier: string,
                source: SymbolId,
                qualifierSymbol = source,
            ): void => {
                const query = ancestorNode(node, "QuerySpecification");
                if (!query) return;
                const key = rangeKey(query);
                const bindings = sourcesByQuery.get(key) ?? new Map<string, QuerySourceBinding>();
                bindings.set(fold(qualifier), { source, qualifierSymbol });
                sourcesByQuery.set(key, bindings);
            };
            const visibleSource = (
                node: SyntaxNode,
                qualifier: string,
            ): QuerySourceBinding | undefined => {
                let query = ancestorNode(node, "QuerySpecification") ?? trailingClauseQuery(node);
                while (query) {
                    const binding = sourcesByQuery.get(rangeKey(query))?.get(fold(qualifier));
                    if (binding) return binding;
                    query = correlatableOuterQuery(query);
                }
                return undefined;
            };
            const visibleSourceScopes = (node: SyntaxNode): readonly QuerySourceBinding[][] => {
                const result: QuerySourceBinding[][] = [];
                let query = ancestorNode(node, "QuerySpecification") ?? trailingClauseQuery(node);
                while (query) {
                    result.push([...new Set(sourcesByQuery.get(rangeKey(query))?.values() ?? [])]);
                    query = correlatableOuterQuery(query);
                }
                return result;
            };
            /** The column of the object a DML statement writes, when the name is one of them. */
            const dmlTargetColumn = (
                node: SyntaxNode,
                columnName: string,
            ): SymbolId | undefined => {
                const statement = dmlStatement(node);
                const target = statement && dmlTargets.get(rangeKey(statement));
                return target ? columnsBySource.get(target)?.get(columnName) : undefined;
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
                const explicit =
                    root.kind === "ColumnNameList" ? root : directChild(root, "ColumnNameList");
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
            const registerMetadataColumns = (
                owner: SemanticSymbol,
                object: ObjectMetadata,
                columns: readonly ColumnMetadata[],
            ): void => {
                const members = new Map<string, SymbolId>();
                for (const column of columns) {
                    const columnSymbol: SemanticSymbol = {
                        id: `${owner.id}:column:${fold(column.name)}`,
                        name: column.name,
                        kind: "column",
                        object: object.ref,
                        type: {
                            displayName: column.typeDisplay ?? "column",
                            nullable: column.nullable ?? true,
                        },
                    };
                    registerSymbol(columnSymbol);
                    members.set(fold(column.name), columnSymbol.id);
                }
                columnsBySource.set(owner.id, members);
            };
            const registerSyntheticColumn = (
                owner: SemanticSymbol,
                name: string,
                type: string,
            ): void => {
                const symbol: SemanticSymbol = {
                    id: `${owner.id}:column:${fold(name)}`,
                    name,
                    kind: "column",
                    type: { displayName: type, nullable: true },
                };
                registerSymbol(symbol);
                const members = columnsBySource.get(owner.id) ?? new Map<string, SymbolId>();
                members.set(fold(name), symbol.id);
                columnsBySource.set(owner.id, members);
            };
            const registerBuiltInRowsetColumns = (
                owner: SemanticSymbol,
                node: SyntaxNode,
            ): void => {
                const name = firstDescendant(node, "MultipartIdentifier");
                const parts = name
                    ? multipartIdentifierParts(
                          input.syntax.document.text.slice(name.start, name.end),
                      )
                    : [];
                if (parts.at(-1)?.toLocaleUpperCase() === "OPENJSON") {
                    registerSyntheticColumn(owner, "key", "nvarchar(4000)");
                    registerSyntheticColumn(owner, "value", "nvarchar(max)");
                    registerSyntheticColumn(owner, "type", "int");
                }
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
                if (node.kind === "DmlTarget") {
                    const statement = dmlStatement(node);
                    if (statement) dmlTargets.set(rangeKey(statement), symbol.id);
                }

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
                        registerQuerySource(node, aliasSymbol.name, symbol.id, aliasSymbol.id);
                    } else {
                        registerQuerySource(node, parts.at(-1)!, symbol.id);
                    }
                }
            });

            // Rowset aliases have real scope and projected members even when they do not resolve
            // to a persisted catalog object (derived tables, OPENJSON, XML nodes, and variables).
            visit(batch, (node) => {
                if (
                    node.kind !== "DerivedTable" &&
                    node.kind !== "FunctionTableSource" &&
                    node.kind !== "VariableTableSource" &&
                    node.kind !== "VectorSearchTableSource"
                ) {
                    return;
                }
                const alias =
                    directChild(node, "TableAlias") ?? firstDescendant(node, "TableAlias");
                const aliasName = alias && lastDescendant(alias, "IdentifierName");
                const variable =
                    node.kind === "VariableTableSource"
                        ? firstDescendant(node, "Variable")
                        : undefined;
                const nameNode = firstDescendant(node, "MultipartIdentifier");
                const parts = nameNode
                    ? multipartIdentifierParts(
                          input.syntax.document.text.slice(nameNode.start, nameNode.end),
                      )
                    : [];
                const qualifier = aliasName
                    ? normalizeIdentifier(
                          input.syntax.document.text.slice(aliasName.start, aliasName.end),
                      )
                    : variable
                      ? input.syntax.document.text.slice(variable.start, variable.end)
                      : parts.at(-1);
                if (!qualifier) return;

                if (node.kind === "VariableTableSource" && variable) {
                    const variableName = input.syntax.document.text.slice(
                        variable.start,
                        variable.end,
                    );
                    const owner = [...unitSymbols.values()].find(
                        (candidate) =>
                            candidate.kind === "variable" &&
                            fold(candidate.name) === fold(variableName),
                    );
                    if (!owner) return;
                    if (aliasName) {
                        const aliasSymbol = rowsetAliasSymbol(aliasName, qualifier);
                        registerSymbol(aliasSymbol);
                        registerQuerySource(node, qualifier, owner.id, aliasSymbol.id);
                    } else {
                        registerQuerySource(node, qualifier, owner.id);
                    }
                    return;
                }

                let owner: SemanticSymbol | undefined;
                if (node.kind === "FunctionTableSource" && parts.length > 0) {
                    const resolution = input.metadata.resolveObject(parts);
                    if (resolution.kind === "resolved") {
                        owner = catalogSymbol(resolution.object);
                        symbols.set(owner.id, owner);
                        unitSymbols.set(owner.id, owner);
                        dependencies.add(resolution.object.ref.id);
                        // The name is an occurrence of the routine, so the cursor finds it there.
                        if (nameNode) {
                            registerReference({
                                start: nameNode.start,
                                end: nameNode.end,
                                symbol: owner.id,
                                write: false,
                            });
                        }
                        const state = input.metadata.columnState(resolution.object.ref);
                        if (state.kind === "loaded") {
                            registerMetadataColumns(owner, resolution.object, state.value);
                        }
                    }
                }
                if (!owner) {
                    const declaration = aliasName ?? nameNode ?? node;
                    owner = {
                        id: `rowset:${declaration.start}:${fold(qualifier)}`,
                        name: qualifier,
                        kind: "rowset",
                        declaration: { start: declaration.start, end: declaration.end },
                    };
                    registerSymbol(owner);
                    const explicit = firstDescendant(node, "ColumnNameList");
                    if (explicit) registerProjectedColumns(owner, explicit);
                    else if (node.kind === "DerivedTable") registerProjectedColumns(owner, node);
                    else if (node.kind === "FunctionTableSource") {
                        registerBuiltInRowsetColumns(owner, node);
                    } else if (node.kind === "VectorSearchTableSource") {
                        registerSyntheticColumn(owner, "distance", "float");
                    }
                }

                if (aliasName && owner.kind !== "rowset") {
                    const aliasSymbol = rowsetAliasSymbol(aliasName, qualifier, owner.object);
                    registerSymbol(aliasSymbol);
                    registerQuerySource(node, qualifier, owner.id, aliasSymbol.id);
                } else {
                    registerQuerySource(node, qualifier, owner.id);
                }
            });

            // Catalog names that are not rowsets: routines that are called, modules that are
            // executed, user types that are mentioned, and the objects DDL acts on. Each is an
            // occurrence of the object, so navigation and hover find it at the cursor.
            visit(batch, (node) => {
                const rule = catalogReferenceRule(node);
                if (!rule) return;
                const nameNode = rule.name(node);
                if (!nameNode) return;
                const parts = multipartIdentifierParts(
                    input.syntax.document.text.slice(nameNode.start, nameNode.end),
                );
                if (parts.length === 0) return;
                // One-part built-ins belong to the language, even if an unusually named catalog
                // object happens to use the same spelling. Qualified names remain catalog names.
                if (
                    parts.length === 1 &&
                    ((node.kind === "FunctionCall" && lookupBuiltIn(parts[0]!, "routine")) ||
                        (node.kind === "DataTypeName" && lookupBuiltIn(parts[0]!, "dataType")))
                ) {
                    return;
                }
                const resolution = input.metadata.resolveObject(parts);
                // Only a resolved name becomes an occurrence. An unresolved one is left alone so
                // damaged or offline input never gains a symbol that was never proven to exist.
                if (resolution.kind !== "resolved") return;
                if (rule.kinds && !rule.kinds.includes(resolution.object.kind)) return;
                const symbol = catalogSymbol(resolution.object);
                symbols.set(symbol.id, symbol);
                unitSymbols.set(symbol.id, symbol);
                dependencies.add(resolution.object.ref.id);
                registerReference({
                    start: nameNode.start,
                    end: nameNode.end,
                    symbol: symbol.id,
                    write: rule.write === true,
                });
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
                } else if (node.kind === "SetClause") {
                    const assigned = directChild(node, "MultipartIdentifier");
                    if (!assigned) return;
                    const parts = multipartIdentifierParts(
                        input.syntax.document.text.slice(assigned.start, assigned.end),
                    );
                    const columnName = parts.at(-1)?.toLocaleLowerCase();
                    const target = columnName && dmlTargetColumn(node, columnName);
                    if (target) {
                        registerReference({
                            start: assigned.start,
                            end: assigned.end,
                            symbol: target,
                            write: true,
                        });
                    }
                } else if (node.kind === "ColumnReference") {
                    if (ancestorNode(node, "DataType")) return;
                    const text = input.syntax.document.text.slice(node.start, node.end);
                    const parts = multipartIdentifierParts(text);
                    const columnName = parts.at(-1)?.toLocaleLowerCase();
                    if (!columnName) return;
                    if (parts.length === 1) {
                        const targetColumn = dmlTargetColumn(node, columnName);
                        if (targetColumn) {
                            registerReference({
                                start: node.start,
                                end: node.end,
                                symbol: targetColumn,
                                write: writesItsTarget(node),
                            });
                            return;
                        }
                        for (const scope of visibleSourceScopes(node)) {
                            const candidates = uniqueSymbolIds(
                                scope.flatMap(({ source }) => {
                                    const candidate = columnsBySource.get(source)?.get(columnName);
                                    return candidate ? [candidate] : [];
                                }),
                            );
                            if (candidates.length === 1) {
                                registerReference({
                                    start: node.start,
                                    end: node.end,
                                    symbol: candidates[0],
                                    write: false,
                                });
                                return;
                            }
                            if (candidates.length > 1) return;
                        }
                        return;
                    }
                    const qualifier = parts.at(-2)!;
                    // OUTPUT exposes the rows a statement changed under two fixed names, both of
                    // which carry the columns of the object being written.
                    if (outputPseudoTables.has(fold(qualifier))) {
                        const target = dmlTargetColumn(node, columnName);
                        if (target) {
                            const columnRange = identifierPartRanges(node, text).at(-1)!;
                            registerReference({
                                start: columnRange.start,
                                end: columnRange.end,
                                symbol: target,
                                write: false,
                            });
                        }
                        return;
                    }
                    const binding = visibleSource(node, qualifier);
                    if (!binding) return;
                    const ranges = identifierPartRanges(node, text);
                    const qualifierRange = ranges.at(-2);
                    if (qualifierRange) {
                        registerReference({
                            start: qualifierRange.start,
                            end: qualifierRange.end,
                            symbol: binding.qualifierSymbol,
                            write: false,
                        });
                    }
                    const columnId = columnsBySource.get(binding.source)?.get(columnName);
                    if (columnId) {
                        const columnRange = ranges.at(-1)!;
                        registerReference({
                            start: columnRange.start,
                            end: columnRange.end,
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
                incomingEnvironmentVersion: reusePlan.incomingVersions[batchIndex]!,
                exportedEnvironmentVersion: reusePlan.exportedVersions[batchIndex]!,
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
            unitsReused,
            diagnosticResult.state,
        );
    }

    public update(previous: SemanticSnapshot, input: BindInput): SemanticSnapshot {
        return this.bindCore(input, previous);
    }
}

interface SemanticReusePlan {
    readonly units: readonly (BoundUnit | undefined)[];
    readonly incomingVersions: readonly string[];
    readonly exportedVersions: readonly string[];
}

function semanticEnvironmentIsPositionStable(
    batches: readonly SyntaxNode[],
    plan: SemanticReusePlan,
    previous: CatalogSemanticSnapshot,
): boolean {
    return (
        batches.length === previous.units.length &&
        batches.every((batch, index) => {
            const prior = previous.units[index];
            return (
                prior !== undefined &&
                batch.start === prior.range.start &&
                batch.end === prior.range.end &&
                plan.incomingVersions[index] === prior.incomingEnvironmentVersion &&
                plan.exportedVersions[index] === prior.exportedEnvironmentVersion
            );
        })
    );
}

function planReusableUnits(
    input: BindInput,
    batches: readonly SyntaxNode[],
    previous?: SemanticSnapshot,
): SemanticReusePlan {
    const versions = semanticEnvironmentVersions(input, batches, previous);
    const units: (BoundUnit | undefined)[] = Array.from({ length: batches.length });
    if (!previous || previous.metadataGeneration !== input.metadata.generation) {
        return { units, ...versions };
    }

    const usedPriorUnits = new Set<BoundUnit>();
    for (const [index, batch] of batches.entries()) {
        const prior = previous.units[index];
        if (
            !prior ||
            !batchIsUnchangedAtSamePosition(input, batch, prior, previous) ||
            prior.incomingEnvironmentVersion !== versions.incomingVersions[index] ||
            prior.exportedEnvironmentVersion !== versions.exportedVersions[index]
        ) {
            continue;
        }
        units[index] = prior;
        usedPriorUnits.add(prior);
    }

    const candidates = new Map<string, BoundUnit[]>();
    for (const prior of previous.units) {
        if (usedPriorUnits.has(prior)) continue;
        const key = reusableUnitKey(
            prior.range.end - prior.range.start,
            fingerprintHash(prior.syntaxFingerprint),
            prior.incomingEnvironmentVersion,
            prior.exportedEnvironmentVersion,
        );
        const queue = candidates.get(key) ?? [];
        queue.push(prior);
        candidates.set(key, queue);
    }
    for (const [index, batch] of batches.entries()) {
        if (units[index]) continue;
        const contentHash = hashText(input.syntax.document.text.slice(batch.start, batch.end));
        const key = reusableUnitKey(
            batch.end - batch.start,
            contentHash,
            versions.incomingVersions[index]!,
            versions.exportedVersions[index]!,
        );
        const prior = candidates.get(key)?.shift();
        if (!prior) continue;
        units[index] = shiftBoundUnit(
            prior,
            batch,
            contentHash,
            versions.incomingVersions[index]!,
            versions.exportedVersions[index]!,
        );
    }
    return { units, ...versions };
}

function reusableUnitKey(
    length: number,
    contentHash: string,
    incomingEnvironmentVersion: string,
    exportedEnvironmentVersion: string,
): string {
    return `${length}:${contentHash}:${incomingEnvironmentVersion}:${exportedEnvironmentVersion}`;
}

function semanticEnvironmentVersions(
    input: BindInput,
    batches: readonly SyntaxNode[],
    previous?: SemanticSnapshot,
): {
    readonly incomingVersions: readonly string[];
    readonly exportedVersions: readonly string[];
} {
    const incomingVersions: string[] = [];
    const exportedVersions: string[] = [];
    // The profile changes which diagnostics a statement produces, so it is part of the reuse key.
    let environment = `semantic:${input.metadata.generation}:${analysisProfileKey(
        resolveAnalysisProfile(input.profile),
    )}`;
    for (const [index, batch] of batches.entries()) {
        incomingVersions.push(environment);
        const prior = previous?.units[index];
        if (
            previous?.metadataGeneration === input.metadata.generation &&
            prior &&
            prior.incomingEnvironmentVersion === environment &&
            batchIsUnchangedAtSamePosition(input, batch, prior, previous)
        ) {
            environment = prior.exportedEnvironmentVersion;
            exportedVersions.push(environment);
            continue;
        }
        const exported = semanticExportFingerprint(input.syntax, batch);
        if (exported)
            environment = `semantic:${input.metadata.generation}:${hashText(`${environment}\0${exported}`)}`;
        exportedVersions.push(environment);
    }
    return { incomingVersions, exportedVersions };
}

function batchIsUnchangedAtSamePosition(
    input: BindInput,
    batch: SyntaxNode,
    prior: BoundUnit,
    previous: SemanticSnapshot,
): boolean {
    if (batch.start !== prior.range.start || batch.end !== prior.range.end) return false;
    if (input.syntax.document.version === previous.documentVersion) return true;
    if (!input.changedRanges) return false;
    return input.changedRanges.every((range) => !rangesIntersect(range, batch));
}

function rangesIntersect(left: TextRange, right: TextRange): boolean {
    if (left.start === left.end) return right.start <= left.start && left.start <= right.end;
    return left.start < right.end && right.start < left.end;
}

function semanticExportFingerprint(syntax: BindInput["syntax"], batch: SyntaxNode): string {
    const exports: string[] = [];
    visit(batch, (node) => {
        if (
            node.kind === "UseStatement" ||
            node.kind === "IntoClause" ||
            /^(?:Create|Alter|Drop).+Statement$/u.test(node.kind)
        ) {
            exports.push(
                `${node.kind}:${node.start - batch.start}:${hashText(
                    syntax.document.text.slice(node.start, node.end),
                )}`,
            );
        }
    });
    return exports.length === 0 ? "" : hashText(exports.join("\0"));
}

function fingerprintHash(fingerprint: string): string {
    return fingerprint.slice(fingerprint.lastIndexOf(":") + 1);
}

function shiftBoundUnit(
    unit: BoundUnit,
    batch: SyntaxNode,
    contentHash: string,
    incomingEnvironmentVersion: string,
    exportedEnvironmentVersion: string,
): BoundUnit {
    const delta = batch.start - unit.range.start;
    if (
        delta === 0 &&
        unit.incomingEnvironmentVersion === incomingEnvironmentVersion &&
        unit.exportedEnvironmentVersion === exportedEnvironmentVersion
    ) {
        return unit;
    }
    const shiftId = (id: SymbolId): SymbolId => shiftSymbolId(id, unit.range.start, delta);
    const symbols = unit.symbols.map((symbol) =>
        Object.freeze({
            ...symbol,
            id: shiftId(symbol.id),
            ...(symbol.declaration ? { declaration: shiftRange(symbol.declaration, delta) } : {}),
        }),
    );
    const references = unit.references.map((reference) =>
        Object.freeze({
            ...reference,
            start: reference.start + delta,
            end: reference.end + delta,
            ...(reference.symbol ? { symbol: shiftId(reference.symbol) } : {}),
        }),
    );
    const diagnostics = unit.diagnostics.map((diagnostic) =>
        Object.freeze({
            ...diagnostic,
            range: shiftRange(diagnostic.range, delta),
        }),
    );
    return Object.freeze({
        ...unit,
        range: Object.freeze({ start: batch.start, end: batch.end }),
        syntaxFingerprint: `${batch.start}:${batch.end}:${contentHash}`,
        incomingEnvironmentVersion,
        exportedEnvironmentVersion,
        symbols: Object.freeze(symbols),
        references: Object.freeze(references),
        diagnostics: Object.freeze(diagnostics),
    });
}

function shiftSymbolId(id: SymbolId, oldBatchStart: number, delta: number): SymbolId {
    const batchScoped = /^(variable|cte|local-table):(\d+):/u.exec(id);
    if (batchScoped && Number(batchScoped[2]) === oldBatchStart) {
        return `${batchScoped[1]}:${oldBatchStart + delta}:${id.slice(batchScoped[0].length)}`;
    }
    const positionScoped = /^(alias|rowset):(\d+):/u.exec(id);
    if (positionScoped) {
        return `${positionScoped[1]}:${Number(positionScoped[2]) + delta}:${id.slice(positionScoped[0].length)}`;
    }
    return id;
}

function shiftRange(range: TextRange, delta: number): TextRange {
    return Object.freeze({ start: range.start + delta, end: range.end + delta });
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
        unitsReused = 0,
        public readonly diagnosticState?: TsqlSemanticDiagnosticState,
    ) {
        this.statistics = Object.freeze({
            unitsExamined: units.length,
            unitsReused,
            unitsRebound: units.length - unitsReused,
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

interface QuerySourceBinding {
    readonly source: SymbolId;
    readonly qualifierSymbol: SymbolId;
}

function rowsetAliasSymbol(
    aliasName: SyntaxNode,
    name: string,
    object?: ObjectRef,
): SemanticSymbol {
    return {
        id: `alias:${aliasName.start}:${normalizeIdentifier(name).toLocaleLowerCase()}`,
        name,
        kind: "alias",
        declaration: { start: aliasName.start, end: aliasName.end },
        ...(object ? { object } : {}),
    };
}

interface CatalogReferenceRule {
    /** The name node the statement or expression refers to. */
    readonly name: (node: SyntaxNode) => SyntaxNode | undefined;
    /** Object kinds the position accepts; other kinds are left unbound. */
    readonly kinds?: readonly string[];
    /** True where the statement changes the object rather than reading it. */
    readonly write?: boolean;
}

const routineKinds = ["scalarFunction", "tableFunction"] as const;

/** A rowset name reaches its parts through a wrapper the grammar shares across statements. */
function rowsetName(node: SyntaxNode, wrapper = "TableSourceName"): SyntaxNode | undefined {
    const held = directChild(node, wrapper);
    return held ? directChild(held, "MultipartIdentifier") : undefined;
}
const rowsetKinds = ["table", "view", "synonym", "tableFunction"] as const;

/**
 * Where a catalog name appears outside a rowset position, and what kind of object may stand there.
 * The name is taken from the construct that owns it rather than from a descendant search, so an
 * argument or a nested statement is never mistaken for the name of the outer one.
 */
function catalogReferenceRule(node: SyntaxNode): CatalogReferenceRule | undefined {
    switch (node.kind) {
        case "ExecutableEntity":
            return {
                name: (owner) => directChild(owner, "MultipartIdentifier"),
                kinds: ["procedure"],
            };
        case "FunctionCall":
            return {
                name: (owner) => directChild(owner, "MultipartIdentifier"),
                kinds: routineKinds,
            };
        case "DataTypeName":
            return { name: (owner) => directChild(owner, "MultipartIdentifier"), kinds: ["type"] };
        case "TriggerTarget":
            return {
                name: (owner) => directChild(owner, "MultipartIdentifier"),
                kinds: rowsetKinds,
            };
        case "AlterTableStatement":
            return {
                name: (owner) => directChild(owner, "MultipartIdentifier"),
                kinds: ["table"],
                write: true,
            };
        case "TruncateTableStatement":
            return { name: (owner) => rowsetName(owner), kinds: ["table"], write: true };
        case "PermissionTarget":
            // A securable with no class qualifier is an object, which is what a bare name means.
            return {
                name: (owner) =>
                    directChild(owner, "SecurableClass")
                        ? undefined
                        : rowsetName(owner, "SecurableName"),
            };
        case "DropTableStatement":
        case "DropViewStatement":
        case "DropProcedureStatement":
        case "DropFunctionStatement":
        case "DropTypeStatement":
        case "DropSynonymStatement":
            return { name: (owner) => directChild(owner, "MultipartIdentifier"), write: true };
        case "CreateIndexStatement":
        case "CreateJsonIndexStatement":
        case "CreateVectorIndexStatement":
        case "CreateSemanticIndexStatement":
        case "AlterIndexStatement":
        case "CreateStatisticsStatement":
            // The index is named first and the table it belongs to second.
            return {
                name: (owner) => directChild(owner, "MultipartIdentifier"),
                kinds: rowsetKinds,
                write: true,
            };
        default:
            return undefined;
    }
}

/** The two rowsets an OUTPUT clause exposes, which mirror the columns of the written object. */
const outputPseudoTables = new Set(["inserted", "deleted"]);

const dmlStatementKinds = new Set([
    "InsertStatement",
    "UpdateStatement",
    "DeleteStatement",
    "MergeStatement",
]);

/** The data-modification statement a node belongs to, if any. */
function dmlStatement(node: SyntaxNode): SyntaxNode | undefined {
    for (let current = node.parent(); current; current = current.parent()) {
        if (dmlStatementKinds.has(current.kind)) return current;
    }
    return undefined;
}

/** A column named in the target list of an INSERT is written; one read in OUTPUT or WHERE is not. */
function writesItsTarget(node: SyntaxNode): boolean {
    for (let current = node.parent(); current; current = current.parent()) {
        if (current.kind === "DmlTarget") return true;
        if (dmlStatementKinds.has(current.kind)) return false;
    }
    return false;
}

/**
 * ORDER BY, OPTION, and FOR follow the query they apply to rather than sitting inside it, so the
 * sources of the statement's own query specification remain in scope for them.
 */
function trailingClauseQuery(node: SyntaxNode): SyntaxNode | undefined {
    const statement = ancestorNode(node, "SelectStatement");
    return statement ? firstDescendant(statement, "QuerySpecification") : undefined;
}

function ancestorNode(node: SyntaxNode, kind: string): SyntaxNode | undefined {
    for (let current = node.parent(); current; current = current.parent()) {
        if (current.kind === kind) return current;
    }
    return undefined;
}

function correlatableOuterQuery(query: SyntaxNode): SyntaxNode | undefined {
    for (let current = query.parent(); current; current = current.parent()) {
        if (current.kind === "CommonTableExpression" || current.kind === "DerivedTable") {
            return undefined;
        }
        if (current.kind === "QuerySpecification") return current;
    }
    return undefined;
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

function identifierPartRanges(node: SyntaxNode, text: string): readonly TextRange[] {
    const result: TextRange[] = [];
    const matcher = /\[(?:[^\]]|\]\])*\]|"(?:[^"]|"")*"|[^.\s]+/gu;
    for (const match of text.matchAll(matcher)) {
        if (match.index === undefined) continue;
        result.push({
            start: node.start + match.index,
            end: node.start + match.index + match[0].length,
        });
    }
    return result;
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

function uniqueSymbolIds(symbols: readonly SymbolId[]): readonly SymbolId[] {
    return [...new Set(symbols)];
}
