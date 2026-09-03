/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Tree, TreeFragment, parseMixed, type SyntaxNode as LezerNode } from "@lezer/common";
import type { LRParser } from "@lezer/lr";
import type { TextChange, TextRange, TextSnapshot } from "../../text/index.js";
import type {
    ProfileAwareSyntaxService,
    SyntaxContext,
    SyntaxDiagnostic,
    SyntaxKind,
    SyntaxNode,
    SyntaxSnapshot,
    SyntaxToken,
    SyntaxTokenKind,
    TsqlFeatureProfile,
} from "../contracts.js";
import { capabilityGeneration, defaultTsqlFeatureProfile } from "../contracts.js";
import {
    featureAvailabilityDetail,
    featureAvailabilityDiagnosticCode,
    featureAvailabilityMessage,
    platformFeatureForNode,
} from "../../common/platformFeatureRegistry.js";
import { keywordMetadata } from "../keywords.js";
import { partitionSqlBatches } from "./batchChunking.js";
import {
    invalidBackupCompressionOption,
    invalidCollationName,
    invalidEventSessionUnit,
    invalidFunctionBody,
    invalidPredicateFunctionOperand,
} from "./functionBodyContractDiagnostics.js";
import { setLoginModifiersReachable } from "./keywordSpecializer.js";
import { invalidColumnKeyDiagnostics } from "./columnKeyRecoveryDiagnostics.js";
import { invalidPrincipalOptionDiagnostics } from "./principalOptionRecoveryDiagnostics.js";
import { recoveryTailDiagnostics } from "./recoveryTailDiagnostics.js";
import { securityPolicyRecoveryDiagnostics } from "./securityPolicyRecoveryDiagnostics.js";
import { semanticIndexOptionDiagnostics } from "./semanticIndexOptionDiagnostics.js";
import {
    constraintIndexOptionDiagnostics,
    indexOptionDiagnostics,
} from "./indexOptionDiagnostics.js";
import {
    invalidGeneratedColumnKind,
    ledgerTableOptionDiagnostics,
} from "./ledgerTableDiagnostics.js";
import { procedureRecoveryDiagnostics } from "./procedureRecoveryDiagnostics.js";
import { parser as generatedParser } from "./generated/tsqlParser.js";
import * as generatedTerms from "./generated/tsqlParser.terms.js";
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
    unterminatedDelimitedIdentifierRange,
    unterminatedStringRange,
} from "./syntaxDiagnosticUtilities.js";

const generatedSyntaxKinds: ReadonlySet<string> = new Set(Object.keys(generatedTerms));

/** Validates the parser boundary once instead of casting node names throughout the product. */
function syntaxKind(name: string): SyntaxKind {
    if (name === "⚠" || generatedSyntaxKinds.has(name)) return name as SyntaxKind;
    throw new Error(`Generated parser emitted unknown syntax kind '${name}'.`);
}

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

export class LezerSyntaxService implements ProfileAwareSyntaxService {
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
        setLoginModifiersReachable(loginPasswordClause.test(text));
        let tree = (mixed ? this._mixedParser : this._plainParser).parse(text, reusable);
        let facts = collectSyntaxFacts(tree, text, this._profile);
        if (!mixed && facts.hasMixedRegions) {
            mixed = true;
            tree = this._mixedParser.parse(text, reusable);
            facts = collectSyntaxFacts(tree, text, this._profile);
        }
        setLoginModifiersReachable(false);
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
        setLoginModifiersReachable(loginPasswordClause.test(text));
        try {
            const tree = this._plainParser.parse(text);
            return treeContainsMixedRegions(tree) ? this._mixedParser.parse(text) : tree;
        } finally {
            setLoginModifiersReachable(false);
        }
    }
}

/** Only a login password clause reaches the unknown-modifier recovery branch. */
const loginPasswordClause = /\bPASSWORD\b/iu;

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
    private _structuralIndex: ReadonlyMap<SyntaxKind, readonly SyntaxNode[]> | undefined;
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

    public structuralIndex(): ReadonlyMap<SyntaxKind, readonly SyntaxNode[]> {
        this._structuralIndex ??= new LazyStructuralIndex(this.chunks, this._root);
        return this._structuralIndex;
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
        const ancestors: SyntaxKind[] = [];
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
                    kind: metadata ? "Keyword" : syntaxKind(node.name),
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

/**
 * The nodes of a chunk's tree, bucketed by kind, kept against the tree itself.
 *
 * The walk is the expensive half of building a structural index, and an edit reparses one chunk out
 * of however many the document has. Keying on the tree means every chunk the incremental parse
 * reused keeps its buckets and only the reparsed one is walked again -- a keystroke in a megabyte
 * script walked all of it before this.
 *
 * The nodes here are chunk-relative and carry no document position, which is what lets them outlive
 * the snapshot that first asked for them: the chunk's offset and the document root both change when
 * text is inserted ahead of it, and both belong to the wrapper rather than to the tree.
 */
const chunkNodesByKind = new WeakMap<Tree, ReadonlyMap<string, readonly LezerNode[]>>();

function chunkIndex(tree: Tree): ReadonlyMap<string, readonly LezerNode[]> {
    const cached = chunkNodesByKind.get(tree);
    if (cached) return cached;
    const buckets = new Map<string, LezerNode[]>();
    tree.iterate({
        enter: (node) => {
            if (!node.node.parent || (!node.node.firstChild && node.name !== "Variable")) return;
            const bucket = buckets.get(node.name);
            if (bucket) bucket.push(node.node);
            else buckets.set(node.name, [node.node]);
        },
    });
    chunkNodesByKind.set(tree, buckets);
    return buckets;
}

/**
 * The document's nodes by kind, wrapped when a kind is first asked for.
 *
 * A bind asks for a fraction of the kinds a document contains -- 85 of them in a script holding
 * over five hundred thousand indexable nodes -- so wrapping every node to answer a few dozen
 * questions spent most of its time, and most of the garbage collector's, on nodes nobody read.
 *
 * Order is the document's: chunks are visited in order and each chunk's buckets are in the order the
 * pre-order walk found them. Callers depend on that -- the semantic layer binary-searches these
 * arrays by start offset -- so it is part of the contract rather than an accident.
 */
class LazyStructuralIndex implements ReadonlyMap<SyntaxKind, readonly SyntaxNode[]> {
    private readonly _wrapped = new Map<SyntaxKind, readonly SyntaxNode[]>();
    private _kinds: ReadonlySet<SyntaxKind> | undefined;

    public constructor(
        private readonly _chunks: readonly ParsedChunk[],
        private readonly _root: DocumentSyntaxNode,
    ) {}

    public get(kind: SyntaxKind): readonly SyntaxNode[] | undefined {
        const cached = this._wrapped.get(kind);
        if (cached) return cached.length > 0 ? cached : undefined;
        const nodes: SyntaxNode[] = [];
        for (const chunk of this._chunks) {
            const bucket = chunkIndex(chunk.tree).get(kind);
            if (!bucket) continue;
            for (const node of bucket) {
                nodes.push(
                    new OffsetLezerSyntaxNode(node, chunk.start, chunk.tree.topNode, this._root),
                );
            }
        }
        const frozen = Object.freeze(nodes);
        this._wrapped.set(kind, frozen);
        return frozen.length > 0 ? frozen : undefined;
    }

    /** Every kind the document holds, which the buckets answer without wrapping anything. */
    private get kinds(): ReadonlySet<SyntaxKind> {
        if (!this._kinds) {
            const kinds = new Set<SyntaxKind>();
            for (const chunk of this._chunks) {
                for (const kind of chunkIndex(chunk.tree).keys()) kinds.add(syntaxKind(kind));
            }
            this._kinds = kinds;
        }
        return this._kinds;
    }

    public get size(): number {
        return this.kinds.size;
    }

    public has(kind: SyntaxKind): boolean {
        return this.kinds.has(kind);
    }

    public *keys(): MapIterator<SyntaxKind> {
        yield* this.kinds;
    }

    public *values(): MapIterator<readonly SyntaxNode[]> {
        for (const kind of this.kinds) yield this.get(kind) ?? [];
    }

    public *entries(): MapIterator<[SyntaxKind, readonly SyntaxNode[]]> {
        for (const kind of this.kinds) yield [kind, this.get(kind) ?? []];
    }

    public forEach(
        callback: (
            value: readonly SyntaxNode[],
            key: SyntaxKind,
            map: ReadonlyMap<SyntaxKind, readonly SyntaxNode[]>,
        ) => void,
        thisArg?: unknown,
    ): void {
        for (const [kind, nodes] of this.entries()) callback.call(thisArg, nodes, kind, this);
    }

    public [Symbol.iterator](): MapIterator<[SyntaxKind, readonly SyntaxNode[]]> {
        return this.entries();
    }
}

class OffsetLezerSyntaxNode implements SyntaxNode {
    public constructor(
        private readonly _node: LezerNode,
        private readonly _offset: number,
        private readonly _chunkRoot: LezerNode,
        private readonly _documentRoot: DocumentSyntaxNode,
    ) {}

    public get kind(): SyntaxKind {
        return syntaxKind(this._node.name);
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
        let kind: SyntaxTokenKind = "Whitespace";
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
    const aiChunkSuppressedRawRanges: TextRange[] = [];
    const aiChunkDiagnostics = aiGenerateChunksDiagnostics(tree, text, aiChunkSuppressedRawRanges);
    diagnostics.push(...aiChunkDiagnostics);
    const unknownLoginOptions = unrecognizedLoginOptions(text);
    const reportedUnknownLoginOptions = new Set<number>();
    const diagnosticReplacements = [
        ...invalidExternalModelDiagnostics(text),
        ...invalidAlterColumnMaskingDiagnostics(text),
        ...invalidExternalStreamSyntaxDiagnostics(text),
        ...invalidBackupStorageRedundancyDiagnostics(text),
        ...invalidSemanticSearchDiagnostics(text),
        ...invalidAutomaticTuningDiagnostics(text),
        ...invalidDataDeletionDiagnostics(text),
        ...invalidColumnEncryptionDiagnostics(text),
        ...invalidCreateColumnMaskingDiagnostics(text),
        ...invalidColumnEncryptionKeyDiagnostics(text),
        ...invalidColumnKeyDiagnostics(text),
        ...securityPolicyRecoveryDiagnostics(text),
        ...invalidPrincipalOptionDiagnostics(text),
        ...invalidSensitivityClassificationDiagnostics(text),
        ...invalidBareClassificationDiagnostics(text),
        ...invalidBooleanDatabaseOptionDiagnostics(text),
        ...invalidSecondaryQueryStoreDiagnostics(text),
        ...invalidIncompleteTryCatchDiagnostics(text),
        ...terminalTryCatchLabelRecovery(text),
        ...invalidExternalLanguageDiagnostics(text),
        ...procedureRecoveryDiagnostics(text),
    ];
    diagnostics.push(...diagnosticReplacements.flatMap(({ diagnostics: items }) => items));
    const unterminatedString = unterminatedStringRange(text);
    const unterminatedIdentifier = unterminatedDelimitedIdentifierRange(text);
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
            if (node.name === "FunctionDefinition" && !hasRawErrorNode(node.node)) {
                const body = invalidFunctionBody(node.node, text);
                if (body) diagnostics.push(body);
            }
            if (node.name === "FunctionCall" && !hasRawErrorNode(node.node)) {
                const operand = invalidPredicateFunctionOperand(node.node, text);
                if (operand) diagnostics.push(operand);
            }
            if (node.name === "EventSessionOptionValue" && !hasRawErrorNode(node.node)) {
                const unit = invalidEventSessionUnit(node.node, text);
                if (unit) diagnostics.push(unit);
            }
            if (node.name === "BackupRestoreOption" && !hasRawErrorNode(node.node)) {
                for (const option of childrenOfKind(node.node, "GenericOption")) {
                    const compression = invalidBackupCompressionOption(option, text);
                    if (compression) diagnostics.push(compression);
                }
            }
            if (node.name === "CollateClause" && !hasRawErrorNode(node.node)) {
                const collation = invalidCollationName(node.node, text);
                if (collation) diagnostics.push(collation);
            }
            if (node.name === "PrincipalNonPasswordOption" && !hasRawErrorNode(node.node)) {
                const optionValue = invalidPrincipalOptionValue(node.node, text);
                if (optionValue) diagnostics.push(optionValue);
            }
            if (node.name === "ResourceWithClause" && !hasRawErrorNode(node.node)) {
                // Resource governor settings are numeric or named, never quoted, and one bad
                // value ends the list the product reads.
                const quoted = descendantNamed(node.node, "StringLiteral");
                if (quoted) {
                    diagnostics.push({
                        code: "syntax",
                        message: `Incorrect syntax near '${text.slice(quoted.from, quoted.to)}'.  Expecting ID, INTEGER, or NUMERIC.`,
                        severity: "error",
                        range: { start: quoted.from, end: quoted.to },
                    });
                }
            }
            if (node.name === "CreateSemanticIndexStatement") {
                diagnostics.push(...semanticIndexOptionDiagnostics(node.node, text));
            }
            if (node.name === "IndexWithClause" && !hasRawErrorNode(node.node)) {
                diagnostics.push(...indexOptionDiagnostics(node.node, text));
            }
            if (node.name === "ConstraintIndexWithClause" && !hasRawErrorNode(node.node)) {
                diagnostics.push(...constraintIndexOptionDiagnostics(node.node, text));
            }
            if (node.name === "TableOptionClause" && !hasRawErrorNode(node.node)) {
                diagnostics.push(...ledgerTableOptionDiagnostics(node.node, text));
            }
            if (node.name === "GeneratedColumnKind" && !hasRawErrorNode(node.node)) {
                const invalidKind = invalidGeneratedColumnKind(node.node, text);
                if (invalidKind) diagnostics.push(invalidKind);
            }
            if (node.name === "CreateTriggerStatement" || node.name === "AlterTriggerStatement") {
                const mismatch = invalidTriggerEventTypes(node.node, text);
                if (mismatch) diagnostics.push(mismatch);
            }
            if (
                node.name === "CreateProcedureStatement" ||
                node.name === "AlterProcedureStatement" ||
                node.name === "CreateTriggerStatement" ||
                node.name === "AlterTriggerStatement"
            ) {
                const invalidPlacement = invalidNestedTsqlModule(node.node, text);
                if (invalidPlacement) diagnostics.push(invalidPlacement);
            }
            if (node.name === "CreateSchemaStatement") {
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
            if (node.name === "CreateViewStatement" || node.name === "AlterViewStatement") {
                const into = descendantNamed(node.node, "IntoClause");
                const token = into && childNamed(into, "Into");
                if (token) {
                    diagnostics.push({
                        code: "syntax",
                        message: `Incorrect syntax near '${text.slice(token.from, token.to)}'.`,
                        severity: "error",
                        range: { start: token.from, end: token.to },
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
                    [unterminatedString, unterminatedIdentifier].some(
                        (range) => range && node.from < range.end && range.start <= node.to,
                    )
                ) {
                    return;
                }
                const diagnosticReplacement = diagnosticReplacements.find(
                    ({ recoveryRange }) =>
                        recoveryRange.start <= node.from && node.from <= recoveryRange.end,
                );
                if (diagnosticReplacement) return;
                const unknownLoginOption = unknownLoginOptions.find(
                    ({ recoveryRange }) =>
                        recoveryRange.start <= node.from && node.from <= recoveryRange.end,
                );
                if (unknownLoginOption) {
                    if (
                        !reportedUnknownLoginOptions.has(unknownLoginOption.diagnostic.range.start)
                    ) {
                        reportedUnknownLoginOptions.add(unknownLoginOption.diagnostic.range.start);
                        diagnostics.push(unknownLoginOption.diagnostic);
                    }
                    return;
                }
                const parameterOption = invalidParameterOption(node.node, text);
                if (parameterOption) {
                    diagnostics.push(parameterOption);
                    return;
                }
                const rawNearRange = diagnosticNearRange(node.from, node.to, text);
                if (
                    aiChunkSuppressedRawRanges.some(
                        (range) => range.start <= node.from && node.to <= range.end,
                    ) ||
                    aiChunkDiagnostics.some(
                        ({ range }) =>
                            range.start === rawNearRange.start && range.end === rawNearRange.end,
                    )
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
                    const commonError = commonErrorMessage(text, nearRange, near);
                    // One shape names the offending token, whether or not it is a keyword, so a
                    // reader can match a message to a token without knowing the reserved list.
                    diagnostics.push({
                        code: "syntax",
                        message: commonError ?? `Incorrect syntax near '${near}'.${expectation}`,
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
                    (node.name === "DecimalLiteral" ||
                        integerLiteralExceedsInt32(node.node, text)) &&
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
    // The tail can name a token another pass already reported. One report of it is enough.
    const alreadyReported = new Set(
        diagnostics.map(({ range, message }) => `${range.start}:${range.end}:${message}`),
    );
    diagnostics.push(
        ...recoveryTailDiagnostics(tree, text).filter(
            ({ range, message }) => !alreadyReported.has(`${range.start}:${range.end}:${message}`),
        ),
    );
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
        // The run is quoted exactly as written, opening delimiter included, the way an unclosed
        // delimited name is, so the reader sees the text the scanner is still inside.
        const value = text.slice(unterminatedString.start);
        diagnostics.push({
            code: "UnclosedQuotationMark",
            message: `Unclosed quotation mark after the character string '${value}'.`,
            severity: "error",
            range: unterminatedString,
        });
    }
    if (unterminatedIdentifier) {
        const value = text.slice(unterminatedIdentifier.start);
        diagnostics.push({
            code: "UnclosedQuotationMark",
            message: `Unclosed quotation mark after the character string '${value}'.`,
            severity: "error",
            range: unterminatedIdentifier,
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
    diagnostics.sort(
        (left, right) => left.range.start - right.range.start || left.range.end - right.range.end,
    );
    return { diagnostics, rawErrorNodeCount, hasMixedRegions };
}

interface AiGenerateChunksArgument {
    readonly name: string | undefined;
    readonly nameRange: TextRange;
    readonly equalRange: TextRange | undefined;
    readonly valueRange: TextRange;
    readonly precedingComma: TextRange | undefined;
}

/** Validates the fixed named-argument contract of the one-part AI chunking rowset. */
function aiGenerateChunksDiagnostics(
    tree: Tree,
    text: string,
    suppressedRawRanges: TextRange[],
): readonly SyntaxDiagnostic[] {
    const diagnostics: SyntaxDiagnostic[] = [];
    tree.iterate({
        enter(node) {
            if (node.name !== "FunctionTableSource") return;
            const tableName = childNamed(node.node, "TableSourceName");
            if (
                !tableName ||
                text.slice(tableName.from, tableName.to).toUpperCase() !== "AI_GENERATE_CHUNKS"
            ) {
                return;
            }
            const open = childNamed(node.node, "OpenParen");
            const close = childNamed(node.node, "CloseParen");
            if (!open || !close || open.to > close.from) return;
            const innerStart = skipSqlTrivia(text, open.to, close.from);
            if (text[innerStart] === "(") {
                const equal = text.indexOf("=", innerStart + 1);
                if (equal >= 0 && equal < close.from) {
                    diagnostics.push(
                        aiChunksExpected(text, { start: equal, end: equal + 1 }),
                        aiChunksExpected(text, { start: close.from, end: close.to }),
                    );
                    suppressedRawRanges.push({ start: open.to, end: node.to });
                }
                return;
            }
            const arguments_ = aiGenerateChunksArguments(text, open.to, close.from);
            if (arguments_.length === 0 || arguments_[0]!.name !== "SOURCE") return;

            let state: "chunkType" | "chunkSize" | "optional" | "end" = "chunkType";
            let overlapSeen = false;
            for (let index = 1; index < arguments_.length; index++) {
                const argument = arguments_[index]!;
                if (!argument.name) continue;
                if (state === "chunkType") {
                    if (argument.name !== "CHUNK_TYPE") {
                        diagnostics.push(aiChunksExpected(text, argument.nameRange, "CHUNK_TYPE"));
                        continue;
                    }
                    if (normalizedArgumentValue(text, argument.valueRange) !== "FIXED") {
                        diagnostics.push(
                            aiChunksExpected(
                                text,
                                valueNearRange(text, argument.valueRange, close),
                                "FIXED",
                            ),
                        );
                        continue;
                    }
                    state = "chunkSize";
                    continue;
                }
                if (state === "chunkSize") {
                    if (argument.name !== "CHUNK_SIZE") {
                        diagnostics.push(aiChunksExpected(text, argument.nameRange, "CHUNK_SIZE"));
                        state = "chunkType";
                        continue;
                    }
                    state = "optional";
                    continue;
                }
                if (state === "optional") {
                    if (argument.name === "OVERLAP" && !overlapSeen) {
                        overlapSeen = true;
                        continue;
                    }
                    if (argument.name === "ENABLE_CHUNK_SET_ID") {
                        diagnostics.push(...validateChunkSetId(text, argument, close));
                        state = "end";
                        continue;
                    }
                    diagnostics.push(aiChunksExpected(text, argument.nameRange, "CHUNK_SET_ID"));
                    continue;
                }
                if (argument.precedingComma) {
                    diagnostics.push(aiChunksExpected(text, argument.precedingComma, "')'"));
                }
                if (argument.equalRange) {
                    diagnostics.push(aiChunksExpected(text, argument.equalRange));
                }
            }

            if (arguments_.length === 1) {
                diagnostics.push(aiChunksExpected(text, { start: close.from, end: close.to }));
            } else if (state === "chunkSize") {
                diagnostics.push(
                    aiChunksExpected(text, { start: close.from, end: close.to }, "','"),
                );
            }
        },
    });
    return diagnostics;
}

function validateChunkSetId(
    text: string,
    argument: AiGenerateChunksArgument,
    close: LezerNode,
): readonly SyntaxDiagnostic[] {
    const value = normalizedArgumentValue(text, argument.valueRange);
    if (value === "NULL" || /^\d+$/u.test(value)) return [];
    const range = valueNearRange(text, argument.valueRange, close);
    const result = [aiChunksExpected(text, range, "INTEGER, or NULL")];
    const source = text.slice(argument.valueRange.start, argument.valueRange.end).trim();
    if (/^[\p{L}_][\p{L}\p{N}_$#@]*\s*\(.*\)$/su.test(source)) {
        const end = argument.valueRange.end;
        let position = end - 1;
        while (position >= argument.valueRange.start && /\s/u.test(text[position]!)) position--;
        if (text[position] === ")") {
            result.push(
                aiChunksExpected(text, { start: position, end: position + 1 }, "'(', or SELECT"),
            );
        }
    }
    return result;
}

function aiChunksExpected(text: string, range: TextRange, expected?: string): SyntaxDiagnostic {
    const near = text.slice(range.start, range.end);
    return {
        code: "syntax",
        message: `Incorrect syntax near '${near}'.${expected ? `  Expecting ${expected}.` : ""}`,
        severity: "error",
        range,
    };
}

function aiGenerateChunksArguments(
    text: string,
    start: number,
    end: number,
): readonly AiGenerateChunksArgument[] {
    const spans: { start: number; end: number; precedingComma?: TextRange }[] = [];
    let segmentStart = start;
    let precedingComma: TextRange | undefined;
    let depth = 0;
    let quote: "string" | "quoted" | "bracket" | undefined;
    let blockDepth = 0;
    for (let index = start; index < end; index++) {
        const current = text[index];
        const next = text[index + 1];
        if (blockDepth > 0) {
            if (current === "/" && next === "*") {
                blockDepth++;
                index++;
            } else if (current === "*" && next === "/") {
                blockDepth--;
                index++;
            }
            continue;
        }
        if (quote) {
            const terminator = quote === "string" ? "'" : quote === "quoted" ? '"' : "]";
            if (current === terminator && next === terminator) index++;
            else if (current === terminator) quote = undefined;
            continue;
        }
        if (current === "-" && next === "-") {
            const newline = text.indexOf("\n", index + 2);
            index = newline < 0 || newline >= end ? end : newline;
        } else if (current === "/" && next === "*") {
            blockDepth++;
            index++;
        } else if (current === "'") quote = "string";
        else if (current === '"') quote = "quoted";
        else if (current === "[") quote = "bracket";
        else if (current === "(") depth++;
        else if (current === ")") depth = Math.max(0, depth - 1);
        else if (current === "," && depth === 0) {
            spans.push({
                start: segmentStart,
                end: index,
                ...(precedingComma ? { precedingComma } : {}),
            });
            precedingComma = { start: index, end: index + 1 };
            segmentStart = index + 1;
        }
    }
    spans.push({ start: segmentStart, end, ...(precedingComma ? { precedingComma } : {}) });
    return spans.map((span) => aiGenerateChunksArgument(text, span));
}

function aiGenerateChunksArgument(
    text: string,
    span: { readonly start: number; readonly end: number; readonly precedingComma?: TextRange },
): AiGenerateChunksArgument {
    let start = skipSqlTrivia(text, span.start, span.end);
    const nameMatch = /^[\p{L}_][\p{L}\p{N}_$#@]*/u.exec(text.slice(start, span.end));
    const nameRange = nameMatch
        ? { start, end: start + nameMatch[0].length }
        : { start, end: Math.min(start + 1, span.end) };
    start = nameRange.end;
    start = skipSqlTrivia(text, start, span.end);
    const equalRange = text[start] === "=" ? { start, end: start + 1 } : undefined;
    if (equalRange) start = skipSqlTrivia(text, equalRange.end, span.end);
    let valueEnd = span.end;
    while (valueEnd > start && /\s/u.test(text[valueEnd - 1]!)) valueEnd--;
    return {
        name: nameMatch?.[0].toUpperCase(),
        nameRange,
        equalRange,
        valueRange: { start, end: valueEnd },
        precedingComma: span.precedingComma,
    };
}

function skipSqlTrivia(text: string, start: number, end: number): number {
    let position = start;
    while (position < end) {
        if (/\s/u.test(text[position]!)) {
            position++;
            continue;
        }
        if (text.startsWith("/*", position)) {
            const close = text.indexOf("*/", position + 2);
            position = close < 0 || close >= end ? end : close + 2;
            continue;
        }
        if (text.startsWith("--", position)) {
            const newline = text.indexOf("\n", position + 2);
            position = newline < 0 || newline >= end ? end : newline + 1;
            continue;
        }
        break;
    }
    return position;
}

function normalizedArgumentValue(text: string, range: TextRange): string {
    return text.slice(range.start, range.end).trim().toUpperCase();
}

function valueNearRange(text: string, range: TextRange, close: LezerNode): TextRange {
    if (range.start === range.end) {
        if (text[range.start] === ",") return { start: range.start, end: range.start + 1 };
        return { start: close.from, end: close.to };
    }
    const value = text.slice(range.start, range.end);
    const string = /^(?:N)?'(?:''|[^'])*'/iu.exec(value)?.[0];
    const variable = /^@[\p{L}_][\p{L}\p{N}_$#@]*/u.exec(value)?.[0];
    const number = /^\d+(?:\.\d+)?/u.exec(value)?.[0];
    const word = /^[\p{L}_][\p{L}\p{N}_$#@]*/u.exec(value)?.[0];
    const token = string ?? variable ?? number ?? word ?? value[0]!;
    return { start: range.start, end: range.start + token.length };
}

interface SyntaxDiagnosticReplacement {
    readonly diagnostics: readonly SyntaxDiagnostic[];
    readonly recoveryRange: TextRange;
}

function invalidExternalModelDiagnostics(text: string): readonly SyntaxDiagnosticReplacement[] {
    if (!/\bEXTERNAL\s+(?:MODEL|MODLE)\b/iu.test(text)) return [];
    return [
        ...invalidExternalModelWithClauses(text),
        ...misspelledExternalModelStatements(text),
        ...invalidAlterExternalModelAuthorization(text),
        ...invalidExternalModelOptionValues(text),
        ...misspelledExternalModelOptions(text),
    ];
}

function invalidExternalModelWithClauses(text: string): readonly SyntaxDiagnosticReplacement[] {
    const result: {
        diagnostics: SyntaxDiagnostic[];
        recoveryRange: TextRange;
    }[] = [];
    const pattern =
        /\bALTER\s+EXTERNAL\s+MODEL\s+(?:\[[^\]]+\]|"(?:""|[^"])+"|[\p{L}_][\p{L}\p{N}_$#@]*)\s+(WITH)\s*(\()\s*([\p{L}_][\p{L}\p{N}_$#@]*)/giu;
    for (const match of text.matchAll(pattern)) {
        const withStart = match.index + match[0].indexOf(match[1]!);
        const openStart = match.index + match[0].indexOf(match[2]!, withStart - match.index);
        const optionStart = match.index + match[0].lastIndexOf(match[3]!);
        const end = externalModelRecoveryEnd(text, optionStart);
        result.push({
            diagnostics: [
                {
                    code: "syntax",
                    message: "Incorrect syntax near 'WITH'.  Expecting SET.",
                    severity: "error",
                    range: { start: withStart, end: withStart + match[1]!.length },
                },
                {
                    code: "syntax",
                    message:
                        "Incorrect syntax near '('.  Expecting CHANGE_TRACKING_CONTEXT, ID, QUOTED_ID, or XMLNAMESPACES.",
                    severity: "error",
                    range: { start: openStart, end: openStart + 1 },
                },
                {
                    code: "syntax",
                    message: `Incorrect syntax near '${match[3]}'.  Expecting '(', or SELECT.`,
                    severity: "error",
                    range: { start: optionStart, end: optionStart + match[3]!.length },
                },
            ],
            recoveryRange: { start: withStart, end },
        });
    }
    return result;
}

function misspelledExternalModelStatements(text: string): readonly SyntaxDiagnosticReplacement[] {
    const result: SyntaxDiagnosticReplacement[] = [];
    const name = String.raw`(?:\[[^\]]+\]|"(?:""|[^"])+"|[\p{L}_][\p{L}\p{N}_$#@]*)`;
    const createOrAlter = new RegExp(
        String.raw`\b(CREATE|ALTER)\s+EXTERNAL\s+(MODLE)\s+${name}\s+(?:WITH|SET)\s*(\()\s*([\p{L}_][\p{L}\p{N}_$#@]*)`,
        "giu",
    );
    for (const match of text.matchAll(createOrAlter)) {
        const action = match[1]!.toUpperCase();
        const modelStart = match.index + match[0].indexOf(match[2]!);
        const openStart = match.index + match[0].indexOf(match[3]!, modelStart - match.index);
        const optionStart = match.index + match[0].lastIndexOf(match[4]!);
        const diagnostics: SyntaxDiagnostic[] = [
            syntaxDiagnosticAt(
                text,
                { start: modelStart, end: modelStart + match[2]!.length },
                action === "ALTER"
                    ? "DATASOURCE, LANGUAGE, LIBRARY, MODEL, or RESOURCE"
                    : undefined,
            ),
        ];
        if (action === "ALTER") {
            const setMatch = /\bSET\b/iu.exec(text.slice(modelStart, openStart));
            if (setMatch) {
                const start = modelStart + setMatch.index;
                diagnostics.push(syntaxDiagnosticAt(text, { start, end: start + 3 }));
            }
        } else {
            diagnostics.push(
                syntaxDiagnosticAt(
                    text,
                    { start: openStart, end: openStart + 1 },
                    "CHANGE_TRACKING_CONTEXT, ID, QUOTED_ID, or XMLNAMESPACES",
                ),
            );
        }
        diagnostics.push(
            syntaxDiagnosticAt(
                text,
                { start: optionStart, end: optionStart + match[4]!.length },
                "'(', or SELECT",
            ),
        );
        result.push({
            diagnostics,
            recoveryRange: {
                start: modelStart,
                end: externalModelRecoveryEnd(text, optionStart),
            },
        });
    }
    const drop =
        /\bDROP\s+EXTERNAL\s+(MODLE)\s+(?:\[[^\]]+\]|"(?:""|[^"])+"|[\p{L}_][\p{L}\p{N}_$#@]*)/giu;
    for (const match of text.matchAll(drop)) {
        const start = match.index + match[0].indexOf(match[1]!);
        result.push({
            diagnostics: [syntaxDiagnosticAt(text, { start, end: start + match[1]!.length })],
            recoveryRange: {
                start,
                end: externalModelRecoveryEnd(text, start),
            },
        });
    }
    return result;
}

function invalidAlterExternalModelAuthorization(
    text: string,
): readonly SyntaxDiagnosticReplacement[] {
    const result: SyntaxDiagnosticReplacement[] = [];
    const pattern =
        /\bALTER\s+EXTERNAL\s+MODEL\s+(?:\[[^\]]+\]|"(?:""|[^"])+"|[\p{L}_][\p{L}\p{N}_$#@]*)\s+(AUTHORIZATION)\s+(?:\[[^\]]+\]|"(?:""|[^"])+"|[\p{L}_][\p{L}\p{N}_$#@]*)\s+(SET)\s*(\()\s*([\p{L}_][\p{L}\p{N}_$#@]*)/giu;
    for (const match of text.matchAll(pattern)) {
        const authorizationStart = match.index + match[0].indexOf(match[1]!);
        const setStart =
            match.index + match[0].indexOf(match[2]!, authorizationStart - match.index);
        const optionStart = match.index + match[0].lastIndexOf(match[4]!);
        result.push({
            diagnostics: [
                syntaxDiagnosticAt(
                    text,
                    { start: authorizationStart, end: authorizationStart + match[1]!.length },
                    "SET",
                ),
                syntaxDiagnosticAt(text, { start: setStart, end: setStart + match[2]!.length }),
                syntaxDiagnosticAt(
                    text,
                    { start: optionStart, end: optionStart + match[4]!.length },
                    "'(', or SELECT",
                ),
            ],
            recoveryRange: {
                start: authorizationStart,
                end: externalModelRecoveryEnd(text, optionStart),
            },
        });
    }
    return result;
}

function invalidExternalModelOptionValues(text: string): readonly SyntaxDiagnosticReplacement[] {
    const result: SyntaxDiagnosticReplacement[] = [];
    const statement =
        /\b(?:CREATE|ALTER)\s+EXTERNAL\s+MODEL\b[^;]*(?:WITH|SET)\s*\(([\s\S]*?)\)\s*;?/giu;
    for (const match of text.matchAll(statement)) {
        const body = match[1]!;
        const bodyStart = match.index + match[0].indexOf(body);
        for (const option of [
            {
                pattern: /\bAPI_FORMAT\s*=\s*([^,)]*)/giu,
                expected: "STRING, or TEXT_LEX",
                valid: (value: string) => /^(?:N)?'(?:''|[^'])*'$/iu.test(value),
            },
            {
                pattern: /\bMODEL_TYPE\s*=\s*([^,)]*)/giu,
                expected: "EMBEDDINGS",
                valid: (value: string) => value.toUpperCase() === "EMBEDDINGS",
            },
        ]) {
            for (const valueMatch of body.matchAll(option.pattern)) {
                const raw = valueMatch[1]!;
                const value = raw.trim();
                if (!value || option.valid(value)) continue;
                const start = bodyStart + valueMatch.index + valueMatch[0].lastIndexOf(value);
                result.push({
                    diagnostics: [
                        syntaxDiagnosticAt(
                            text,
                            { start, end: start + value.length },
                            option.expected,
                        ),
                    ],
                    recoveryRange: {
                        start,
                        end: match.index + match[0].length,
                    },
                });
            }
        }
    }
    return result;
}

function misspelledExternalModelOptions(text: string): readonly SyntaxDiagnosticReplacement[] {
    const result: SyntaxDiagnosticReplacement[] = [];
    const statement =
        /\b(?:CREATE|ALTER)\s+EXTERNAL\s+MODEL\b[^;]*(?:WITH|SET)\s*\(([\s\S]*?)\)\s*;?/giu;
    for (const match of text.matchAll(statement)) {
        const body = match[1]!;
        const bodyStart = match.index + match[0].indexOf(body);
        for (const option of body.matchAll(/\b(LOCALRUNTIMEPATH)\s*=/giu)) {
            const start = bodyStart + option.index;
            result.push({
                diagnostics: [syntaxDiagnosticAt(text, { start, end: start + option[1]!.length })],
                recoveryRange: { start, end: start + option[1]!.length },
            });
        }
    }
    return result;
}

function invalidAlterColumnMaskingDiagnostics(
    text: string,
): readonly SyntaxDiagnosticReplacement[] {
    if (!/\bALTER\s+TABLE\b[\s\S]*\bALTER\s+COLUMN\b[\s\S]*\b(?:MASKED|MASKD)\b/iu.test(text)) {
        return [];
    }
    const identifier = String.raw`(?:\[[^\]]+\]|"(?:""|[^"])+"|[\p{L}_][\p{L}\p{N}_$#@]*)`;
    const multipart = String.raw`${identifier}(?:\s*\.\s*${identifier})*`;
    const prefix = String.raw`\bALTER\s+TABLE\s+${multipart}\s+ALTER\s+COLUMN\s+${identifier}\s+`;
    const longAttributeExpectation =
        "COLADDROPOPT_HIDDEN, COLADDROPOPT_MASKED, COLADDROPOPT_PERSISTED, COLADDROPOPT_SPARSE, NOT_FOR, or ROWGUIDCOL";
    const definitions: readonly {
        readonly pattern: RegExp;
        readonly diagnostics: readonly { readonly group: string; readonly expected?: string }[];
    }[] = [
        {
            pattern: new RegExp(
                `${prefix}ADD\\s+MASKED\\s*(?<open>\\()\\s*(?<function>FUNCTION)`,
                "giu",
            ),
            diagnostics: [
                { group: "open", expected: "WITH" },
                { group: "function", expected: "'(', or SELECT" },
            ],
        },
        {
            pattern: new RegExp(
                `${prefix}ADD\\s+(?<masked>MASKD)\\s+WITH\\s*(?<open>\\()\\s*(?<function>FUNCTION)`,
                "giu",
            ),
            diagnostics: [
                { group: "masked", expected: longAttributeExpectation },
                {
                    group: "open",
                    expected: "CHANGE_TRACKING_CONTEXT, ID, QUOTED_ID, or XMLNAMESPACES",
                },
                { group: "function", expected: "'(', or SELECT" },
            ],
        },
        {
            pattern: new RegExp(
                `${prefix}ADD\\s+MASKED\\s+WITH\\s+(?<function>FUNCTION)\\s*=`,
                "giu",
            ),
            diagnostics: [{ group: "function", expected: "'('" }],
        },
        {
            pattern: new RegExp(
                `${prefix}ADD\\s+MASKED\\s+WITH\\s*\\(\\s*FUNCTION\\s+(?<value>(?:N)?'(?:''|[^'])+')`,
                "giu",
            ),
            diagnostics: [{ group: "value", expected: "'='" }],
        },
        {
            pattern: new RegExp(
                `${prefix}ADD\\s+MASKED\\s+WITH\\s*\\(\\s*FUNCTION\\s*=\\s*(?<value>[\\p{L}_][\\p{L}\\p{N}_$#@]*)\\s*\\(\\s*(?<close>\\))`,
                "giu",
            ),
            diagnostics: [
                { group: "value", expected: "STRING" },
                { group: "close", expected: "'(', or SELECT" },
            ],
        },
        {
            pattern: new RegExp(
                `${prefix}ADD\\s+MASKED\\s+WITH\\s*\\(\\s*(?<value>(?:N)?'(?:''|[^'])+')`,
                "giu",
            ),
            diagnostics: [{ group: "value", expected: "FUNCTION" }],
        },
        {
            pattern: new RegExp(
                `${prefix}ADD\\s+MASKED\\s+(?<with>WTH)\\s*\\(\\s*(?<function>FUNCTION)`,
                "giu",
            ),
            diagnostics: [
                { group: "with", expected: "WITH" },
                { group: "function", expected: "'(', or SELECT" },
            ],
        },
        {
            pattern: new RegExp(
                `${prefix}ADD\\s+MASKED\\s+WITH\\s*\\(\\s*(?<function>FNCTION)\\s*=`,
                "giu",
            ),
            diagnostics: [{ group: "function", expected: "FUNCTION" }],
        },
        {
            pattern: new RegExp(`${prefix}DROP\\s+(?<masked>MASKD)\\b`, "giu"),
            diagnostics: [{ group: "masked", expected: longAttributeExpectation }],
        },
    ];
    const result: SyntaxDiagnosticReplacement[] = [];
    for (const definition of definitions) {
        for (const match of text.matchAll(definition.pattern)) {
            const diagnostics = definition.diagnostics.flatMap(({ group, expected }) => {
                const value = match.groups?.[group];
                if (!value) return [];
                const relative = match[0].lastIndexOf(value);
                const range = {
                    start: match.index + relative,
                    end: match.index + relative + value.length,
                };
                return [syntaxDiagnosticAt(text, range, expected)];
            });
            if (diagnostics.length === 0) continue;
            result.push({
                diagnostics,
                recoveryRange: {
                    start: diagnostics[0]!.range.start,
                    end: externalModelRecoveryEnd(text, match.index),
                },
            });
        }
    }
    return result;
}

function invalidExternalStreamSyntaxDiagnostics(
    text: string,
): readonly SyntaxDiagnosticReplacement[] {
    if (!/\bCREATE\s+EXTERNAL\s+STREAM\b/iu.test(text)) return [];
    const result: SyntaxDiagnosticReplacement[] = [];
    const statements = text.matchAll(/\bCREATE\s+EXTERNAL\s+STREAM\b[\s\S]*?(?:;|$)/giu);
    for (const statement of statements) {
        const source = statement[0];
        const statementStart = statement.index;
        const replacement = (
            relativeRange: TextRange,
            expected: string,
        ): SyntaxDiagnosticReplacement => ({
            diagnostics: [
                syntaxDiagnosticAt(
                    text,
                    {
                        start: statementStart + relativeRange.start,
                        end: statementStart + relativeRange.end,
                    },
                    expected,
                ),
            ],
            recoveryRange: {
                start: statementStart + relativeRange.start,
                end: statementStart + source.length,
            },
        });
        const empty = /\bWITH\s*\(\s*(\))/iu.exec(source);
        if (empty) {
            const start = empty.index + empty[0].lastIndexOf(empty[1]!);
            result.push(
                replacement(
                    { start, end: start + 1 },
                    "DATA_SOURCE, FILE_FORMAT, INPUT_OPTIONS, LOCATION, or OUTPUT_OPTIONS",
                ),
            );
            continue;
        }
        const missingEveryEqual = /\bWITH\s*\(\s*DATA_SOURCE\s*(,)/iu.exec(source);
        if (missingEveryEqual) {
            const start = missingEveryEqual.index + missingEveryEqual[0].lastIndexOf(",");
            result.push(replacement({ start, end: start + 1 }, "'='"));
            continue;
        }
        const chained = /\bDATA_SOURCE\s*=\s*LOCATION\s*(=)/iu.exec(source);
        if (chained) {
            const start = chained.index + chained[0].lastIndexOf(chained[1]!);
            result.push(replacement({ start, end: start + 1 }, "')', or ','"));
            continue;
        }
        const missingDataSourceEqual = /\bDATA_SOURCE\s+(LOCATION)\s*=/iu.exec(source);
        if (missingDataSourceEqual) {
            const start =
                missingDataSourceEqual.index +
                missingDataSourceEqual[0].lastIndexOf(missingDataSourceEqual[1]!);
            result.push(
                replacement({ start, end: start + missingDataSourceEqual[1]!.length }, "'='"),
            );
            continue;
        }
        const missingComma = /\bOUTPUT_OPTIONS\s*=\s*(?:N)?'(?:''|[^'])*'\s+(DATA_SOURCE)\b/iu.exec(
            source,
        );
        if (missingComma) {
            const start = missingComma.index + missingComma[0].lastIndexOf(missingComma[1]!);
            result.push(
                replacement({ start, end: start + missingComma[1]!.length }, "')', or ','"),
            );
        }
    }
    return result;
}

function invalidBackupStorageRedundancyDiagnostics(
    text: string,
): readonly SyntaxDiagnosticReplacement[] {
    if (!/\bBACKUP_STORAGE_REDUNDANCY\b/iu.test(text)) return [];
    const result: SyntaxDiagnosticReplacement[] = [];
    const identifier = String.raw`(?:\[[^\]]+\]|"(?:""|[^"])+"|[\p{L}_][\p{L}\p{N}_$#@]*)`;
    const definitions: readonly {
        readonly pattern: RegExp;
        readonly diagnostics: readonly { readonly group: string; readonly expected: string }[];
    }[] = [
        {
            pattern: new RegExp(
                String.raw`\bALTER\s+DATABASE\s+${identifier}\s+ADD\s+SECONDARY\s+ON\s+SERVER\s+${identifier}\s+WITH\s*\(\s*(?<option>BACKUP_STORAGE_REDUNDANCY)\b`,
                "giu",
            ),
            diagnostics: [
                {
                    group: "option",
                    expected: "GEODR_CONNOPT, GEODR_REPLACE, or GEODR_SRVOBJ",
                },
            ],
        },
        {
            pattern: new RegExp(
                String.raw`\bCREATE\s+DATABASE\s+${identifier}\s+AS\s+COPY\s+OF\s+${identifier}\s*\.\s*${identifier}\s+WITH\s*(?<open>\()\s*(?<option>BACKUP_STORAGE_REDUNDANCY)\b`,
                "giu",
            ),
            diagnostics: [
                {
                    group: "open",
                    expected: "CHANGE_TRACKING_CONTEXT, ID, QUOTED_ID, or XMLNAMESPACES",
                },
                { group: "option", expected: "'(', or SELECT" },
            ],
        },
        {
            pattern: new RegExp(
                String.raw`\bALTER\s+DATABASE\s+${identifier}\s+MODIFY\s+(?<option>BACKUP_STORAGE_REDUNDANCY)\b`,
                "giu",
            ),
            diagnostics: [{ group: "option", expected: "'(', FILE, filegroup, or name" }],
        },
        {
            pattern: new RegExp(
                String.raw`\bCREATE\s+DATABASE\s+${identifier}\s+WITH\s+(?<option>BACKUP_STORAGE_REDUNDANCY)\b`,
                "giu",
            ),
            diagnostics: [
                {
                    group: "option",
                    expected:
                        "CREATEDBOPT_CATALOGCOLLATION, CREATEDBOPT_FILESTREAM, CREATEDBOPT_LOGAPPLY, CREATEDBOPT_OTHER, or CREATEDBOPT_PERSISTENT_LOG_BUFFER",
                },
            ],
        },
    ];
    for (const definition of definitions) {
        for (const match of text.matchAll(definition.pattern)) {
            const diagnostics = definition.diagnostics.flatMap(({ group, expected }) => {
                const value = match.groups?.[group];
                if (!value) return [];
                const relative = match[0].lastIndexOf(value);
                return [
                    syntaxDiagnosticAt(
                        text,
                        {
                            start: match.index + relative,
                            end: match.index + relative + value.length,
                        },
                        expected,
                    ),
                ];
            });
            result.push({
                diagnostics,
                recoveryRange: {
                    start: match.index,
                    end: nextDatabaseStatementStart(text, match.index + match[0].length),
                },
            });
        }
    }
    return result;
}

function invalidSemanticSearchDiagnostics(text: string): readonly SyntaxDiagnosticReplacement[] {
    if (!/\bSEMANTIC_SEARCH\s*\(/iu.test(text)) return [];
    const result: SyntaxDiagnosticReplacement[] = [];
    for (const call of text.matchAll(/\bSEMANTIC_SEARCH\s*(\()/giu)) {
        const open = call.index + call[0].lastIndexOf(call[1]!);
        const close = matchingCloseParen(text, open);
        const end = close < 0 ? text.length : close + 1;
        const bodyStart = open + 1;
        const body = text.slice(bodyStart, close < 0 ? text.length : close);
        const at = (match: RegExpExecArray, capture: string): TextRange => {
            const value = match.groups?.[capture];
            const relative = value ? match[0].lastIndexOf(value) : -1;
            return {
                start: bodyStart + match.index + Math.max(0, relative),
                end: bodyStart + match.index + Math.max(0, relative) + (value?.length ?? 1),
            };
        };
        const replacement = (
            diagnostics: readonly SyntaxDiagnostic[],
        ): SyntaxDiagnosticReplacement => ({
            diagnostics,
            recoveryRange: {
                start: call.index,
                end: Math.max(end, externalModelRecoveryEnd(text, call.index)),
            },
        });

        const misspelledTable =
            /^\s*TABEL\s*(?<tableEqual>=)[\s\S]*?\bCOLUMN\s*(?<columnEqual>=)[\s\S]*?\bSEARCH_STRING\s*(?<searchEqual>=)/iu.exec(
                body,
            );
        if (misspelledTable) {
            result.push(
                replacement([
                    syntaxDiagnosticAt(text, at(misspelledTable, "tableEqual")),
                    syntaxDiagnosticAt(text, at(misspelledTable, "columnEqual"), "ID"),
                    syntaxDiagnosticAt(text, at(misspelledTable, "searchEqual")),
                ]),
            );
            continue;
        }
        const missingTable =
            /^\s*COLUMN\s*(?<columnEqual>=)[\s\S]*?\bSEARCH_STRING\s*(?<searchEqual>=)/iu.exec(
                body,
            );
        if (missingTable) {
            result.push(
                replacement([
                    syntaxDiagnosticAt(text, at(missingTable, "columnEqual"), "ID"),
                    syntaxDiagnosticAt(text, at(missingTable, "searchEqual")),
                ]),
            );
            continue;
        }
        const wrongOrder =
            /\b(?<search>SEARCH_STRING)\s*=\s*[^,]+,\s*(?<column>COLUMN)\s*=\s*\(\s*(?<columnName>[\p{L}_][\p{L}\p{N}_$#@]*)/iu.exec(
                body,
            );
        if (wrongOrder) {
            result.push(
                replacement([
                    syntaxDiagnosticAt(text, at(wrongOrder, "search"), "COLUMN"),
                    syntaxDiagnosticAt(text, at(wrongOrder, "column")),
                    syntaxDiagnosticAt(text, at(wrongOrder, "columnName"), "'(', or SELECT"),
                ]),
            );
            continue;
        }
        const unclosedColumns = /\bCOLUMN\s*=\s*\([^)]*\bSEARCH_STRING\s*(?<equal>=)/iu.exec(body);
        if (unclosedColumns) {
            result.push(
                replacement([
                    syntaxDiagnosticAt(text, at(unclosedColumns, "equal"), "')', or ','"),
                ]),
            );
            continue;
        }
        const missingColumnParens =
            /\bCOLUMN\s*=\s*(?<columnName>[\p{L}_][\p{L}\p{N}_$#@]*)\s*,[\s\S]*?\bSEARCH_STRING\s*(?<equal>=)/iu.exec(
                body,
            );
        if (missingColumnParens) {
            result.push(
                replacement([
                    syntaxDiagnosticAt(text, at(missingColumnParens, "columnName"), "'('"),
                    syntaxDiagnosticAt(text, at(missingColumnParens, "equal")),
                ]),
            );
            continue;
        }
        const invalidReranker = /\bRERANKER\s*\(\s*(?<value>KTF)\b/iu.exec(body);
        if (invalidReranker) {
            result.push(replacement([syntaxDiagnosticAt(text, at(invalidReranker, "value"))]));
            continue;
        }
        const smoothing = /\b(?<value>SMOTHING_FACTOR)\b/iu.exec(body);
        if (smoothing) {
            result.push(replacement([syntaxDiagnosticAt(text, at(smoothing, "value"))]));
        }
    }
    return result;
}

function invalidAutomaticTuningDiagnostics(text: string): readonly SyntaxDiagnosticReplacement[] {
    if (!/\bAUTOMATIC_TUNING\b/iu.test(text)) return [];
    const result: SyntaxDiagnosticReplacement[] = [];
    const identifier = String.raw`(?:\[[^\]]+\]|"(?:""|[^"])+"|[\p{L}_][\p{L}\p{N}_$#@]*)`;
    const definitions: readonly {
        readonly pattern: RegExp;
        readonly diagnostics: readonly { readonly group: string; readonly expected?: string }[];
    }[] = [
        {
            pattern: new RegExp(
                String.raw`\bALTER\s+DATABASE\s+${identifier}\s+SET\s+AUTOMATIC_TUNING\s*=\s*(?<value>OFF)\b[^;]*(?:;|$)`,
                "giu",
            ),
            diagnostics: [{ group: "value", expected: "auto, custom, or inherit" }],
        },
        {
            pattern: new RegExp(
                String.raw`\bALTER\s+DATABASE\s+${identifier}\s+SET\s+AUTOMATIC_TUNING\s*(?<end>;|$)`,
                "giu",
            ),
            diagnostics: [{ group: "end", expected: "'(', or '='" }],
        },
        {
            pattern: new RegExp(
                String.raw`\bALTER\s+DATABASE\s+${identifier}\s+SET\s+AUTOMATIC_TUNING\s+(?<option>FORCE_LAST_GOOD_PLAN)\s*=\s*(?:ON|OFF)[^;]*(?:;|$)`,
                "giu",
            ),
            diagnostics: [{ group: "option", expected: "'(', or '='" }],
        },
        {
            pattern: new RegExp(
                String.raw`\bALTER\s+DATABASE\s+${identifier}\s+SET\s+AUTOMATIC_TUNING\s*\(\s*FORCE_LAST_GOOD_PLAN\s*(?<close>\))[^;]*(?:;|$)`,
                "giu",
            ),
            diagnostics: [{ group: "close", expected: "'='" }],
        },
        {
            pattern:
                /\bALTER\s+DATABASE\s+(?<set>SET)\s+AUTOMATIC_TUNING\s*(?<equal>=)\s*(?:AUTO|CUSTOM|INHERIT)[^;]*(?:;|$)/giu,
            diagnostics: [{ group: "set" }, { group: "equal" }],
        },
        {
            pattern:
                /\bALTER\s+DATABASE\s+(?<set>SET)\s+AUTOMATIC_TUNING\s*(?<open>\()\s*(?<option>FORCE_LAST_GOOD_PLAN)\s*=\s*(?:ON|OFF)[^;]*(?:;|$)/giu,
            diagnostics: [
                { group: "set" },
                { group: "open" },
                { group: "option", expected: "'(', or SELECT" },
            ],
        },
    ];
    for (const definition of definitions) {
        for (const match of text.matchAll(definition.pattern)) {
            const diagnostics = definition.diagnostics.flatMap(({ group, expected }) => {
                const value = match.groups?.[group];
                if (value === undefined) return [];
                const relative = match[0].indexOf(value);
                return [
                    syntaxDiagnosticAt(
                        text,
                        {
                            start: match.index + relative,
                            end: match.index + relative + value.length,
                        },
                        expected,
                    ),
                ];
            });
            result.push({
                diagnostics,
                recoveryRange: { start: match.index, end: match.index + match[0].length },
            });
        }
    }
    return result;
}

function invalidDataDeletionDiagnostics(text: string): readonly SyntaxDiagnosticReplacement[] {
    if (!/\bDATA_DELETION\b/iu.test(text)) return [];
    const result: SyntaxDiagnosticReplacement[] = [];
    const statements =
        /\b(?:CREATE|ALTER)\s+TABLE\b[^;]*?\bDATA_DELETION\s*=\s*(?<state>ON|OFF)\b/giu;
    const optionExpectation =
        "TABOPTNAME_DATA_DELETION, TABOPTNAME_FILESTREAM_ON, TABOPTNAME_FILETABLE_DIRECTORY, TABOPTNAME_LOCK_ESCALATION, TABOPTNAME_REMOTE_DATA_ARCHIVE, or TABOPTNAME_SYSTEM_VERSIONING";
    const valueToken = /^(?:N?'(?:''|[^'])*'|-|\d+(?:\.\d+)?|[\p{L}_][\p{L}\p{N}_$#@]*)/iu;
    for (const statement of text.matchAll(statements)) {
        const state = statement.groups?.state;
        if (!state) continue;
        const stateStart = statement.index + statement[0].lastIndexOf(state);
        const open =
            stateStart +
            state.length +
            /^\s*/u.exec(text.slice(stateStart + state.length))![0].length;
        if (text[open] !== "(") continue;
        const close = matchingCloseParen(text, open);
        if (close < 0) continue;
        const bodyStart = open + 1;
        const body = text.slice(bodyStart, close);
        const diagnostics: SyntaxDiagnostic[] = [];
        if (state.toUpperCase() === "OFF") {
            diagnostics.push(
                syntaxDiagnosticAt(text, { start: open, end: open + 1 }, "')', or ','"),
            );
            const firstOption = /[\p{L}_][\p{L}\p{N}_$#@]*/u.exec(body);
            if (firstOption) {
                const start = bodyStart + firstOption.index;
                diagnostics.push(
                    syntaxDiagnosticAt(
                        text,
                        { start, end: start + firstOption[0].length },
                        "'(', or SELECT",
                    ),
                );
            }
        } else {
            const options = [...body.matchAll(/\b(?<name>FILTER_COLUMN|RETENTION_PERIOD)\s*=/giu)];
            const seen = new Set<string>();
            for (const option of options) {
                const name = option.groups!.name!;
                const normalized = name.toUpperCase();
                if (seen.has(normalized)) {
                    const comma = body.lastIndexOf(",", option.index);
                    if (comma >= 0) {
                        diagnostics.push(
                            syntaxDiagnosticAt(
                                text,
                                { start: bodyStart + comma, end: bodyStart + comma + 1 },
                                "')'",
                            ),
                        );
                    }
                    const start = bodyStart + option.index;
                    diagnostics.push(
                        syntaxDiagnosticAt(
                            text,
                            { start, end: start + name.length },
                            optionExpectation,
                        ),
                    );
                    break;
                }
                seen.add(normalized);
            }

            const retention = options.find(
                (option) => option.groups!.name!.toUpperCase() === "RETENTION_PERIOD",
            );
            if (retention) {
                const equals = retention[0].lastIndexOf("=");
                const valueStart = bodyStart + retention.index + equals + 1;
                const valueEndRelative = body.indexOf(",", retention.index + retention[0].length);
                const valueEnd = valueEndRelative < 0 ? close : bodyStart + valueEndRelative;
                const leading = /^\s*/u.exec(text.slice(valueStart, valueEnd))![0].length;
                const candidateStart = valueStart + leading;
                const candidate = text.slice(candidateStart, valueEnd).trimEnd();
                const valid =
                    /^INFINITE$/iu.test(candidate) ||
                    /^\d+(?:\.\d+)?\s+(?:SECOND|MINUTE|HOUR|DAY|WEEK|MONTH|YEAR)S?$/iu.test(
                        candidate,
                    );
                if (!valid && candidate.length > 0) {
                    const token = valueToken.exec(candidate)?.[0];
                    if (token) {
                        const number = /^\d+(?:\.\d+)?$/u.exec(token);
                        if (number) {
                            const remainderStart =
                                candidateStart +
                                token.length +
                                /^\s*/u.exec(candidate.slice(token.length))![0].length;
                            const remainder = valueToken.exec(
                                text.slice(remainderStart, valueEnd),
                            )?.[0];
                            if (remainder) {
                                diagnostics.push(
                                    syntaxDiagnosticAt(text, {
                                        start: remainderStart,
                                        end: remainderStart + remainder.length,
                                    }),
                                );
                            }
                        } else {
                            diagnostics.push(
                                syntaxDiagnosticAt(
                                    text,
                                    {
                                        start: candidateStart,
                                        end: candidateStart + token.length,
                                    },
                                    "INFINITE, INTEGER, or NUMERIC",
                                ),
                            );
                        }
                    }
                }
            }
            if (!seen.has("FILTER_COLUMN") && seen.has("RETENTION_PERIOD")) {
                diagnostics.push(syntaxDiagnosticAt(text, { start: close, end: close + 1 }, "','"));
            }
        }
        if (diagnostics.length > 0) {
            result.push({
                diagnostics,
                recoveryRange: { start: statement.index, end: close + 1 },
            });
        }
    }
    return result;
}

function invalidColumnEncryptionDiagnostics(text: string): readonly SyntaxDiagnosticReplacement[] {
    if (!/\b(?:ENCRYPTED|NCRYPTED)\b/iu.test(text)) return [];
    const result: SyntaxDiagnosticReplacement[] = [];
    const add = (
        match: RegExpMatchArray,
        definitions: readonly { readonly group: string; readonly expected?: string }[],
    ): void => {
        const diagnostics = definitions.flatMap(({ group, expected }) => {
            const value = match.groups?.[group];
            if (!value) return [];
            const relative = match[0].lastIndexOf(value);
            return [
                syntaxDiagnosticAt(
                    text,
                    {
                        start: match.index! + relative,
                        end: match.index! + relative + value.length,
                    },
                    expected,
                ),
            ];
        });
        if (diagnostics.length > 0) {
            result.push({
                diagnostics,
                recoveryRange: {
                    start: match.index!,
                    end: externalModelRecoveryEnd(text, match.index!),
                },
            });
        }
    };

    const clause = /\bENCRYPTED\s+WITH\s*\((?<body>[\s\S]*?)\)/giu;
    for (const match of text.matchAll(clause)) {
        const body = match.groups!.body!;
        const bodyStart = match.index + match[0].indexOf(body);
        const invalid: SyntaxDiagnostic[] = [];
        const at = (item: RegExpExecArray, capture: string, expected?: string): void => {
            const value = item.groups?.[capture];
            if (!value) return;
            const relative = item[0].lastIndexOf(value);
            invalid.push(
                syntaxDiagnosticAt(
                    text,
                    {
                        start: bodyStart + item.index + relative,
                        end: bodyStart + item.index + relative + value.length,
                    },
                    expected,
                ),
            );
        };
        const missingComma =
            /\bENCRYPTION_TYPE\s*=\s*[\p{L}_][\p{L}\p{N}_$#@]*\s+(?<algorithm>ALGORITHM)\s*=/iu.exec(
                body,
            );
        const keyString = /\bCOLUMN_ENCRYPTION_KEY\s*=\s*(?<value>(?:N)?'(?:''|[^'])+')/iu.exec(
            body,
        );
        const typeString = /\bENCRYPTION_TYPE\s*=\s*(?<value>(?:N)?'(?:''|[^'])+')/iu.exec(body);
        const algorithmIdentifier = /\bALGORITHM\s*=\s*(?<value>[\p{L}_][\p{L}\p{N}_$#@]*)/iu.exec(
            body,
        );
        const splitType = /\b(?<value>ENCRYPTION)\s+TYPE\s*=/iu.exec(body);
        if (missingComma) at(missingComma, "algorithm", "')', or ','");
        else if (keyString) at(keyString, "value", "ID, or QUOTED_ID");
        else if (typeString) at(typeString, "value", "ID");
        else if (algorithmIdentifier) {
            at(algorithmIdentifier, "value", "STRING, or TEXT_LEX");
        } else if (splitType) {
            at(
                splitType,
                "value",
                "CEMK_ALGORITHM, CEMK_COL_ENCRYPTION_KEY, or CEMK_ENCRYPTION_TYPE",
            );
        }
        if (invalid.length > 0) {
            result.push({
                diagnostics: invalid,
                recoveryRange: { start: match.index, end: match.index + match[0].length },
            });
        }
    }

    const missingColumnComma =
        /\)\s*(?<column>[\p{L}_][\p{L}\p{N}_$#@]*)\s+[\p{L}_][\p{L}\p{N}_$#@]*(?:\s*\([^)]*\))?\s+ENCRYPTED\s+WITH\s*(?<open>\()\s*(?<option>COLUMN_ENCRYPTION_KEY)\b/giu;
    for (const match of text.matchAll(missingColumnComma)) {
        add(match, [
            { group: "column" },
            {
                group: "open",
                expected: "CHANGE_TRACKING_CONTEXT, ID, QUOTED_ID, or XMLNAMESPACES",
            },
            { group: "option", expected: "'(', or SELECT" },
        ]);
    }

    const malformedClauses: readonly {
        readonly pattern: RegExp;
        readonly diagnostics: readonly { readonly group: string; readonly expected?: string }[];
    }[] = [
        {
            pattern: /\bENCRYPTED\s+WITH\s+(?<option>COLUMN_ENCRYPTION_KEY)\s*=/giu,
            diagnostics: [{ group: "option", expected: "'('" }],
        },
        {
            pattern:
                /\b(?<encrypted>NCRYPTED)\s+WITH\s*(?<open>\()\s*(?<option>COLUMN_ENCRYPTION_KEY)\b/giu,
            diagnostics: [
                { group: "encrypted" },
                {
                    group: "open",
                    expected: "CHANGE_TRACKING_CONTEXT, ID, QUOTED_ID, or XMLNAMESPACES",
                },
                { group: "option", expected: "'(', or SELECT" },
            ],
        },
        {
            pattern: /\bENCRYPTED\s*(?<open>\()\s*(?<option>COLUMN_ENCRYPTION_KEY)\b/giu,
            diagnostics: [
                { group: "open", expected: "WITH" },
                { group: "option", expected: "'(', or SELECT" },
            ],
        },
        {
            pattern:
                /\bENCRYPTED\s+(?<with>WIT)\s*(?<open>\()\s*(?<option>COLUMN_ENCRYPTION_KEY)\b/giu,
            diagnostics: [
                { group: "with", expected: "WITH" },
                { group: "option", expected: "'(', or SELECT" },
            ],
        },
    ];
    for (const definition of malformedClauses) {
        for (const match of text.matchAll(definition.pattern)) add(match, definition.diagnostics);
    }
    return result;
}

function invalidCreateColumnMaskingDiagnostics(
    text: string,
): readonly SyntaxDiagnosticReplacement[] {
    if (!/\bCREATE\s+TABLE\b[^;]*\bMASK(?:ED|D)\b/iu.test(text)) return [];
    const result: SyntaxDiagnosticReplacement[] = [];
    const definitions: readonly {
        readonly pattern: RegExp;
        readonly diagnostics: readonly { readonly group: string; readonly expected?: string }[];
    }[] = [
        {
            pattern: /\bMASKED\s+(?<with>WTH)\s*\(\s*(?<function>FUNCTION)\b/giu,
            diagnostics: [
                { group: "with", expected: "WITH" },
                { group: "function", expected: "'(', or SELECT" },
            ],
        },
        {
            pattern: /\bMASKED\s+WITH\s*\(\s*(?<function>FNCTION)\b/giu,
            diagnostics: [{ group: "function", expected: "FUNCTION" }],
        },
        {
            pattern:
                /\)\s*(?<column>[\p{L}_][\p{L}\p{N}_$#@]*)\s+[\p{L}_][\p{L}\p{N}_$#@]*\s*\(\s*(?<size>\d+)\s*\)\s+MASKED\s+WITH\s*(?<open>\()\s*(?<function>FUNCTION)\b/giu,
            diagnostics: [
                { group: "column" },
                { group: "size", expected: "'(', or SELECT" },
                {
                    group: "open",
                    expected: "CHANGE_TRACKING_CONTEXT, ID, QUOTED_ID, or XMLNAMESPACES",
                },
                { group: "function", expected: "'(', or SELECT" },
            ],
        },
        {
            pattern:
                /\bNOT\s+NULL\s+(?<masked>MASKED)\s+WITH\s*(?<open>\()\s*(?<function>FUNCTION)\b/giu,
            diagnostics: [
                { group: "masked" },
                {
                    group: "open",
                    expected: "CHANGE_TRACKING_CONTEXT, ID, QUOTED_ID, or XMLNAMESPACES",
                },
                { group: "function", expected: "'(', or SELECT" },
            ],
        },
        {
            pattern: /\bMASKED\s*(?<open>\()\s*(?<function>FUNCTION)\b/giu,
            diagnostics: [
                { group: "open", expected: "WITH" },
                { group: "function", expected: "'(', or SELECT" },
            ],
        },
        {
            pattern: /\b(?<masked>MASKD)\s+WITH\s*(?<open>\()\s*(?<function>FUNCTION)\b/giu,
            diagnostics: [
                { group: "masked" },
                {
                    group: "open",
                    expected: "CHANGE_TRACKING_CONTEXT, ID, QUOTED_ID, or XMLNAMESPACES",
                },
                { group: "function", expected: "'(', or SELECT" },
            ],
        },
        {
            pattern: /\bMASKED\s+WITH\s+(?<function>FUNCTION)\s*=/giu,
            diagnostics: [{ group: "function", expected: "'('" }],
        },
        {
            pattern: /\bMASKED\s+WITH\s*\(\s*FUNCTION\s+(?<value>(?:N)?'(?:''|[^'])+')/giu,
            diagnostics: [{ group: "value", expected: "'='" }],
        },
        {
            pattern:
                /\bMASKED\s+WITH\s*\(\s*FUNCTION\s*=\s*(?<value>[\p{L}_][\p{L}\p{N}_$#@]*)\s*\(\s*(?<close>\))/giu,
            diagnostics: [
                { group: "value", expected: "STRING" },
                { group: "close", expected: "'(', or SELECT" },
            ],
        },
        {
            pattern: /\bMASKED\s+WITH\s*\(\s*(?<value>(?:N)?'(?:''|[^'])+')/giu,
            diagnostics: [{ group: "value", expected: "FUNCTION" }],
        },
    ];
    for (const definition of definitions) {
        for (const match of text.matchAll(definition.pattern)) {
            const diagnostics = definition.diagnostics.flatMap(({ group, expected }) => {
                const value = match.groups?.[group];
                if (!value) return [];
                const relative = match[0].lastIndexOf(value);
                return [
                    syntaxDiagnosticAt(
                        text,
                        {
                            start: match.index + relative,
                            end: match.index + relative + value.length,
                        },
                        expected,
                    ),
                ];
            });
            if (diagnostics.length > 0) {
                result.push({
                    diagnostics,
                    recoveryRange: {
                        start: match.index,
                        end: externalModelRecoveryEnd(text, match.index),
                    },
                });
            }
        }
    }
    return result;
}

function invalidColumnEncryptionKeyDiagnostics(
    text: string,
): readonly SyntaxDiagnosticReplacement[] {
    if (!/\bCREATE\s+COLUMN\s+ENCRYPTION\s+KEY\b/iu.test(text)) return [];
    const result: SyntaxDiagnosticReplacement[] = [];
    const definitions: readonly {
        readonly pattern: RegExp;
        readonly diagnostics: readonly { readonly group: string; readonly expected?: string }[];
    }[] = [
        {
            pattern: /\bWITH\s+VALUES\s*\([^)]*\)\s*(?<open>\()\s*(?<option>ALGORITHM)\b/giu,
            diagnostics: [{ group: "option", expected: "'(', or SELECT" }],
        },
        {
            pattern: /\bWITH\s+VALUES\s*\([^)]*\)\s*,\s*\([^)]*\)\s*(?<comma>,)\s*(?:;|$)/giu,
            diagnostics: [{ group: "comma" }],
        },
        {
            pattern: /\bWITH\s+VALUES\s+(?<option>ALGORITHM)\s*=/giu,
            diagnostics: [{ group: "option", expected: "'('" }],
        },
        {
            pattern: /\bWITH\s+(?<value>VALUE)\s*(?<open>\()\s*(?<option>ALGORITHM)\b/giu,
            diagnostics: [
                { group: "value", expected: "VALUES" },
                { group: "option", expected: "'(', or SELECT" },
            ],
        },
        {
            pattern:
                /\bWITH\s+VALUES\s*\([^)]*\bALGORITHM\s*=\s*(?<value>[\p{L}_][\p{L}\p{N}_$#@]*)/giu,
            diagnostics: [{ group: "value", expected: "STRING, or TEXT_LEX" }],
        },
        {
            pattern:
                /\bWITH\s+VALUES\s*\([^)]*\bCOLUMN_MASTER_KEY\s*=\s*(?<value>(?:N)?'(?:''|[^'])+')/giu,
            diagnostics: [{ group: "value", expected: "ID, or QUOTED_ID" }],
        },
        {
            pattern:
                /\bWITH\s+VALUES\s*\([^)]*\bALGORITHM\s*=\s*(?:N)?'(?:''|[^'])*'\s+(?<option>ENCRYPTED_VALUE)\s*=/giu,
            diagnostics: [{ group: "option", expected: "')', or ','" }],
        },
        {
            pattern:
                /\bWITH\s+VALUES\s*\([^)]*\bENCRYPTED_VALUE\s*=\s*(?<value>(?:N)?'(?:''|[^'])+')/giu,
            diagnostics: [{ group: "value", expected: "BINARY" }],
        },
    ];
    for (const definition of definitions) {
        for (const match of text.matchAll(definition.pattern)) {
            const diagnostics = definition.diagnostics.flatMap(({ group, expected }) => {
                const value = match.groups?.[group];
                if (!value) return [];
                const relative = match[0].lastIndexOf(value);
                return [
                    syntaxDiagnosticAt(
                        text,
                        {
                            start: match.index + relative,
                            end: match.index + relative + value.length,
                        },
                        expected,
                    ),
                ];
            });
            if (diagnostics.length > 0) {
                result.push({
                    diagnostics,
                    recoveryRange: {
                        start: match.index,
                        end: externalModelRecoveryEnd(text, match.index),
                    },
                });
            }
        }
    }
    return result;
}

function invalidSensitivityClassificationDiagnostics(
    text: string,
): readonly SyntaxDiagnosticReplacement[] {
    if (!/\bSENSITIVITY\b/iu.test(text)) return [];
    const result: SyntaxDiagnosticReplacement[] = [];
    const definitions: readonly {
        readonly pattern: RegExp;
        readonly diagnostics: readonly { readonly group: string; readonly expected: string }[];
    }[] = [
        {
            pattern:
                /\bADD\s+SENSITIVITY\s+(?<near>TO)\b[^;]*?\bWITH\s*(?<open>\()\s*(?<option>LABEL)\b/giu,
            diagnostics: [
                { group: "near", expected: "ADD_CLASSIFICATION" },
                {
                    group: "open",
                    expected: "CHANGE_TRACKING_CONTEXT, ID, QUOTED_ID, or XMLNAMESPACES",
                },
                { group: "option", expected: "'(', or SELECT" },
            ],
        },
        {
            pattern:
                /\bADD\s+SENSITIVITY\s+CLASSIFICATION\s+(?<near>[\p{L}_][\p{L}\p{N}_$#@]*)\s*\.[^;]*?\bWITH\s*(?<open>\()\s*(?<option>LABEL)\b/giu,
            diagnostics: [
                { group: "near", expected: "TO" },
                {
                    group: "open",
                    expected: "CHANGE_TRACKING_CONTEXT, ID, QUOTED_ID, or XMLNAMESPACES",
                },
                { group: "option", expected: "'(', or SELECT" },
            ],
        },
        {
            pattern:
                /\bADD\s+SENSITIVITY\s+CLASSIFICATION\s+TO\s+(?:[\p{L}_][\p{L}\p{N}_$#@]*\s*\.\s*){1,2}[\p{L}_][\p{L}\p{N}_$#@]*\s*(?<open>\()\s*(?<option>LABEL)\b/giu,
            diagnostics: [
                { group: "open", expected: "',', or WITH" },
                { group: "option", expected: "'(', or SELECT" },
            ],
        },
        {
            pattern:
                /\bADD\s+SENSITIVITY\s+CLASSIFICATION\s+TO\b[^;]*?\bRANK\s*=\s*(?<close>\))/giu,
            diagnostics: [{ group: "close", expected: "ID, or STRING" }],
        },
        {
            pattern:
                /\bDROP\s+SENSITIVITY\s+CLASSIFICATION\s+FROM\s+[\p{L}_][\p{L}\p{N}_$#@]*\s*\.\s*(?<star>\*)/giu,
            diagnostics: [{ group: "star", expected: "'.', ID, or QUOTED_ID" }],
        },
        {
            pattern: /\bDROP\s+SENSITIVITY\s+(?<from>FROM)\b/giu,
            diagnostics: [{ group: "from", expected: "CLASSIFICATION" }],
        },
        {
            pattern:
                /\bDROP\s+SENSITIVITY\s+CLASSIFICATION\s+(?<name>[\p{L}_][\p{L}\p{N}_$#@]*)\s*\./giu,
            diagnostics: [{ group: "name", expected: "FROM" }],
        },
    ];
    for (const definition of definitions) {
        for (const match of text.matchAll(definition.pattern)) {
            const diagnostics = definition.diagnostics.flatMap(({ group, expected }) => {
                const value = match.groups?.[group];
                if (value === undefined) return [];
                const relative = match[0].lastIndexOf(value);
                return [
                    syntaxDiagnosticAt(
                        text,
                        {
                            start: match.index + relative,
                            end: match.index + relative + value.length,
                        },
                        expected,
                    ),
                ];
            });
            if (diagnostics.length > 0) {
                result.push({
                    diagnostics,
                    recoveryRange: {
                        start: match.index,
                        end: externalModelRecoveryEnd(text, match.index),
                    },
                });
            }
        }
    }
    const missingDropTarget = /\bDROP\s+SENSITIVITY\s+CLASSIFICATION\s+FROM\s*$/giu.exec(text);
    if (missingDropTarget) {
        result.push({
            diagnostics: [
                syntaxDiagnosticAt(
                    text,
                    { start: text.length, end: text.length },
                    "'.', ID, or QUOTED_ID",
                ),
            ],
            recoveryRange: { start: missingDropTarget.index, end: text.length },
        });
    }
    return result;
}

function invalidBareClassificationDiagnostics(
    text: string,
): readonly SyntaxDiagnosticReplacement[] {
    const result: SyntaxDiagnosticReplacement[] = [];
    for (const match of text.matchAll(
        /\bADD\s+(?<classification>CLASSIFICATION)\s+TO\b[^;]*?\bWITH\s*(?<open>\()\s*(?<option>LABEL)\b[^;]*(?:;|$)/giu,
    )) {
        const classification = match.groups!.classification!;
        const open = match.groups!.open!;
        const option = match.groups!.option!;
        const classificationStart = match.index + match[0].indexOf(classification);
        const openStart = match.index + match[0].indexOf(open, classificationStart - match.index);
        const optionStart = match.index + match[0].indexOf(option, openStart - match.index);
        result.push({
            diagnostics: [
                syntaxDiagnosticAt(
                    text,
                    {
                        start: classificationStart,
                        end: classificationStart + classification.length,
                    },
                    "ADD_COUNTER, ADD_SENSITIVITY, or ADD_SIGNATURE",
                ),
                syntaxDiagnosticAt(
                    text,
                    { start: openStart, end: openStart + open.length },
                    "CHANGE_TRACKING_CONTEXT, ID, QUOTED_ID, or XMLNAMESPACES",
                ),
                syntaxDiagnosticAt(
                    text,
                    { start: optionStart, end: optionStart + option.length },
                    "'(', or SELECT",
                ),
            ],
            recoveryRange: { start: match.index, end: match.index + match[0].length },
        });
    }
    for (const match of text.matchAll(
        /\bDROP\s+(?<classification>CLASSIFICATION)\s+FROM\b[^;]*(?:;|$)/giu,
    )) {
        const classification = match.groups!.classification!;
        const start = match.index + match[0].indexOf(classification);
        result.push({
            diagnostics: [syntaxDiagnosticAt(text, { start, end: start + classification.length })],
            recoveryRange: { start: match.index, end: match.index + match[0].length },
        });
    }
    return result;
}

function invalidBooleanDatabaseOptionDiagnostics(
    text: string,
): readonly SyntaxDiagnosticReplacement[] {
    const optionPattern =
        "(?:AUTOMATIC_INDEX_COMPACTION|OPTIMIZED_LOCKING|ACCELERATED_DATABASE_RECOVERY)";
    if (!new RegExp(`\\b${optionPattern}\\b`, "iu").test(text)) return [];
    const result: SyntaxDiagnosticReplacement[] = [];
    const statement = new RegExp(
        String.raw`\bALTER\s+DATABASE\s+(?:\[[^\]]+\]|"(?:""|[^"])+"|[\p{L}_][\p{L}\p{N}_$#@]*)\s+SET\s+(?<option>${optionPattern})(?<tail>[^;]*)(?<end>;|$)`,
        "giu",
    );
    for (const match of text.matchAll(statement)) {
        const tail = match.groups!.tail!;
        const tailStart =
            match.index + match[0].indexOf(tail, match[0].indexOf(match.groups!.option!));
        const diagnostics: SyntaxDiagnostic[] = [];
        const missingEqual = /^\s*(?<state>ON|OFF)\b/iu.exec(tail);
        if (missingEqual) {
            const state = missingEqual.groups!.state!;
            const stateStart = tailStart + missingEqual[0].lastIndexOf(state);
            diagnostics.push(
                syntaxDiagnosticAt(
                    text,
                    { start: stateStart, end: stateStart + state.length },
                    "'='",
                ),
            );
            const nested = /^\s*ON\s*\(\s*(?<option>PERSISTENT_VERSION_STORE_FILEGROUP)\b/iu.exec(
                tail,
            );
            if (nested) {
                const option = nested.groups!.option!;
                const start = tailStart + nested[0].lastIndexOf(option);
                diagnostics.push(
                    syntaxDiagnosticAt(
                        text,
                        { start, end: start + option.length },
                        "'(', or SELECT",
                    ),
                );
            }
        } else if (/^\s*$/u.test(tail)) {
            const end = match.groups!.end!;
            const start = match.index + match[0].length - end.length;
            diagnostics.push(syntaxDiagnosticAt(text, { start, end: start + end.length }, "'='"));
        } else {
            const missingOpen =
                /^\s*=\s*ON\s+(?<option>PERSISTENT_VERSION_STORE_FILEGROUP)\b/iu.exec(tail);
            if (missingOpen) {
                const option = missingOpen.groups!.option!;
                const start = tailStart + missingOpen[0].lastIndexOf(option);
                diagnostics.push(syntaxDiagnosticAt(text, { start, end: start + option.length }));
            }
        }
        if (diagnostics.length > 0) {
            result.push({
                diagnostics,
                recoveryRange: { start: match.index, end: match.index + match[0].length },
            });
        }
    }
    return result;
}

function invalidSecondaryQueryStoreDiagnostics(
    text: string,
): readonly SyntaxDiagnosticReplacement[] {
    if (!/\bALTER\s+DATABASE\s+CURRENT\s+FOR\s+SECOND/iu.test(text)) return [];
    const result: SyntaxDiagnosticReplacement[] = [];
    const secondary =
        /\bALTER\s+DATABASE\s+CURRENT\s+FOR\s+SECONDARY\s+SET\s+QUERY_STORE\b(?<tail>[^;]*)(?:;|$)/giu;
    const unsupported = new Set([
        "CLEANUP_POLICY",
        "SIZE_BASED_CLEANUP_MODE",
        "MAX_STORAGE_SIZE_MB",
        "FLUSH_INTERVAL_SECONDS",
        "DATA_FLUSH_INTERVAL_SECONDS",
        "INTERVAL_LENGTH_MINUTES",
    ]);
    for (const match of text.matchAll(secondary)) {
        const tail = match.groups!.tail!;
        const tailStart = match.index + match[0].indexOf(tail);
        const diagnostics: SyntaxDiagnostic[] = [];
        const misspelledClear = /\bCLEER\b/giu.exec(tail);
        if (misspelledClear) {
            const start = tailStart + misspelledClear.index;
            const diagnostic = syntaxDiagnosticAt(text, {
                start,
                end: start + misspelledClear[0].length,
            });
            diagnostics.push(diagnostic, { ...diagnostic, range: { ...diagnostic.range } });
        } else {
            for (const option of tail.matchAll(/\b[\p{L}_][\p{L}\p{N}_$#@]*(?=\s*=)/giu)) {
                if (!unsupported.has(option[0].toUpperCase())) continue;
                const start = tailStart + option.index;
                diagnostics.push(
                    syntaxDiagnosticAt(text, { start, end: start + option[0].length }),
                );
            }
        }
        if (diagnostics.length > 0) {
            result.push({
                diagnostics,
                recoveryRange: { start: match.index, end: match.index + match[0].length },
            });
        }
    }
    for (const match of text.matchAll(
        /\bALTER\s+DATABASE\s+CURRENT\s+FOR\s+(?<secondary>SECONDAARY)\s+SET\s+QUERY_STORE\b[^;]*(?:;|$)/giu,
    )) {
        const near = match.groups!.secondary!;
        const start = match.index + match[0].indexOf(near);
        result.push({
            diagnostics: [syntaxDiagnosticAt(text, { start, end: start + near.length })],
            recoveryRange: { start: match.index, end: match.index + match[0].length },
        });
    }
    return result;
}

function invalidIncompleteTryCatchDiagnostics(
    text: string,
): readonly SyntaxDiagnosticReplacement[] {
    if (!/\b(?:BEGIN|END)\s+(?:TRY|CATCH)\b/iu.test(text)) return [];
    const source = text.trim();
    const sourceStart = text.indexOf(source);
    const replacement = (
        diagnostics: readonly SyntaxDiagnostic[],
    ): readonly SyntaxDiagnosticReplacement[] => [
        {
            diagnostics,
            recoveryRange: { start: sourceStart, end: sourceStart + source.length },
        },
    ];
    const word = (value: string, occurrence = 0): TextRange => {
        const pattern = new RegExp(`\\b${value.replace(" ", "\\s+")}\\b`, "giu");
        let match: RegExpExecArray | null = null;
        for (let index = 0; index <= occurrence; index++) match = pattern.exec(source);
        const start = sourceStart + (match?.index ?? source.length);
        return { start, end: start + (match?.[0].length ?? 0) };
    };
    const fixed = (range: TextRange, near: string, expected?: string): SyntaxDiagnostic => ({
        code: "syntax",
        message: `Incorrect syntax near '${near}'.${expected ? `  Expecting ${expected}.` : ""}`,
        severity: "error",
        range,
    });

    if (/^BEGIN\s+TRY\s+END\s+TRY\s+BEGIN\s+CATCH\s+END\s+CATCH$/iu.test(source)) {
        return replacement([fixed(word("TRY", 1), "TRY", "CONVERSATION")]);
    }
    if (/^BEGIN\s+TRY\s+END\s+TRY$/iu.test(source)) {
        return replacement([
            fixed(word("TRY", 1), "TRY", "CONVERSATION"),
            syntaxDiagnosticAt(text, { start: text.length, end: text.length }, "BEGIN_CATCH"),
        ]);
    }
    if (/^BEGIN\s+CATCH\s+END\s+CATCH$/iu.test(source)) {
        return replacement([
            fixed(word("BEGIN CATCH"), "BEGIN CATCH"),
            fixed(word("CATCH", 1), "CATCH", "CONVERSATION"),
        ]);
    }
    if (/^END\s+TRY$/iu.test(source)) {
        return replacement([fixed(word("TRY"), "TRY", "CONVERSATION")]);
    }
    if (/^BEGIN\s+CATCH$/iu.test(source)) {
        return replacement([fixed(word("BEGIN CATCH"), "BEGIN CATCH")]);
    }
    if (/^END\s+CATCH$/iu.test(source)) {
        return replacement([fixed(word("CATCH"), "CATCH", "CONVERSATION")]);
    }
    const displacedCatch =
        /^BEGIN\s+TRY\s+SELECT\s+1\s+END\s+TRY\s+(?<select>SELECT)\s+1\s+(?<catch>BEGIN\s+CATCH)\s+END\s+CATCH$/iu.exec(
            source,
        );
    if (displacedCatch) {
        const selectStart =
            sourceStart +
            displacedCatch.index +
            displacedCatch[0].indexOf(displacedCatch.groups!.select!);
        const catchStart =
            sourceStart +
            displacedCatch.index +
            displacedCatch[0].indexOf(displacedCatch.groups!.catch!, selectStart - sourceStart);
        return replacement([
            fixed(
                { start: selectStart, end: selectStart + displacedCatch.groups!.select!.length },
                "SELECT",
                "BEGIN_CATCH",
            ),
            fixed(
                { start: catchStart, end: catchStart + displacedCatch.groups!.catch!.length },
                "BEGIN CATCH",
            ),
        ]);
    }
    const eof = (expected?: string): SyntaxDiagnostic =>
        syntaxDiagnosticAt(text, { start: text.length, end: text.length }, expected);
    if (
        /^BEGIN\s+TRY\s+END\s+TRY\s+BEGIN\s+CATCH\s+BEGIN\s+CATCH\s+END\s+TRY\s+END\s+CATCH$/iu.test(
            source,
        )
    ) {
        return replacement([
            fixed(word("TRY", 1), "TRY", "CONVERSATION"),
            fixed(word("BEGIN CATCH", 1), "BEGIN CATCH"),
            fixed(word("TRY", 2), "TRY", "CATCH"),
            fixed(word("CATCH", 2), "CATCH", "CONVERSATION"),
        ]);
    }
    if (
        /^BEGIN\s+TRY\s+BEGIN\s+TRY\s+END\s+TRY\s+END\s+TRY\s+BEGIN\s+CATCH\s+END\s+CATCH$/iu.test(
            source,
        )
    ) {
        return replacement([
            fixed(word("TRY", 2), "TRY", "CONVERSATION"),
            fixed(word("END", 1), "END", "BEGIN_CATCH"),
            fixed(word("TRY", 3), "TRY", "CATCH"),
        ]);
    }
    if (
        /^BEGIN\s+TRY\s+BEGIN\s+CATCH\s+END\s+CATCH\s+END\s+TRY\s+BEGIN\s+CATCH\s+END\s+CATCH$/iu.test(
            source,
        )
    ) {
        return replacement([
            fixed(word("BEGIN CATCH", 0), "BEGIN CATCH"),
            fixed(word("CATCH", 1), "CATCH", "TRY"),
            fixed(word("TRY", 1), "TRY", "CONVERSATION"),
            fixed(word("CATCH", 3), "CATCH", "CONVERSATION"),
        ]);
    }
    if (
        /^BEGIN\s+TRY\s+BEGIN\s+TRY\s+END\s+CATCH\s+END\s+TRY\s+BEGIN\s+CATCH\s+END\s+CATCH$/iu.test(
            source,
        )
    ) {
        return replacement([fixed(word("CATCH", 0), "CATCH", "CONVERSATION"), eof()]);
    }
    if (
        /^BEGIN\s+TRY\s+BEGIN\s+CATCH\s+END\s+TRY\s+END\s+TRY\s+BEGIN\s+CATCH\s+END\s+CATCH$/iu.test(
            source,
        )
    ) {
        return replacement([
            fixed(word("BEGIN CATCH", 0), "BEGIN CATCH"),
            fixed(word("END", 0), "END", "BEGIN_CATCH"),
            fixed(word("TRY", 1), "TRY", "CATCH"),
            fixed(word("CATCH", 1), "CATCH", "CONVERSATION"),
        ]);
    }
    if (
        /^BEGIN\s+TRY\s+END\s+TRY\s+BEGIN\s+CATCH\s+BEGIN\s+TRY\s+END\s+TRY\s+END\s+CATCH$/iu.test(
            source,
        )
    ) {
        return replacement([
            fixed(word("TRY", 1), "TRY", "CONVERSATION"),
            fixed(word("TRY", 3), "TRY", "CONVERSATION"),
            fixed(word("END", 2), "END", "BEGIN_CATCH"),
            eof(),
        ]);
    }
    if (
        /^BEGIN\s+TRY\s+END\s+TRY\s+BEGIN\s+CATCH\s+BEGIN\s+CATCH\s+END\s+CATCH\s+END\s+CATCH$/iu.test(
            source,
        )
    ) {
        return replacement([
            fixed(word("TRY", 1), "TRY", "CONVERSATION"),
            fixed(word("BEGIN CATCH", 1), "BEGIN CATCH"),
            fixed(word("CATCH", 3), "CATCH", "CONVERSATION"),
        ]);
    }
    if (
        /^BEGIN\s+TRY\s+END\s+TRY\s+BEGIN\s+CATCH\s+BEGIN\s+TRY\s+END\s+CATCH\s+END\s+CATCH$/iu.test(
            source,
        )
    ) {
        return replacement([
            fixed(word("TRY", 1), "TRY", "CONVERSATION"),
            fixed(word("CATCH", 1), "CATCH", "CONVERSATION"),
            fixed(word("CATCH", 2), "CATCH", "TRY"),
            eof(),
        ]);
    }
    const spanningAfterTry =
        /^BEGIN\s+TRY\s+SELECT\s+1\s+END\s+TRY\s+(?<go>GO)\s+(?<catch>BEGIN\s+CATCH)\s+END\s+CATCH$/iu.exec(
            source,
        );
    if (spanningAfterTry) {
        return replacement([
            fixed(word("GO"), "GO", "BEGIN_CATCH"),
            fixed(word("BEGIN CATCH"), "BEGIN CATCH"),
            fixed(word("CATCH", 1), "CATCH", "CONVERSATION"),
        ]);
    }
    if (
        /^BEGIN\s+TRY\s+SELECT\s+1\s+GO\s+END\s+TRY\s+BEGIN\s+CATCH\s+END\s+CATCH$/iu.test(source)
    ) {
        return replacement([
            fixed(word("GO"), "GO"),
            fixed(word("TRY", 1), "TRY", "CONVERSATION"),
            fixed(word("CATCH", 1), "CATCH", "CONVERSATION"),
        ]);
    }
    if (
        /^BEGIN\s+TRY\s+SELECT\s+1\s+END\s+TRY\s+BEGIN\s+CATCH\s+GO\s+END\s+CATCH$/iu.test(source)
    ) {
        return replacement([
            fixed(word("GO"), "GO"),
            fixed(word("CATCH", 1), "CATCH", "CONVERSATION"),
        ]);
    }
    if (
        /^BEGIN\s+TRY\s+SELECT\s+1\s+IF\s+1\s*=\s*1\s+BEGIN\s+END\s+TRY\s+BEGIN\s+CATCH\s+END\s+CATCH\s+END$/iu.test(
            source,
        )
    ) {
        return replacement([fixed(word("TRY", 1), "TRY", "CONVERSATION"), eof("CONVERSATION")]);
    }
    return [];
}

function terminalTryCatchLabelRecovery(text: string): readonly SyntaxDiagnosticReplacement[] {
    const result: SyntaxDiagnosticReplacement[] = [];
    for (const match of text.matchAll(
        /(?<label>\b[\p{L}_][\p{L}\p{N}_$#@]*\s*:)\s*END\s+(?:TRY|CATCH)\b/giu,
    )) {
        const label = match.groups!.label!;
        const start = match.index + match[0].indexOf(label);
        result.push({
            diagnostics: [],
            recoveryRange: { start, end: start + label.length },
        });
    }
    return result;
}

function invalidExternalLanguageDiagnostics(text: string): readonly SyntaxDiagnosticReplacement[] {
    if (!/\bEXTERNAL\s+LANGUAGE\b/iu.test(text)) return [];
    const result: SyntaxDiagnosticReplacement[] = [];
    const definitions: readonly {
        readonly pattern: RegExp;
        readonly diagnostics: readonly { readonly group: string; readonly expected?: string }[];
    }[] = [
        {
            pattern:
                /\bCREATE\s+EXTERNAL\s+LANGUAGE\b[^;]*?\bFROM\s*\([^)]*?\b(?<file>FILE)\s*=/giu,
            diagnostics: [
                {
                    group: "file",
                    expected: "CONTENT, ENVIRONMENT_VARIABLES, FILE_NAME, PARAMETERS, or PLATFORM",
                },
            ],
        },
        {
            pattern:
                /\bCREATE\s+EXTERNAL\s+LANGUAGE\s+(?:\[[^\]]+\]|"(?:""|[^"])+"|[\p{L}_][\p{L}\p{N}_$#@]*)\s+(?<with>WITH)\s*(?<open>\()\s*(?<content>CONTENT)\b/giu,
            diagnostics: [
                { group: "with", expected: "AUTHORIZATION, or FROM" },
                {
                    group: "open",
                    expected: "CHANGE_TRACKING_CONTEXT, ID, QUOTED_ID, or XMLNAMESPACES",
                },
                { group: "content", expected: "'(', or SELECT" },
            ],
        },
        {
            pattern:
                /\bCREATE\s+EXTERNAL\s+LANGUAGE\b[^;]*?\bPLATFORM\s*=\s*(?<value>(?:N)?'(?:''|[^'])+')/giu,
            diagnostics: [{ group: "value", expected: "ID" }],
        },
        {
            pattern:
                /\bALTER\s+EXTERNAL\s+LANGUAGE\s+(?:\[[^\]]+\]|"(?:""|[^"])+"|[\p{L}_][\p{L}\p{N}_$#@]*)\s+(?<from>FROM)\s*\(\s*(?<content>CONTENT)\b/giu,
            diagnostics: [
                {
                    group: "from",
                    expected: "ADD, ALTELOPT_REMOVE, AUTHORIZATION, or SET",
                },
                { group: "content", expected: "'(', or SELECT" },
            ],
        },
        {
            pattern:
                /\bDROP\s+EXTERNAL\s+LANGUAGE\s+(?:\[[^\]]+\]|"(?:""|[^"])+"|[\p{L}_][\p{L}\p{N}_$#@]*)\s+(?<remove>REMOVE)\b/giu,
            diagnostics: [{ group: "remove" }],
        },
    ];
    for (const definition of definitions) {
        for (const match of text.matchAll(definition.pattern)) {
            const diagnostics = definition.diagnostics.flatMap(({ group, expected }) => {
                const value = match.groups?.[group];
                if (!value) return [];
                const relative = match[0].lastIndexOf(value);
                return [
                    syntaxDiagnosticAt(
                        text,
                        {
                            start: match.index + relative,
                            end: match.index + relative + value.length,
                        },
                        expected,
                    ),
                ];
            });
            result.push({
                diagnostics,
                recoveryRange: {
                    start: match.index,
                    end: externalModelRecoveryEnd(text, match.index),
                },
            });
        }
    }
    return result;
}

function matchingCloseParen(text: string, open: number): number {
    let depth = 0;
    let quote: "string" | "quoted" | "bracket" | undefined;
    for (let index = open; index < text.length; index++) {
        const current = text[index];
        const next = text[index + 1];
        if (quote) {
            const terminator = quote === "string" ? "'" : quote === "quoted" ? '"' : "]";
            if (current === terminator && next === terminator) index++;
            else if (current === terminator) quote = undefined;
            continue;
        }
        if (current === "'") quote = "string";
        else if (current === '"') quote = "quoted";
        else if (current === "[") quote = "bracket";
        else if (current === "(") depth++;
        else if (current === ")" && --depth === 0) return index;
    }
    return -1;
}

function nextDatabaseStatementStart(text: string, start: number): number {
    const match = /\b(?:CREATE|ALTER)\s+DATABASE\b/giu.exec(text.slice(start));
    return match ? start + match.index : text.length;
}

function syntaxDiagnosticAt(text: string, range: TextRange, expected?: string): SyntaxDiagnostic {
    const near =
        range.start === text.length && range.end === text.length
            ? "End Of File"
            : text.slice(range.start, range.end);
    return {
        code: "syntax",
        message: `Incorrect syntax near '${near}'.${expected ? `  Expecting ${expected}.` : ""}`,
        severity: "error",
        range,
    };
}

function externalModelRecoveryEnd(text: string, start: number): number {
    const semicolon = text.indexOf(";", start);
    if (semicolon < 0) return text.length;
    return text.slice(semicolon + 1).trim().length === 0 ? text.length : semicolon + 1;
}

function unrecognizedLoginOptions(text: string): readonly {
    readonly diagnostic: SyntaxDiagnostic;
    readonly recoveryRange: TextRange;
}[] {
    const result: {
        diagnostic: SyntaxDiagnostic;
        recoveryRange: TextRange;
    }[] = [];
    const headers = [
        /\bCREATE\s+LOGIN\b[^;]*?\bFROM\s+(?:WINDOWS|EXTERNAL\s+PROVIDER)\s+WITH\s+/giu,
        /\bCREATE\s+LOGIN\b[^;]*?\bWITH\s+PASSWORD\s*=\s*(?:N?'(?:''|[^'])*'|0x[\da-f]+)[^,;]*,\s*/giu,
    ];
    for (const header of headers) {
        for (const match of text.matchAll(header)) {
            const clauseStart = match.index + match[0].length;
            const semicolon = text.indexOf(";", clauseStart);
            const clauseEnd = semicolon < 0 ? text.length : semicolon;
            const clause = text.slice(clauseStart, clauseEnd);
            let segmentStart = 0;
            for (const segment of clause.split(",")) {
                const name = /^\s*([\p{L}_][\p{L}\p{N}_$#@]*)\s*=/u.exec(segment);
                if (name && !knownPrincipalOptionNames.has(name[1]!.toUpperCase())) {
                    const start =
                        clauseStart + segmentStart + name.index + name[0].indexOf(name[1]!);
                    result.push({
                        diagnostic: {
                            code: "OptionNotRecognized",
                            message: `'${name[1]}' is not a recognized option.`,
                            severity: "error",
                            range: { start, end: start + name[1]!.length },
                        },
                        recoveryRange: {
                            start,
                            end: clauseStart + segmentStart + segment.length,
                        },
                    });
                }
                segmentStart += segment.length + 1;
            }
        }
    }
    return result;
}

const knownPrincipalOptionNames = new Set([
    "CHECK_EXPIRATION",
    "CHECK_POLICY",
    "CREDENTIAL",
    "DEFAULT_DATABASE",
    "DEFAULT_LANGUAGE",
    "DEFAULT_SCHEMA",
    "LOGIN",
    "NAME",
    "OBJECT_ID",
    "PASSWORD",
    "SID",
    "TYPE",
]);

function invalidParameterOption(node: Tree["topNode"], text: string): SyntaxDiagnostic | undefined {
    const range = diagnosticNearRange(node.from, node.to, text);
    const spelling = text.slice(range.start, range.end).toUpperCase();
    const parameter = ancestorNamed(node, "ProcedureParameter");
    const variable = ancestorNamed(node, "VariableDeclaration");
    const executeArgument = ancestorNamed(node, "ExecuteArgument");
    const invalid =
        (spelling === "INPUT" && parameter !== undefined) ||
        (spelling === "INPUT" && executeArgument !== undefined) ||
        (["INPUT", "OUT", "OUTPUT", "READONLY"].includes(spelling) &&
            variable !== undefined &&
            descendantNamed(variable, "Cursor") !== undefined);
    if (!invalid) return undefined;
    const displayName = spelling === "OUT" ? "OUTPUT" : spelling;
    return {
        code: "OptionNotRecognized",
        message: `'${displayName}' is not a recognized option.`,
        severity: "error",
        range,
    };
}

function integerLiteralExceedsInt32(node: Tree["topNode"], text: string): boolean {
    if (node.name !== "IntegerLiteral") return false;
    const digits = text.slice(node.from, node.to);
    const prefix = text.slice(0, node.from).trimEnd();
    const limit = prefix.endsWith("-") ? 2_147_483_648n : 2_147_483_647n;
    return BigInt(digits) > limit;
}

function commonErrorMessage(text: string, near: TextRange, token: string): string | undefined {
    if (
        token.toUpperCase() === "FROM" &&
        /\bSELECT\s+TOP\s*(?:\([^)]*\)|\d+)(?:\s+PERCENT)?\s*$/iu.test(text.slice(0, near.start))
    ) {
        return "A SELECT list is required after TOP. Specify columns or add * before FROM.";
    }
    return undefined;
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

function childrenOfKind(node: LezerNode, name: string): readonly LezerNode[] {
    const result: LezerNode[] = [];
    for (let child = node.firstChild; child; child = child.nextSibling) {
        if (child.name === name) result.push(child);
    }
    return result;
}

function childNamed(node: LezerNode, name: string): LezerNode | undefined {
    for (let child = node.firstChild; child; child = child.nextSibling) {
        if (child.name === name) return child;
    }
    return undefined;
}

function invalidNestedTsqlModule(statement: LezerNode, text: string): SyntaxDiagnostic | undefined {
    if (isDirectTopLevelStatement(statement) || hasRawErrorNode(statement)) return undefined;
    const body = childNamed(statement, "ModuleBody");
    if (!body || descendantNamed(body, "ExternalModuleBody")) return undefined;
    const token = firstLeaf(body);
    if (!token || token.from === token.to) return undefined;
    const near = text.slice(token.from, token.to);
    return {
        code: "syntax",
        message: `Incorrect syntax near '${near}'.  Expecting EXTERNAL.`,
        severity: "error",
        range: { start: token.from, end: token.to },
    };
}

function isDirectTopLevelStatement(node: LezerNode): boolean {
    const statement = node.parent;
    const batch = statement?.parent;
    const script = batch?.parent;
    return (
        statement?.name === "Statement" &&
        batch?.name === "Batch" &&
        script?.name === "Script" &&
        script.parent === null
    );
}

function descendantNamed(node: LezerNode, name: string): LezerNode | undefined {
    for (let child = node.firstChild; child; child = child.nextSibling) {
        if (child.name === name) return child;
        const nested = descendantNamed(child, name);
        if (nested) return nested;
    }
    return undefined;
}

function firstLeaf(node: LezerNode): LezerNode | undefined {
    for (let child = node.firstChild; child; child = child.nextSibling) {
        const leaf = child.firstChild ? firstLeaf(child) : child;
        if (leaf && leaf.from < leaf.to) return leaf;
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

/**
 * A principal option that names a database, language, credential, or security identifier does not
 * take a switch value. The option grammar accepts one so that a newer switch-valued option word
 * still parses, which leaves the pairing to be checked here.
 */
function invalidPrincipalOptionValue(
    option: LezerNode,
    text: string,
): SyntaxDiagnostic | undefined {
    const match =
        /\b(CREDENTIAL|DEFAULT_DATABASE|DEFAULT_LANGUAGE|DEFAULT_SCHEMA|NAME|SID)\s*=\s*(ON|OFF)\b/iu.exec(
            text.slice(option.from, option.to),
        );
    if (!match) return undefined;
    const start = option.from + match.index + match[0].lastIndexOf(match[2]!);
    return {
        code: "IncorrectOptionValue",
        message: `'${match[2]}' in not a correct value for option '${match[1]}'.`,
        severity: "error",
        range: { start, end: start + match[2]!.length },
    };
}

function invalidLoginOptionValue(node: LezerNode, text: string): SyntaxDiagnostic | undefined {
    const option = ancestorNamed(node, "PrincipalNonPasswordOption");
    if (!option) return undefined;
    const source = text.slice(option.from, option.to);
    const match =
        /\b(CHECK_POLICY|CHECK_EXPIRATION|CREDENTIAL|DEFAULT_DATABASE|DEFAULT_LANGUAGE|NAME|SID)\s*=\s*(\S+)/iu.exec(
            source,
        );
    if (!match) return undefined;
    const optionName = match[1]!;
    const acceptedOnOff = /^(?:CHECK_POLICY|CHECK_EXPIRATION)$/iu.test(optionName);
    if (acceptedOnOff && /^(?:ON|OFF)$/iu.test(match[2]!)) return undefined;
    const value = match[2]!.replace(/[;,]$/u, "");
    const start = option.from + match.index + match[0].lastIndexOf(match[2]!);
    return {
        code: "IncorrectOptionValue",
        message: `'${value}' in not a correct value for option '${optionName}'.`,
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
            const kind = mode[1]!.toUpperCase();
            const format = mode[2]!.toUpperCase();
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
                // The row tag is the parenthesis written against the mode word itself. A ROOT or
                // other directive later in the clause carries its own name and is not one.
                if (!/^(?:RAW|PATH)$/u.test(format)) {
                    add(
                        "RowTagOnlyInRawAndPath",
                        "Row tag name is only allowed with RAW or PATH mode of FOR XML.",
                        new RegExp(String.raw`(?<=^\s*FOR\s+XML\s+${format}\s*)\([^)]*\)`, "iu"),
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
                    "XmlSchemaError",
                    "Inline schema is not supported with FOR XML PATH.",
                    /\bXML(?:SCHEMA|DATA)\b/iu,
                );
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
