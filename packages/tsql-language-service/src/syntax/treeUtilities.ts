/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { SyntaxNode } from "./contracts.js";

export function visitSyntaxTree(node: SyntaxNode, callback: (node: SyntaxNode) => void): void {
    callback(node);
    for (const child of node.children()) visitSyntaxTree(child, callback);
}

export function ancestorOfKind(
    node: SyntaxNode | undefined,
    kinds: readonly string[],
): SyntaxNode | undefined {
    for (let current = node; current; current = current.parent()) {
        if (kinds.includes(current.kind)) return current;
    }
    return undefined;
}

/** Searches descendants only; the supplied node is deliberately excluded. */
export function firstDescendantOfKind(node: SyntaxNode, kind: string): SyntaxNode | undefined {
    for (const child of node.children()) {
        if (child.kind === kind) return child;
        const nested = firstDescendantOfKind(child, kind);
        if (nested) return nested;
    }
    return undefined;
}

export function lastDescendantOfKind(node: SyntaxNode, kind: string): SyntaxNode | undefined {
    let result: SyntaxNode | undefined;
    for (const child of node.children()) {
        visitSyntaxTree(child, (candidate) => {
            if (candidate.kind === kind) result = candidate;
        });
    }
    return result;
}

export function descendantsOfKind(node: SyntaxNode, kind: string): SyntaxNode[] {
    const result: SyntaxNode[] = [];
    for (const child of node.children()) {
        visitSyntaxTree(child, (candidate) => {
            if (candidate.kind === kind) result.push(candidate);
        });
    }
    return result;
}

export function directChildOfKind(node: SyntaxNode, kind: string): SyntaxNode | undefined {
    return [...node.children()].find((child) => child.kind === kind);
}

export function hasDescendantOfKind(node: SyntaxNode, kind: string): boolean {
    return firstDescendantOfKind(node, kind) !== undefined;
}
