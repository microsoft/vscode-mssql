/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Tree, TreeFragment, parseMixed, type SyntaxNode as LezerNode } from "@lezer/common";
import type { LRParser } from "@lezer/lr";
import type { TextChange, TextRange, TextSnapshot } from "../../text/index.js";
import type {
    SyntaxContext,
    SyntaxDiagnostic,
    SyntaxNode,
    SyntaxService,
    SyntaxSnapshot,
    SyntaxToken,
    TsqlFeatureProfile,
} from "../contracts.js";
import { capabilityGeneration, defaultTsqlFeatureProfile } from "../contracts.js";
import {
    featureAvailabilityDetail,
    featureAvailabilityDiagnosticCode,
    featureAvailabilityMessage,
    platformFeatureForNode,
} from "../../common/platformFeatureRegistry.js";
import { keywordMetadata } from "../keywords.generated.js";
import { partitionSqlBatches } from "./batchChunking.js";
import { parser as generatedParser } from "./generated/tsqlParser.js";
import {
    ancestorNamed,
    availabilityRange,
    diagnosticNearRange,
    expectedSuffix,
    findWord,
    isAtLineStart,
    missingMergeTerminator,
    requiresIntegerLiteral,
    unterminatedBlockCommentRange,
    unterminatedStringRange,
} from "./syntaxDiagnosticUtilities.js";

interface ParsedChunk extends TextRange {
    readonly tree: Tree;
    readonly fragments: readonly TreeFragment[];
    readonly diagnostics: readonly SyntaxDiagnostic[];
    readonly rawErrorNodeCount: number;
    readonly batchCount: number;
    readonly mixed: boolean;
}

interface ChunkCandidate {
    readonly chunk: ParsedChunk;
    start: number;
    end: number;
    dirty: boolean;
    compatible: boolean;
    readonly localChanges: TextChange[];
}

export class LezerSyntaxService implements SyntaxService {
    private readonly _plainParser: LRParser;
    private readonly _mixedParser: LRParser;
    private readonly _expressionParser: LRParser;
    private readonly _groupedQueryParser: LRParser;

    private _profile: TsqlFeatureProfile;

    public constructor(
        parser: LRParser = generatedParser as LRParser,
        profile: TsqlFeatureProfile = defaultTsqlFeatureProfile,
    ) {
        this._profile = profile;
        this._plainParser = parser;
        this._expressionParser = parser.configure({ top: "ExpressionRoot" });
        this._groupedQueryParser = parser.configure({ top: "GroupedQueryRoot" });
        this._mixedParser = parser.configure({
            wrap: parseMixed((node) => {
                if (node.name === "ProceduralCondition") {
                    return { parser: this._expressionParser };
                }
                if (node.name === "GroupedQueryChunk" && node.from < node.to) {
                    return { parser: this._groupedQueryParser };
                }
                if (
                    (node.name === "BlockChunk" || node.name === "StatementChunk") &&
                    isBoundedMixedRegion(node.node)
                ) {
                    return { parser: this._mixedParser };
                }
                return null;
            }),
        });
    }

    /** The engine profile every snapshot this service produces is stamped with. */
    public get profile(): TsqlFeatureProfile {
        return this._profile;
    }

    /**
     * Adopts a newly resolved engine profile.
     *
     * Existing snapshots keep the profile they were produced under; a caller republishes them
     * through {@link reprofile}, which reuses their trees rather than reparsing.
     */
    public setProfile(profile: TsqlFeatureProfile): void {
        this._profile = profile;
    }

    /**
     * Republishes a snapshot under the service's current profile.
     *
     * Only the availability layer depends on the profile, so the retained per-chunk trees are
     * reused and no text is presented to the parser again. A snapshot already produced under the
     * current profile is returned unchanged.
     */
    public reprofile(previous: SyntaxSnapshot): SyntaxSnapshot {
        if (!(previous instanceof LezerSyntaxSnapshot)) {
            throw new TypeError("LezerSyntaxService can reprofile only snapshots that it created");
        }
        if (previous.profileGeneration === capabilityGeneration(this._profile)) return previous;
        const documentText = previous.document.text;
        const chunks = previous.chunks.map((chunk) => {
            const text = documentText.slice(chunk.start, chunk.end);
            const facts = collectSyntaxFacts(chunk.tree, text, this._profile);
            return Object.freeze({
                ...chunk,
                diagnostics: Object.freeze(facts.diagnostics),
                rawErrorNodeCount: facts.rawErrorNodeCount,
            });
        });
        return new LezerSyntaxSnapshot(
            previous.document,
            chunks,
            [],
            "incremental",
            {
                reusableFragmentCount: 0,
                reusedChunkCount: chunks.length,
                reparsedChunkCount: 0,
                parsedCharacterCount: 0,
            },
            this._profile,
            () => this.parseCompleteDocument(documentText),
        );
    }

    public parse(document: TextSnapshot): SyntaxSnapshot {
        const chunks = partitionSqlBatches(document.text).map((range) =>
            this.parseChunk(document.text, range),
        );
        return new LezerSyntaxSnapshot(
            document,
            chunks,
            [],
            "full",
            {
                reusableFragmentCount: 0,
                reusedChunkCount: 0,
                reparsedChunkCount: chunks.length,
                parsedCharacterCount: document.length,
            },
            this._profile,
            () => this.parseCompleteDocument(document.text),
        );
    }

    public update(
        previous: SyntaxSnapshot,
        document: TextSnapshot,
        changes: readonly TextChange[],
    ): SyntaxSnapshot {
        if (!(previous instanceof LezerSyntaxSnapshot)) {
            throw new TypeError("LezerSyntaxService can update only snapshots that it created");
        }

        if (changes.length === 0) {
            return new LezerSyntaxSnapshot(
                document,
                previous.chunks,
                [],
                "incremental",
                {
                    reusableFragmentCount: 0,
                    reusedChunkCount: previous.chunks.length,
                    reparsedChunkCount: 0,
                    parsedCharacterCount: 0,
                },
                this._profile,
                () => this.parseCompleteDocument(document.text),
            );
        }

        const candidates = transformChunkCandidates(previous.chunks, changes);
        const preferredBoundaries = new Set<number>();
        for (const candidate of candidates) {
            if (candidate.end <= candidate.start) continue;
            preferredBoundaries.add(candidate.start);
            preferredBoundaries.add(candidate.end);
        }
        // A fixed-width identifier edit cannot add/remove GO, quotes, or comments, so the safe
        // chunk topology is unchanged. Avoid rescanning a multi-megabyte document in this common
        // typing path; structural edits still take the conservative full boundary scan below.
        const ranges = preservesChunkPartition(previous.document.text, changes)
            ? candidates
                  .filter((candidate) => candidate.end > candidate.start)
                  .map(({ start, end }) => ({ start, end }))
            : partitionSqlBatches(document.text, preferredBoundaries);
        const candidatesByRange = new Map(
            candidates.map((candidate) => [`${candidate.start}:${candidate.end}`, candidate]),
        );
        const chunks: ParsedChunk[] = [];
        let reusableFragmentCount = 0;
        let reusedChunkCount = 0;
        let reparsedChunkCount = 0;
        let parsedCharacterCount = 0;
        for (const range of ranges) {
            const candidate = candidatesByRange.get(`${range.start}:${range.end}`);
            if (candidate?.compatible && !candidate.dirty) {
                chunks.push({ ...candidate.chunk, start: range.start, end: range.end });
                reusedChunkCount++;
                continue;
            }
            if (candidate?.compatible && candidate.localChanges.length > 0) {
                let reusable = candidate.chunk.fragments;
                for (const change of candidate.localChanges) {
                    reusable = TreeFragment.applyChanges(reusable, [toChangedRange(change)]);
                }
                chunks.push(this.parseChunk(document.text, range, reusable));
                reusableFragmentCount += reusable.length;
            } else {
                chunks.push(this.parseChunk(document.text, range));
            }
            reparsedChunkCount++;
            parsedCharacterCount += range.end - range.start;
        }

        let changedRanges: readonly TextRange[] = [];
        for (const change of changes) {
            changedRanges = mapChangedRanges(changedRanges, change);
        }
        return new LezerSyntaxSnapshot(
            document,
            chunks,
            changedRanges,
            "incremental",
            {
                reusableFragmentCount,
                reusedChunkCount,
                reparsedChunkCount,
                parsedCharacterCount,
            },
            this._profile,
            () => this.parseCompleteDocument(document.text),
        );
    }

    private parseChunk(
        documentText: string,
        range: TextRange,
        reusable: readonly TreeFragment[] = [],
    ): ParsedChunk {
        const text = documentText.slice(range.start, range.end);
        const candidate = reusable[0]?.tree;
        let mixed = candidate ? treeContainsMixedRegions(candidate) : false;
        let tree = (mixed ? this._mixedParser : this._plainParser).parse(text, reusable);
        let facts = collectSyntaxFacts(tree, text, this._profile);
        if (!mixed && facts.hasMixedRegions) {
            mixed = true;
            tree = this._mixedParser.parse(text, reusable);
            facts = collectSyntaxFacts(tree, text, this._profile);
        }
        return Object.freeze({
            ...range,
            tree,
            fragments: TreeFragment.addTree(tree, reusable),
            diagnostics: Object.freeze(facts.diagnostics),
            rawErrorNodeCount: facts.rawErrorNodeCount,
            batchCount: countTopLevelBatches(tree),
            mixed,
        });
    }

    private parseCompleteDocument(text: string): Tree {
        const tree = this._plainParser.parse(text);
        return treeContainsMixedRegions(tree) ? this._mixedParser.parse(text) : tree;
    }
}

function preservesChunkPartition(text: string, changes: readonly TextChange[]): boolean {
    if (changes.length !== 1) return false;
    const change = changes[0]!;
    if (change.text.length !== change.end - change.start) return false;
    const previous = text.slice(change.start, change.end);
    const lineStart = text.lastIndexOf("\n", Math.max(0, change.start - 1)) + 1;
    const nextLineBreak = text.indexOf("\n", change.end);
    const lineEnd = nextLineBreak < 0 ? text.length : nextLineBreak;
    if (/^\s*GO(?:\s|$)/iu.test(text.slice(lineStart, lineEnd))) return false;
    return (
        isBoundaryNeutralIdentifierText(previous) && isBoundaryNeutralIdentifierText(change.text)
    );
}

function isBoundaryNeutralIdentifierText(text: string): boolean {
    if (text.length === 0) return false;
    for (let index = 0; index < text.length; index++) {
        const code = text.charCodeAt(index);
        if (code === 71 || code === 79 || code === 103 || code === 111) return false;
        if (
            !(
                (code >= 48 && code <= 57) ||
                (code >= 65 && code <= 90) ||
                (code >= 97 && code <= 122) ||
                code === 35 ||
                code === 36 ||
                code === 64 ||
                code === 95 ||
                code > 127
            )
        ) {
            return false;
        }
    }
    return true;
}

function isBoundedMixedRegion(node: LezerNode): boolean {
    const parent = node.parent;
    if (!parent) return false;
    if (node.name === "BlockChunk") {
        if (parent.name === "ModuleBody") return true;
        if (parent.name !== "BeginControlStatement") return false;
        let hasBegin = false;
        let hasEnd = false;
        for (let child = parent.firstChild; child; child = child.nextSibling) {
            if (child.name === "Begin") hasBegin = true;
            else if (child.name === "End") hasEnd = true;
        }
        return hasBegin && hasEnd;
    }
    if (parent.name !== "OpaqueSqlStatement") return false;
    for (let ancestor = parent.parent; ancestor; ancestor = ancestor.parent) {
        if (
            ancestor.name === "IfStatement" ||
            ancestor.name === "WhileStatement" ||
            ancestor.name === "WaitForStatement"
        ) {
            return true;
        }
        if (ancestor.name === "Statement" || ancestor.name === "Batch") return false;
    }
    return false;
}

class LezerSyntaxSnapshot implements SyntaxSnapshot {
    public readonly diagnostics: readonly SyntaxDiagnostic[];
    public readonly statistics;
    public readonly profile: TsqlFeatureProfile;
    public readonly profileGeneration: string;
    private _materializedTree: Tree | undefined;
    private _structuralIndex: ReadonlyMap<string, readonly SyntaxNode[]> | undefined;
    private readonly _root: DocumentSyntaxNode;

    public constructor(
        public readonly document: TextSnapshot,
        public readonly chunks: readonly ParsedChunk[],
        public readonly changedRanges: readonly TextRange[],
        mode: "full" | "incremental",
        reuse: {
            readonly reusableFragmentCount: number;
            readonly reusedChunkCount: number;
            readonly reparsedChunkCount: number;
            readonly parsedCharacterCount: number;
        },
        profile: TsqlFeatureProfile,
        private readonly _materializeTree: () => Tree,
    ) {
        this.profile = profile;
        this.profileGeneration = capabilityGeneration(profile);
        this._root = new DocumentSyntaxNode(document.length, chunks);
        this.diagnostics = Object.freeze(
            chunks.flatMap((chunk) =>
                chunk.diagnostics.map((diagnostic) => shiftDiagnostic(diagnostic, chunk.start)),
            ),
        );
        this.statistics = Object.freeze({
            mode,
            changedRangeCount: changedRanges.length,
            ...reuse,
            chunkCount: chunks.length,
            rawErrorNodeCount: chunks.reduce((total, chunk) => total + chunk.rawErrorNodeCount, 0),
            batchCount: Math.max(
                1,
                chunks.reduce((total, chunk) => total + chunk.batchCount, 0) -
                    Math.max(0, chunks.length - 1),
            ),
        });
    }

    /** Compatibility/debug view. Production features use the chunk-aware snapshot methods. */
    public get tree(): Tree {
        return (this._materializedTree ??= this._materializeTree());
    }

    public root(): SyntaxNode {
        return this._root;
    }

    public structuralIndex(): ReadonlyMap<string, readonly SyntaxNode[]> {
        if (this._structuralIndex) return this._structuralIndex;
        const mutable = new Map<string, SyntaxNode[]>();
        for (const chunk of this.chunks) {
            chunk.tree.iterate({
                enter: (node) => {
                    if (!node.node.parent || (!node.node.firstChild && node.name !== "Variable")) {
                        return;
                    }
                    const nodes = mutable.get(node.name) ?? [];
                    nodes.push(
                        new OffsetLezerSyntaxNode(
                            node.node,
                            chunk.start,
                            chunk.tree.topNode,
                            this._root,
                        ),
                    );
                    mutable.set(node.name, nodes);
                },
            });
        }
        this._structuralIndex = mutable;
        return mutable;
    }

    public nodeAt(offset: number): SyntaxNode {
        const safeOffset = Math.max(0, Math.min(offset, this.document.length));
        const chunk = chunkAt(this.chunks, safeOffset);
        if (!chunk) return this._root;
        const node = chunk.tree.resolveInner(safeOffset - chunk.start, -1);
        return node === chunk.tree.topNode
            ? this._root
            : new OffsetLezerSyntaxNode(node, chunk.start, chunk.tree.topNode, this._root);
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
        let consumed = range.start;
        for (const chunk of chunksInRange(this.chunks, range)) {
            for (const node of leafNodes(
                chunk.tree.topNode,
                range.start - chunk.start,
                range.end - chunk.start,
            )) {
                const start = chunk.start + node.from;
                const end = chunk.start + node.to;
                if (
                    start < range.start ||
                    end > range.end ||
                    start === end ||
                    node.type.isAnonymous
                ) {
                    continue;
                }
                if (start > consumed) {
                    yield* triviaTokens(this.document.text, consumed, start);
                }
                const text = this.document.text.slice(start, end);
                if (node.name === "AtTimeZone") {
                    yield* compoundAtTimeZoneTokens(text, start, this.document.text);
                    consumed = Math.max(consumed, end);
                    continue;
                }
                const metadata =
                    keywordMetadata(text) ?? parserLocalKeywordMetadata(node.name, text);
                yield {
                    kind: metadata ? "Keyword" : node.name,
                    start,
                    end,
                    text,
                    trivia: node.name === "Whitespace" || node.name.endsWith("Comment"),
                    lineStart: isAtLineStart(this.document.text, start),
                    keyword: metadata?.category,
                };
                consumed = Math.max(consumed, end);
            }
        }
        if (consumed < range.end) yield* triviaTokens(this.document.text, consumed, range.end);
    }
}

function parserLocalKeywordMetadata(
    nodeName: string,
    text: string,
): { readonly category: "contextual" } | undefined {
    return nodeName !== "Identifier" && /^[\p{L}_][\p{L}\p{N}_$#@]*$/u.test(text)
        ? { category: "contextual" }
        : undefined;
}

function* compoundAtTimeZoneTokens(
    text: string,
    start: number,
    documentText: string,
): Iterable<SyntaxToken> {
    const matcher = /(?:at|time|zone)|\s+/giu;
    for (const match of text.matchAll(matcher)) {
        const tokenStart = start + match.index;
        const value = match[0];
        const trivia = /^\s+$/u.test(value);
        yield {
            kind: trivia ? "Whitespace" : "Keyword",
            start: tokenStart,
            end: tokenStart + value.length,
            text: value,
            trivia,
            lineStart: isAtLineStart(documentText, tokenStart),
            keyword: trivia ? undefined : "contextual",
        };
    }
}

class DocumentSyntaxNode implements SyntaxNode {
    public readonly kind = "Script";
    public readonly start = 0;
    public readonly error = false;

    public constructor(
        public readonly end: number,
        private readonly _chunks: readonly ParsedChunk[],
    ) {}

    public parent(): undefined {
        return undefined;
    }

    public *children(): Iterable<SyntaxNode> {
        for (let index = 0; index < this._chunks.length; index++) {
            const chunk = this._chunks[index]!;
            for (let child = chunk.tree.topNode.firstChild; child; child = child.nextSibling) {
                if (
                    index < this._chunks.length - 1 &&
                    child.name === "Batch" &&
                    child.from === child.to &&
                    child.to === chunk.end - chunk.start
                ) {
                    continue;
                }
                yield new OffsetLezerSyntaxNode(child, chunk.start, chunk.tree.topNode, this);
            }
        }
    }
}

class OffsetLezerSyntaxNode implements SyntaxNode {
    public constructor(
        private readonly _node: LezerNode,
        private readonly _offset: number,
        private readonly _chunkRoot: LezerNode,
        private readonly _documentRoot: DocumentSyntaxNode,
    ) {}

    public get kind(): string {
        return this._node.name;
    }

    public get start(): number {
        return this._offset + this._node.from;
    }

    public get end(): number {
        return this._offset + this._node.to;
    }

    public get error(): boolean {
        return this._node.type.isError;
    }

    public parent(): SyntaxNode | undefined {
        const parent = this._node.parent;
        return !parent || parent === this._chunkRoot
            ? this._documentRoot
            : new OffsetLezerSyntaxNode(parent, this._offset, this._chunkRoot, this._documentRoot);
    }

    public *children(): Iterable<SyntaxNode> {
        let child = this._node.firstChild;
        while (child) {
            yield new OffsetLezerSyntaxNode(
                child,
                this._offset,
                this._chunkRoot,
                this._documentRoot,
            );
            child = child.nextSibling;
        }
    }
}

function transformChunkCandidates(
    chunks: readonly ParsedChunk[],
    changes: readonly TextChange[],
): readonly ChunkCandidate[] {
    const candidates: ChunkCandidate[] = chunks.map((chunk) => ({
        chunk,
        start: chunk.start,
        end: chunk.end,
        dirty: false,
        compatible: true,
        localChanges: [],
    }));
    for (const change of changes) {
        const insertion = change.start === change.end;
        const delta = change.text.length - (change.end - change.start);
        for (let index = 0; index < candidates.length; index++) {
            const candidate = candidates[index]!;
            const oldStart = candidate.start;
            const oldEnd = candidate.end;
            if (insertion) {
                if (change.start < oldStart) {
                    candidate.start += delta;
                    candidate.end += delta;
                } else if (
                    change.start < oldEnd ||
                    (change.start === oldEnd && index === candidates.length - 1)
                ) {
                    candidate.localChanges.push({
                        start: change.start - oldStart,
                        end: change.end - oldStart,
                        text: change.text,
                    });
                    candidate.dirty = true;
                    candidate.end += delta;
                }
                continue;
            }
            if (change.end <= oldStart) {
                candidate.start += delta;
                candidate.end += delta;
            } else if (change.start >= oldEnd) {
                continue;
            } else if (change.start >= oldStart && change.end <= oldEnd) {
                candidate.localChanges.push({
                    start: change.start - oldStart,
                    end: change.end - oldStart,
                    text: change.text,
                });
                candidate.dirty = true;
                candidate.end += delta;
            } else {
                candidate.dirty = true;
                candidate.compatible = false;
                candidate.start = mapBoundaryStart(oldStart, change, delta);
                candidate.end = mapBoundaryEnd(oldEnd, change, delta);
            }
        }
    }
    return candidates;
}

function mapBoundaryStart(position: number, change: TextChange, delta: number): number {
    if (position <= change.start) return position;
    if (position >= change.end) return position + delta;
    return change.start;
}

function mapBoundaryEnd(position: number, change: TextChange, delta: number): number {
    if (position <= change.start) return position;
    if (position >= change.end) return position + delta;
    return change.start + change.text.length;
}

function chunkAt(chunks: readonly ParsedChunk[], offset: number): ParsedChunk | undefined {
    let low = 0;
    let high = chunks.length;
    while (low < high) {
        const middle = Math.floor((low + high) / 2);
        if (chunks[middle]!.end <= offset && middle < chunks.length - 1) low = middle + 1;
        else high = middle;
    }
    return chunks[low];
}

function* chunksInRange(chunks: readonly ParsedChunk[], range: TextRange): Iterable<ParsedChunk> {
    for (const chunk of chunks) {
        if (chunk.end <= range.start && chunk.end !== chunk.start) continue;
        if (chunk.start >= range.end && range.start !== range.end) break;
        yield chunk;
    }
}

function shiftDiagnostic(diagnostic: SyntaxDiagnostic, offset: number): SyntaxDiagnostic {
    return offset === 0
        ? diagnostic
        : {
              ...diagnostic,
              range: {
                  start: diagnostic.range.start + offset,
                  end: diagnostic.range.end + offset,
              },
          };
}

/**
 * Leaves of one chunk that intersect `[from, to]` in chunk-local offsets. Pruning whole subtrees
 * keeps a viewport-sized request proportional to the viewport rather than to the chunk.
 */
function* leafNodes(node: LezerNode, from: number, to: number): Iterable<LezerNode> {
    if (node.to < from || node.from > to) return;
    let child = node.firstChild;
    if (!child) {
        yield node;
        return;
    }
    while (child) {
        yield* leafNodes(child, from, to);
        child = child.nextSibling;
    }
}

function countTopLevelBatches(tree: Tree): number {
    let count = 0;
    for (let child = tree.topNode.firstChild; child; child = child.nextSibling) {
        if (child.name === "Batch") count++;
    }
    return count;
}

function* triviaTokens(text: string, start: number, end: number): Iterable<SyntaxToken> {
    let offset = start;
    while (offset < end) {
        const lineComment = text.startsWith("--", offset);
        const blockComment = text.startsWith("/*", offset);
        let tokenEnd = offset;
        let kind = "Whitespace";
        if (lineComment) {
            kind = "LineComment";
            tokenEnd = text.indexOf("\n", offset + 2);
            if (tokenEnd < 0 || tokenEnd > end) tokenEnd = end;
        } else if (blockComment) {
            kind = "BlockComment";
            tokenEnd = nestedCommentEnd(text, offset, end);
        } else {
            while (tokenEnd < end && /[\s]/u.test(text[tokenEnd]!)) tokenEnd++;
            if (tokenEnd === offset) return;
        }
        yield {
            kind,
            start: offset,
            end: tokenEnd,
            text: text.slice(offset, tokenEnd),
            trivia: true,
            lineStart: isAtLineStart(text, offset),
        };
        offset = tokenEnd;
    }
}

function nestedCommentEnd(text: string, start: number, limit: number): number {
    let offset = start + 2;
    let depth = 1;
    while (offset < limit && depth > 0) {
        if (text.startsWith("/*", offset)) {
            depth++;
            offset += 2;
        } else if (text.startsWith("*/", offset)) {
            depth--;
            offset += 2;
        } else {
            offset++;
        }
    }
    return offset;
}

function toChangedRange(change: TextChange) {
    return {
        fromA: change.start,
        toA: change.end,
        fromB: change.start,
        toB: change.start + change.text.length,
    };
}

function mapChangedRanges(
    previousRanges: readonly TextRange[],
    change: TextChange,
): readonly TextRange[] {
    const delta = change.text.length - (change.end - change.start);
    const mapped = previousRanges.map((range) => {
        if (range.end <= change.start) return range;
        if (range.start >= change.end) {
            return { start: range.start + delta, end: range.end + delta };
        }
        return {
            start: Math.min(range.start, change.start),
            end: Math.max(change.start + change.text.length, range.end + delta),
        };
    });
    mapped.push({ start: change.start, end: change.start + change.text.length });
    return mergeRanges(mapped);
}

function mergeRanges(ranges: readonly TextRange[]): readonly TextRange[] {
    const sorted = [...ranges].sort(
        (left, right) => left.start - right.start || left.end - right.end,
    );
    const result: TextRange[] = [];
    for (const range of sorted) {
        const previous = result.at(-1);
        if (!previous || range.start > previous.end) {
            result.push({ ...range });
        } else {
            result[result.length - 1] = {
                start: previous.start,
                end: Math.max(previous.end, range.end),
            };
        }
    }
    return result;
}

function collectSyntaxFacts(
    tree: Tree,
    text: string,
    profile: TsqlFeatureProfile,
): {
    readonly diagnostics: readonly SyntaxDiagnostic[];
    readonly rawErrorNodeCount: number;
    readonly hasMixedRegions: boolean;
} {
    const diagnostics: SyntaxDiagnostic[] = [];
    const reportedFeatures = new Set<string>();
    const unterminatedString = unterminatedStringRange(text);
    let rawErrorNodeCount = 0;
    let hasMixedRegions = false;
    tree.iterate({
        enter(node) {
            if (
                node.name === "ProceduralCondition" ||
                node.name === "BlockChunk" ||
                node.name === "StatementChunk" ||
                node.name === "GroupedQueryChunk"
            ) {
                hasMixedRegions = true;
            }
            if (node.name === "TriggerEventList" && !hasRawErrorNode(node.node)) {
                diagnostics.push(...duplicateTriggerActionDiagnostics(node.node, text));
            }
            if (node.name === "CreateTriggerStatement" || node.name === "AlterTriggerStatement") {
                const mismatch = invalidTriggerEventTypes(node.node, text);
                if (mismatch) diagnostics.push(mismatch);
            }
            if (node.name === "CreateSchemaStatement" && !hasRawErrorNode(node.node)) {
                if (!childNamed(node.node, "IdentifierName")) {
                    diagnostics.push({
                        code: "NameOrAuthorizationKeywordRequired",
                        message:
                            "The CREATE SCHEMA statement should be followed by a name or authorization keyword.",
                        severity: "error",
                        range: { start: node.from, end: node.to },
                    });
                }
            }
            if (node.name === "DropTriggerScope" && !hasRawErrorNode(node.node)) {
                const statement = node.node.parent;
                if (statement && statement.name !== "DropTriggerStatement") {
                    diagnostics.push({
                        code: "InvalidOnClause",
                        message: "The ON clause is not valid for this statement.",
                        severity: "error",
                        range: { start: node.from, end: node.to },
                    });
                }
            }
            if (node.type.isError) {
                rawErrorNodeCount++;
                if (
                    unterminatedString &&
                    node.from < unterminatedString.end &&
                    unterminatedString.start <= node.to
                ) {
                    return;
                }
                const merge = ancestorNamed(node.node, "MergeStatement");
                if (
                    merge &&
                    node.node.parent === merge &&
                    node.from === node.to &&
                    missingMergeTerminator(merge, text, node.from)
                ) {
                    diagnostics.push({
                        code: "syntax",
                        message: "A MERGE statement must be terminated by a semi-colon (;).",
                        severity: "error",
                        range: { start: node.from, end: node.from },
                    });
                } else {
                    const optionDiagnostic = invalidLoginOptionValue(node.node, text);
                    if (optionDiagnostic) {
                        diagnostics.push(optionDiagnostic);
                        return;
                    }
                    const nearRange = diagnosticNearRange(node.from, node.to, text);
                    const near =
                        nearRange.start === text.length
                            ? "End Of File"
                            : text.slice(nearRange.start, nearRange.end);
                    const expectation = expectedSuffix(node.node, text, nearRange);
                    const keyword = keywordMetadata(near);
                    diagnostics.push({
                        code: "syntax",
                        message:
                            keyword?.category === "reserved"
                                ? `Incorrect syntax near the keyword '${near}'.${expectation}`
                                : `Incorrect syntax near '${near}'.${expectation}`,
                        severity: "error",
                        range: nearRange,
                    });
                }
            }
            if (node.name === "IntegerLiteral" || node.name === "DecimalLiteral") {
                const value = text.slice(node.from, node.to);
                if ((value.match(/[0-9]/gu)?.length ?? 0) > 38) {
                    diagnostics.push({
                        code: "MaximumPrecisionOutOfRange",
                        message: `The number '${value}' is out of the range for numeric representation (maximum precision 38).`,
                        severity: "error",
                        range: { start: node.from, end: node.to },
                    });
                } else if (
                    node.name === "DecimalLiteral" &&
                    requiresIntegerLiteral(node.node, text)
                ) {
                    diagnostics.push({
                        code: "IntegerValueOutOfRange",
                        message: `The integer value ${value} is out of range.`,
                        severity: "error",
                        range: { start: node.from, end: node.to },
                    });
                }
            } else if (node.name === "FloatLiteral") {
                const value = text.slice(node.from, node.to);
                const incompleteExponent = /[eE][+-]?$/u.exec(value);
                if (incompleteExponent) {
                    const start = node.from + incompleteExponent.index;
                    diagnostics.push({
                        code: "syntax",
                        message: `Incorrect syntax near '${value[incompleteExponent.index]}'.`,
                        severity: "error",
                        range: { start, end: start + 1 },
                    });
                }
            } else if (node.name === "OdbcEscapeExpression") {
                const option = /^\{\s*([\p{L}_][\p{L}\p{N}_$#@]*)/iu.exec(
                    text.slice(node.from, node.to),
                )?.[1];
                if (option && !/^(?:CALL|D|ESCAPE|FN|GUID|OJ|T|TS)$/iu.test(option)) {
                    const start = findWord(text, node.from, node.to, option);
                    diagnostics.push({
                        code: "InvalidOdbcDatetimeExtensionOption",
                        message: `'${option}' is not a recognized ODBC date/time extension option.`,
                        severity: "error",
                        range: { start, end: start + option.length },
                    });
                }
            }
            const feature = platformFeatureForNode(node.name, text.slice(node.from, node.to));
            if (!feature) return;
            const detail = featureAvailabilityDetail(feature, profile);
            if (!detail) return;
            const range = availabilityRange(node.node, text, feature.keyword);
            const key = `${range.start}:${feature.id}`;
            if (reportedFeatures.has(key)) return;
            reportedFeatures.add(key);
            diagnostics.push({
                code: featureAvailabilityDiagnosticCode,
                message: featureAvailabilityMessage(feature, profile, detail),
                severity: "error",
                range,
                availability: detail,
            });
        },
    });
    const clauseDiagnostics = forClauseDiagnostics(tree, text);
    for (const diagnostic of clauseDiagnostics) {
        for (let index = diagnostics.length - 1; index >= 0; index--) {
            const existing = diagnostics[index]!;
            if (
                existing.code === "syntax" &&
                existing.range.start < diagnostic.range.end &&
                diagnostic.range.start < existing.range.end
            ) {
                diagnostics.splice(index, 1);
            }
        }
        diagnostics.push(diagnostic);
    }
    if (unterminatedString) {
        const value = text.slice(unterminatedString.start + 1).replaceAll("''", "'");
        diagnostics.push({
            code: "UnclosedQuotationMark",
            message: `Unclosed quotation mark after the character string '${value}'.`,
            severity: "error",
            range: unterminatedString,
        });
    }
    const unterminatedComment = unterminatedBlockCommentRange(text);
    if (unterminatedComment) {
        diagnostics.push({
            code: "syntax",
            message: "Unclosed comment was found at the end of the batch.",
            severity: "error",
            range: unterminatedComment,
        });
    }
    return { diagnostics, rawErrorNodeCount, hasMixedRegions };
}

/** Reports repeated INSERT, UPDATE, or DELETE actions in one DML trigger declaration. */
function duplicateTriggerActionDiagnostics(
    list: LezerNode,
    text: string,
): readonly SyntaxDiagnostic[] {
    const diagnostics: SyntaxDiagnostic[] = [];
    const seen = new Set<string>();
    for (let event = list.firstChild; event; event = event.nextSibling) {
        if (event.name !== "TriggerEvent") continue;
        const action = canonicalTriggerAction(text.slice(event.from, event.to));
        if (!action) continue;
        if (seen.has(action)) {
            diagnostics.push({
                code: "DuplicateTriggerActionType",
                message: `Duplicate specification of the action "${action}" in the trigger declaration.`,
                severity: "error",
                range: { start: event.from, end: event.to },
            });
        } else {
            seen.add(action);
        }
    }
    return diagnostics;
}

/**
 * Reports a trigger declaration whose event kinds do not belong to its target scope: a table or
 * view carries only DML actions, while DATABASE and ALL SERVER carry only DDL event names.
 */
function invalidTriggerEventTypes(
    statement: LezerNode,
    text: string,
): SyntaxDiagnostic | undefined {
    const name = childNamed(statement, "MultipartIdentifier");
    const target = childNamed(statement, "TriggerTarget");
    const events = childNamed(statement, "TriggerEventList");
    if (!name || !target || !events) return undefined;
    if (hasRawErrorNode(target) || hasRawErrorNode(events)) return undefined;
    for (let child = statement.firstChild; child; child = child.nextSibling) {
        if (child.type.isError && child.from <= events.to) return undefined;
    }
    let dmlEvents = false;
    let ddlEvents = false;
    for (let event = events.firstChild; event; event = event.nextSibling) {
        if (event.name !== "TriggerEvent") continue;
        if (canonicalTriggerAction(text.slice(event.from, event.to))) dmlEvents = true;
        else ddlEvents = true;
    }
    // A list mixing both kinds is not a well-formed activation, so recovery owns it.
    if (dmlEvents === ddlEvents) return undefined;
    const ddlTarget = childNamed(target, "MultipartIdentifier") === undefined;
    if (ddlTarget === ddlEvents) return undefined;
    return {
        code: "InvalidTriggerEventTypes",
        message: "The specified event types are not valid on the specified target object.",
        severity: "error",
        range: { start: name.from, end: name.to },
    };
}

function childNamed(node: LezerNode, name: string): LezerNode | undefined {
    for (let child = node.firstChild; child; child = child.nextSibling) {
        if (child.name === name) return child;
    }
    return undefined;
}

function hasRawErrorNode(node: LezerNode): boolean {
    if (node.type.isError) return true;
    for (let child = node.firstChild; child; child = child.nextSibling) {
        if (hasRawErrorNode(child)) return true;
    }
    return false;
}

function canonicalTriggerAction(value: string): string | undefined {
    const action = value.trim().toUpperCase();
    return action === "INSERT" || action === "UPDATE" || action === "DELETE" ? action : undefined;
}

function invalidLoginOptionValue(node: LezerNode, text: string): SyntaxDiagnostic | undefined {
    const option = ancestorNamed(node, "PrincipalNonPasswordOption");
    if (!option) return undefined;
    const source = text.slice(option.from, option.to);
    const match = /\b(CHECK_POLICY|CHECK_EXPIRATION)\s*=\s*(\S+)/iu.exec(source);
    if (!match || /^(?:ON|OFF)$/iu.test(match[2]!)) return undefined;
    const value = match[2]!.replace(/[;,]$/u, "");
    const start = option.from + match.index + match[0].lastIndexOf(match[2]!);
    return {
        code: "IncorrectOptionValue",
        message: `'${value}' in not a correct value for option '${match[1]!.toLocaleUpperCase()}'.`,
        severity: "error",
        range: { start, end: start + value.length },
    };
}

function forClauseDiagnostics(tree: Tree, text: string): readonly SyntaxDiagnostic[] {
    const diagnostics: SyntaxDiagnostic[] = [];
    tree.iterate({
        enter(node) {
            if (node.name !== "ForClause") return;
            const statement = ancestorNamed(node.node, "SelectStatement");
            const sourceEnd = statement?.to ?? node.to;
            const source = text.slice(node.from, sourceEnd);
            const mode = /^\s*FOR\s+(XML|JSON)\s+([\p{L}_][\p{L}\p{N}_$#@]*)/iu.exec(source);
            if (!mode) return;
            const kind = mode[1]!.toLocaleUpperCase();
            const format = mode[2]!.toLocaleUpperCase();
            const add = (code: string, message: string, pattern: RegExp): void => {
                const match = pattern.exec(source);
                if (!match) return;
                const start = node.from + match.index;
                diagnostics.push({
                    code,
                    message,
                    severity: "error",
                    range: { start, end: start + match[0].length },
                });
            };
            if (kind === "XML") {
                if (!/^(?:RAW|PATH)$/u.test(format)) {
                    add(
                        "RowTagOnlyInRawAndPath",
                        "Row tag name is only allowed with RAW or PATH mode of FOR XML.",
                        /\([^)]*\)/u,
                    );
                }
                if (format === "PATH") {
                    add(
                        "XmlSchemaError",
                        "Inline schema is not supported with FOR XML PATH.",
                        /\bXMLSCHEMA\b/iu,
                    );
                }
                if (format === "EXPLICIT") {
                    add(
                        "ElementsError",
                        "ELEMENTS option is only allowed in RAW, AUTO, and PATH modes of FOR XML.",
                        /\bELEMENTS\b/iu,
                    );
                }
                add(
                    "IncludeNullValuesError",
                    "INCLUDE_NULL_VALUES is only allowed in FOR JSON.",
                    /\bINCLUDE_NULL_VALUES\b/iu,
                );
                add(
                    "WithoutArrayWrapperError",
                    "WITHOUT_ARRAY_WRAPPER is only allowed in FOR JSON.",
                    /\bWITHOUT_ARRAY_WRAPPER\b/iu,
                );
            } else {
                add(
                    "Base64Error",
                    "BINARY BASE64 option is not allowed in FOR JSON.",
                    /\bBINARY\s+BASE64\b/iu,
                );
                add("TypeError", "TYPE option is not allowed in FOR JSON.", /\bTYPE\b/iu);
                add(
                    "ElementsError",
                    "ELEMENTS option is only allowed in RAW, AUTO, and PATH modes of FOR XML.",
                    /\bELEMENTS\b/iu,
                );
            }
        },
    });
    return diagnostics;
}

function treeContainsMixedRegions(tree: Tree): boolean {
    const cursor = tree.cursor();
    do {
        if (
            cursor.name === "ProceduralCondition" ||
            cursor.name === "BlockChunk" ||
            cursor.name === "StatementChunk" ||
            cursor.name === "GroupedQueryChunk"
        ) {
            return true;
        }
    } while (cursor.next());
    return false;
}
