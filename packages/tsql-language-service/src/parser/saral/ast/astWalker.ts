/*
 * Derived from SaralSQL commit e95951c1ba48c41c026a1244ac23cedc2ced7fb7.
 * Copyright (c) Saral Simon Stalin. Licensed under the MIT License.
 * See packages/tsql-language-service/third-party/saralsql/LICENSE and NOTICE.md.
 */

import { type ASTNode, type Program } from "./types.js";

// ---------------------------------------------
// Type guard (safe detection of AST nodes)
// ---------------------------------------------
function isNode(value: unknown): value is ASTNode {
    return (
        !!value &&
        typeof value === "object" &&
        "type" in value &&
        "start" in value &&
        "end" in value
    );
}

// ---------------------------------------------
// Generic child extractor (reflection-based)
// ---------------------------------------------
export function getChildren(node: ASTNode): ASTNode[] {
    const children: ASTNode[] = [];

    for (const key of Object.keys(node)) {
        const value = (node as any)[key];

        if (!value) continue;

        // Array of nodes
        if (Array.isArray(value)) {
            for (const v of value) {
                if (isNode(v)) {
                    children.push(v);
                }
            }
        }
        // Single node
        else if (isNode(value)) {
            children.push(value);
        }
    }

    return children;
}

// ---------------------------------------------
// AST Visitor
// ---------------------------------------------
export type ASTVisitor = {
    enter?: (node: ASTNode, parent: ASTNode | null) => void;
    exit?: (node: ASTNode, parent: ASTNode | null) => void;
};

// ---------------------------------------------
// Walk entire AST
// ---------------------------------------------
export function walkAST(program: Program, visitor: ASTVisitor) {
    function walk(node: ASTNode, parent: ASTNode | null) {
        visitor.enter?.(node, parent);

        for (const child of getChildren(node)) {
            walk(child, node);
        }

        visitor.exit?.(node, parent);
    }

    for (const stmt of program.body) {
        walk(stmt, null);
    }
}

// ---------------------------------------------
// Find deepest node at offset
// ---------------------------------------------
export function findNodeAt(program: Program, offset: number): ASTNode | null {
    function walk(node: ASTNode): ASTNode | null {
        if (offset < node.start || offset > node.end) {
            return null;
        }

        for (const child of getChildren(node)) {
            const found = walk(child);
            if (found) return found;
        }

        return node;
    }

    for (const stmt of program.body) {
        const found = walk(stmt);
        if (found) return found;
    }

    return null;
}

// ---------------------------------------------
// Collect nodes by predicate
// ---------------------------------------------
export function collectNodes<T extends ASTNode>(
    program: Program,
    predicate: (node: ASTNode) => node is T,
): T[] {
    const result: T[] = [];

    walkAST(program, {
        enter(node) {
            if (predicate(node)) {
                result.push(node);
            }
        },
    });

    return result;
}

// ---------------------------------------------
// Find parent of a node
// ---------------------------------------------
export function findParent(program: Program, target: ASTNode): ASTNode | null {
    let parent: ASTNode | null = null;

    walkAST(program, {
        enter(node, p) {
            if (node === target) {
                parent = p;
            }
        },
    });

    return parent;
}

// ---------------------------------------------
// Utility: first node matching predicate
// ---------------------------------------------
export function findFirst<T extends ASTNode>(
    program: Program,
    predicate: (node: ASTNode) => node is T,
): T | null {
    let found: T | null = null;

    walkAST(program, {
        enter(node) {
            if (!found && predicate(node)) {
                found = node;
            }
        },
    });

    return found;
}
