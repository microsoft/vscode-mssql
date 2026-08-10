/*
 * Derived from SaralSQL commit e95951c1ba48c41c026a1244ac23cedc2ced7fb7.
 * Copyright (c) Saral Simon Stalin. Licensed under the MIT License.
 * See packages/tsql-language-service/third-party/saralsql/LICENSE and NOTICE.md.
 */

import { type NodeLocation } from "../ast/types.js";

export enum SymbolKind {
    Variable = "Variable",
    Parameter = "Parameter",
    Table = "Table",
    Column = "Column",
    Alias = "Alias",
    CTE = "CTE",
    Procedure = "Procedure",
    Function = "Function",
    TempTable = "TempTable",
    Type = "Type",
}

export type ReferenceKind = "read" | "write";

// A single usage site for a declared symbol
export interface SymbolReference {
    location: NodeLocation;
    kind: ReferenceKind;
}

export interface SymbolColumn {
    rawName: string;
    normalizedName: string;
    dataType?: string;
    typeMembers?: TypeMember[];
    location?: NodeLocation;
}

export interface TypeMember {
    name: string;
    kind: "property" | "method";
    returnType: string;
}

export interface Symbol {
    name: string;
    kind: SymbolKind;
    dataType?: string;
    columns?: string[];
    localColumns?: SymbolColumn[];
    location: NodeLocation;
    /** Every place in the AST where this symbol is referenced after declaration. */
    references: SymbolReference[];
    metadata?: Record<string, unknown>;
}

export class Scope {
    private readonly symbols = new Map<string, Symbol>();
    private readonly children: Scope[] = [];
    public hasUnverifiableSources: boolean = false;

    getChildren(): readonly Scope[] {
        return this.children;
    }

    constructor(
        public readonly start: number,
        public readonly end: number,
        public readonly parent: Scope | null = null,
        public readonly name?: string,
    ) {
        if (parent) {
            parent.children.push(this);
        }
    }

    define(symbol: Symbol): Symbol | undefined {
        const key = symbol.name.toLowerCase();
        const existing = this.symbols.get(key);

        if (!existing) {
            this.symbols.set(key, symbol);
        }

        return existing;
    }

    resolveLocal(name: string): Symbol | undefined {
        return this.symbols.get(name.toLowerCase());
    }

    resolve(name: string): Symbol | undefined {
        const key = name.toLowerCase();
        let scope: Scope | null = this;
        while (scope) {
            const found = scope.symbols.get(key);
            if (found) return found;
            scope = scope.parent;
        }
        return undefined;
    }

    /** Returns only the symbols declared directly in this scope. */
    getOwnSymbols(): Symbol[] {
        return [...this.symbols.values()];
    }

    contains(offset: number): boolean {
        return offset >= this.start && offset <= this.end;
    }

    findInnermost(offset: number): Scope {
        for (const child of this.children) {
            if (child.contains(offset)) {
                return child.findInnermost(offset);
            }
        }
        return this;
    }

    getVisibleSymbols(): Symbol[] {
        const merged = new Map<string, Symbol>();
        let scope: Scope | null = this;
        while (scope) {
            for (const [k, v] of scope.symbols) {
                if (!merged.has(k)) merged.set(k, v);
            }
            scope = scope.parent;
        }
        return [...merged.values()];
    }

    toJSON() {
        return {
            start: this.start,
            end: this.end,
            name: this.name,
            hasUnverifiableSources: this.hasUnverifiableSources,
            symbols: Object.fromEntries(this.symbols),
            children: this.children,
        };
    }
}
