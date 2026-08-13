/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { TreeFragment, type SyntaxNode as LezerNode, type Tree } from "@lezer/common";
import type { LRParser } from "@lezer/lr";
import type { TextChange, TextRange, TextSnapshot } from "../../text/index.js";
import type {
    SyntaxContext,
    SyntaxDiagnostic,
    SyntaxNode,
    SyntaxService,
    SyntaxSnapshot,
    SyntaxToken,
} from "../contracts.js";
import { parser as generatedParser } from "./generated/tsqlParser.js";

export class LezerSyntaxService implements SyntaxService {
    public constructor(private readonly _parser: LRParser = generatedParser as LRParser) {}

    public parse(document: TextSnapshot): SyntaxSnapshot {
        const tree = this._parser.parse(document.text);
        return new LezerSyntaxSnapshot(document, tree, TreeFragment.addTree(tree), [], "full", 0);
    }

    public update(
        previous: SyntaxSnapshot,
        document: TextSnapshot,
        changes: readonly TextChange[],
    ): SyntaxSnapshot {
        if (!(previous instanceof LezerSyntaxSnapshot)) {
            throw new TypeError("LezerSyntaxService can update only snapshots that it created");
        }

        // LSP edits are sequential. Until the coordinator composes arbitrary edit sequences,
        // reuse fragments for the common one-edit path and safely fall back for multi-edit input.
        if (changes.length !== 1) return this.parse(document);
        const change = changes[0]!;
        const changed = {
            fromA: change.start,
            toA: change.end,
            fromB: change.start,
            toB: change.start + change.text.length,
        };
        const reusable = TreeFragment.applyChanges(previous.fragments, [changed]);
        const tree = this._parser.parse(document.text, reusable);
        return new LezerSyntaxSnapshot(
            document,
            tree,
            TreeFragment.addTree(tree, reusable),
            [{ start: change.start, end: change.start + change.text.length }],
            "incremental",
            reusable.length,
        );
    }
}

class LezerSyntaxSnapshot implements SyntaxSnapshot {
    public readonly diagnostics: readonly SyntaxDiagnostic[];
    public readonly statistics;

    public constructor(
        public readonly document: TextSnapshot,
        public readonly tree: Tree,
        public readonly fragments: readonly TreeFragment[],
        public readonly changedRanges: readonly TextRange[],
        mode: "full" | "incremental",
        reusableFragmentCount: number,
    ) {
        this.diagnostics = collectDiagnostics(tree);
        this.statistics = Object.freeze({
            mode,
            changedRangeCount: changedRanges.length,
            reusableFragmentCount,
        });
    }

    public root(): SyntaxNode {
        return new LezerSyntaxNode(this.tree.topNode);
    }

    public nodeAt(offset: number): SyntaxNode {
        const safeOffset = Math.max(0, Math.min(offset, this.document.length));
        return new LezerSyntaxNode(this.tree.resolveInner(safeOffset, -1));
    }

    public contextAt(offset: number): SyntaxContext {
        const node = this.nodeAt(offset);
        const ancestors: string[] = [];
        let parent = node.parent();
        while (parent) {
            ancestors.push(parent.kind);
            parent = parent.parent();
        }
        return { offset, node, ancestors };
    }

    public *tokens(
        range: TextRange = { start: 0, end: this.document.length },
    ): Iterable<SyntaxToken> {
        for (const node of leafNodes(this.tree.topNode)) {
            if (node.from < range.start || node.to > range.end || node.type.isAnonymous) continue;
            const text = this.document.text.slice(node.from, node.to);
            const previous = node.from === 0 ? "\n" : this.document.text[node.from - 1];
            yield {
                kind: node.name,
                start: node.from,
                end: node.to,
                text,
                trivia: node.name === "Whitespace" || node.name.endsWith("Comment"),
                lineStart: previous === "\n" || previous === "\r",
            };
        }
    }
}

class LezerSyntaxNode implements SyntaxNode {
    public constructor(private readonly _node: LezerNode) {}

    public get kind(): string {
        return this._node.name;
    }

    public get start(): number {
        return this._node.from;
    }

    public get end(): number {
        return this._node.to;
    }

    public get error(): boolean {
        return this._node.type.isError;
    }

    public parent(): SyntaxNode | undefined {
        return this._node.parent ? new LezerSyntaxNode(this._node.parent) : undefined;
    }

    public *children(): Iterable<SyntaxNode> {
        let child = this._node.firstChild;
        while (child) {
            yield new LezerSyntaxNode(child);
            child = child.nextSibling;
        }
    }
}

function* leafNodes(node: LezerNode): Iterable<LezerNode> {
    let child = node.firstChild;
    if (!child) {
        yield node;
        return;
    }
    while (child) {
        yield* leafNodes(child);
        child = child.nextSibling;
    }
}

function collectDiagnostics(tree: Tree): readonly SyntaxDiagnostic[] {
    const diagnostics: SyntaxDiagnostic[] = [];
    tree.iterate({
        enter(node) {
            if (!node.type.isError) return;
            diagnostics.push({
                code: "syntax-error",
                message: "Incomplete or unrecognized T-SQL syntax.",
                severity: "error",
                range: { start: node.from, end: node.to },
            });
        },
    });
    return diagnostics;
}
