/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { TextRange } from "../text/index.js";
import type { SyntaxKind, SyntaxNode, SyntaxSnapshot } from "./contracts.js";

/** Extracts source text using the syntax snapshot that owns the supplied range. */
export function syntaxSource(snapshot: SyntaxSnapshot, range: TextRange): string {
    if (range.start < 0 || range.end < range.start || range.end > snapshot.document.length) {
        throw new RangeError(`Syntax range ${range.start}:${range.end} is outside the document.`);
    }
    return snapshot.document.text.slice(range.start, range.end);
}

export function visitSyntaxTree(node: SyntaxNode, callback: (node: SyntaxNode) => void): void {
    callback(node);
    for (const child of node.children()) visitSyntaxTree(child, callback);
}

export function ancestorOfKind(
    node: SyntaxNode | undefined,
    kinds: readonly SyntaxKind[],
): SyntaxNode | undefined {
    for (let current = node; current; current = current.parent()) {
        if (kinds.includes(current.kind)) return current;
    }
    return undefined;
}

/** Finds the nearest matching parent; unlike `ancestorOfKind`, the supplied node is excluded. */
export function parentOfKind(node: SyntaxNode, kind: SyntaxKind): SyntaxNode | undefined {
    return ancestorOfKind(node.parent(), [kind]);
}

/** Searches descendants only; the supplied node is deliberately excluded. */
export function firstDescendantOfKind(node: SyntaxNode, kind: SyntaxKind): SyntaxNode | undefined {
    for (const child of node.children()) {
        if (child.kind === kind) return child;
        const nested = firstDescendantOfKind(child, kind);
        if (nested) return nested;
    }
    return undefined;
}

export function lastDescendantOfKind(node: SyntaxNode, kind: SyntaxKind): SyntaxNode | undefined {
    let result: SyntaxNode | undefined;
    for (const child of node.children()) {
        visitSyntaxTree(child, (candidate) => {
            if (candidate.kind === kind) result = candidate;
        });
    }
    return result;
}

export function descendantsOfKind(node: SyntaxNode, kind: SyntaxKind): SyntaxNode[] {
    const result: SyntaxNode[] = [];
    for (const child of node.children()) {
        visitSyntaxTree(child, (candidate) => {
            if (candidate.kind === kind) result.push(candidate);
        });
    }
    return result;
}

export function directChildOfKind(node: SyntaxNode, kind: SyntaxKind): SyntaxNode | undefined {
    return [...node.children()].find((child) => child.kind === kind);
}

export function directChildrenOfKind(node: SyntaxNode, kind: SyntaxKind): SyntaxNode[] {
    return [...node.children()].filter((child) => child.kind === kind);
}

/**
 * Descendants of `kind` whose nearest ancestor of the same kind is `owner`.
 *
 * This is used for nested query/module constructs where a plain recursive walk would accidentally
 * attribute a nested construct to its outer owner.
 */
export function descendantsOwnedByKind(
    node: SyntaxNode,
    kind: SyntaxKind,
    owner: SyntaxNode,
): SyntaxNode[] {
    return descendantsOfKind(node, kind).filter((candidate) =>
        sameSyntaxNode(parentOfKind(candidate, owner.kind), owner),
    );
}

export function directOwnedDescendantsOfKind(node: SyntaxNode, kind: SyntaxKind): SyntaxNode[] {
    return descendantsOwnedByKind(node, kind, node);
}

export function sameSyntaxNode(
    left: SyntaxNode | undefined,
    right: SyntaxNode | undefined,
): boolean {
    return Boolean(
        left &&
            right &&
            left.kind === right.kind &&
            left.start === right.start &&
            left.end === right.end,
    );
}

export function hasDescendantOfKind(node: SyntaxNode, kind: SyntaxKind): boolean {
    return firstDescendantOfKind(node, kind) !== undefined;
}

/** True when this subtree contains a parser recovery node. */
export function containsSyntaxError(node: SyntaxNode): boolean {
    if (node.error) return true;
    for (const child of node.children()) {
        if (containsSyntaxError(child)) return true;
    }
    return false;
}
