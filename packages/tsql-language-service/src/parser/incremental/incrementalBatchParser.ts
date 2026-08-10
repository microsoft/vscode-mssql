/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { BatchSeparatorNode, ParseIssue, ParseResult, Program } from "../saral/ast/types.js";
import { analyzeParseResult, type AnalysisResult } from "../saral/analyze.js";
import { Lexer } from "../saral/parser/lexer.js";
import { Parser } from "../saral/parser/parser.js";
import { partitionSqlBatches, type SqlBatchRegion } from "./batchPartitioner.js";

export interface IncrementalParseStatistics {
    readonly parsedBatchCount: number;
    readonly reusedBatchCount: number;
    readonly totalBatchCount: number;
    readonly reusedCharacterCount: number;
    readonly totalCharacterCount: number;
}

export interface ParsedBatch {
    readonly region: SqlBatchRegion;
    /** Relative-offset parser product. Identity is stable while the batch text is reused. */
    readonly artifact: ParseResult;
}

export class IncrementalParseSnapshot {
    private materialized: ParseResult | undefined;

    public constructor(
        public readonly text: string,
        public readonly version: string | number,
        public readonly batches: readonly ParsedBatch[],
        public readonly statistics: IncrementalParseStatistics,
    ) {}

    /** Returns a conventional absolute-offset AST for consumers which do not understand batches. */
    public parseResult(): ParseResult {
        return (this.materialized ??= materialize(this.text, this.batches));
    }
}

/** A parse snapshot paired with a lazily computed, whole-program semantic analysis. */
export class IncrementalAnalysisSnapshot {
    private analyzed: AnalysisResult | undefined;

    public constructor(public readonly parseSnapshot: IncrementalParseSnapshot) {}

    public get text(): string {
        return this.parseSnapshot.text;
    }

    public get version(): string | number {
        return this.parseSnapshot.version;
    }

    public get batches(): readonly ParsedBatch[] {
        return this.parseSnapshot.batches;
    }

    public get statistics(): IncrementalParseStatistics {
        return this.parseSnapshot.statistics;
    }

    public parseResult(): ParseResult {
        return this.parseSnapshot.parseResult();
    }

    /** Runs semantic analysis on the materialized AST and never invokes the lexer or parser. */
    public analysisResult(): AnalysisResult {
        return (this.analyzed ??= analyzeParseResult(this.parseResult()));
    }
}

/** Incremental facade which reuses batch parse artifacts and refreshes whole-program semantics. */
export class IncrementalBatchAnalyzer {
    public constructor(private readonly parser = new IncrementalBatchParser()) {}

    public create(text: string, version: string | number = 1): IncrementalAnalysisSnapshot {
        return new IncrementalAnalysisSnapshot(this.parser.create(text, version));
    }

    public update(
        previous: IncrementalAnalysisSnapshot,
        text: string,
        version: string | number,
    ): IncrementalAnalysisSnapshot {
        return new IncrementalAnalysisSnapshot(
            this.parser.update(previous.parseSnapshot, text, version),
        );
    }
}

/** Incremental parser strategy which reuses relative-offset parse products for unchanged batches. */
export class IncrementalBatchParser {
    public create(text: string, version: string | number = 1): IncrementalParseSnapshot {
        return this.build(text, version, undefined);
    }

    public update(
        previous: IncrementalParseSnapshot,
        text: string,
        version: string | number,
    ): IncrementalParseSnapshot {
        if (previous.text === text) {
            const parsedCharacterCount = previous.batches.reduce(
                (total, batch) => total + batch.region.text.length,
                0,
            );
            return new IncrementalParseSnapshot(text, version, previous.batches, {
                parsedBatchCount: 0,
                reusedBatchCount: previous.batches.length,
                totalBatchCount: previous.batches.length,
                reusedCharacterCount: parsedCharacterCount,
                totalCharacterCount: parsedCharacterCount,
            });
        }
        return this.build(text, version, previous);
    }

    private build(
        text: string,
        version: string | number,
        previous: IncrementalParseSnapshot | undefined,
    ): IncrementalParseSnapshot {
        const reusable = indexReusableBatches(previous?.batches ?? []);
        let parsedBatchCount = 0;
        let reusedBatchCount = 0;
        let reusedCharacterCount = 0;
        const regions = partitionSqlBatches(text);
        const batches = regions.map((region): ParsedBatch => {
            const reused = takeReusableBatch(reusable, region);
            if (reused) {
                reusedBatchCount++;
                reusedCharacterCount += region.text.length;
                return { region, artifact: reused.artifact };
            }
            parsedBatchCount++;
            return {
                region,
                artifact: new Parser(new Lexer(region.text)).parse(),
            };
        });
        return new IncrementalParseSnapshot(text, version, Object.freeze(batches), {
            parsedBatchCount,
            reusedBatchCount,
            totalBatchCount: batches.length,
            reusedCharacterCount,
            totalCharacterCount: regions.reduce((total, region) => total + region.text.length, 0),
        });
    }
}

function indexReusableBatches(batches: readonly ParsedBatch[]): Map<number, ParsedBatch[]> {
    const result = new Map<number, ParsedBatch[]>();
    for (const batch of batches) {
        const key = batchKey(batch.region);
        const matches = result.get(key);
        if (matches) {
            matches.push(batch);
        } else {
            result.set(key, [batch]);
        }
    }
    return result;
}

/** Hash buckets can collide, so the candidate text is still compared before an artifact is reused. */
function takeReusableBatch(
    reusable: Map<number, ParsedBatch[]>,
    region: SqlBatchRegion,
): ParsedBatch | undefined {
    const candidates = reusable.get(batchKey(region));
    if (!candidates) {
        return undefined;
    }
    const index = candidates.findIndex((candidate) => candidate.region.text === region.text);
    return index < 0 ? undefined : candidates.splice(index, 1)[0];
}

// Separators are materialized independently and are never input to the batch parser.
function batchKey(region: SqlBatchRegion): number {
    // FNV-1a over the batch text. Using the text itself as a Map key duplicated the whole document
    // into the reuse index and re-hashed every character on each keystroke.
    const text = region.text;
    let hash = 0x811c9dc5;
    for (let index = 0; index < text.length; index++) {
        hash ^= text.charCodeAt(index);
        hash = Math.imul(hash, 0x01000193);
    }
    return (hash ^ text.length) >>> 0;
}

/**
 * Translated statements are keyed by parse artifact and offset delta. An edit only shifts the
 * batches after it, so every batch before the edit point is served from this cache unchanged.
 */
const translationCache = new WeakMap<ParseResult, Map<string, TranslatedBatch>>();

interface TranslatedBatch {
    readonly body: Program["body"];
    readonly issues: readonly ParseIssue[];
}

function translateBatch(batch: ParsedBatch): TranslatedBatch {
    const delta = batch.region.start;
    const lineDelta = batch.region.startLine - 1;
    let cache = translationCache.get(batch.artifact);
    if (!cache) {
        cache = new Map();
        translationCache.set(batch.artifact, cache);
    }
    const key = `${delta}:${lineDelta}`;
    const cached = cache.get(key);
    if (cached) {
        return cached;
    }
    const translated: TranslatedBatch = {
        body: batch.artifact.ast.body.map((statement) =>
            translateLocations(statement, delta, lineDelta),
        ),
        issues: (batch.artifact.issues ?? []).map((issue) =>
            translateLocations(issue, delta, lineDelta),
        ),
    };
    cache.set(key, translated);
    return translated;
}

function materialize(text: string, batches: readonly ParsedBatch[]): ParseResult {
    const body: Program["body"] = [];
    const issues: ParseIssue[] = [];
    for (const batch of batches) {
        const translated = translateBatch(batch);
        body.push(...translated.body);
        issues.push(...translated.issues);
        if (batch.region.separator) {
            const separator: BatchSeparatorNode = {
                type: "BatchSeparatorStatement",
                start: batch.region.separator.start,
                end: batch.region.separator.end,
                ...(batch.region.separator.count === undefined
                    ? {}
                    : { count: batch.region.separator.count }),
            };
            body.push(separator);
        }
    }
    return {
        ast: { type: "Program", start: 0, end: text.length, body },
        issues,
    };
}

function translateLocations<T>(
    value: T,
    delta: number,
    lineDelta: number,
    seen = new Map<object, unknown>(),
): T {
    if (delta === 0 && lineDelta === 0) {
        // Relative offsets already match absolute ones, so the immutable artifact is shared as-is.
        return value;
    }
    if (value === null || typeof value !== "object") {
        return value;
    }
    const existing = seen.get(value);
    if (existing) {
        return existing as T;
    }
    if (Array.isArray(value)) {
        const result: unknown[] = [];
        seen.set(value, result);
        for (const item of value) {
            result.push(translateLocations(item, delta, lineDelta, seen));
        }
        return result as T;
    }
    const result: Record<string, unknown> = {};
    seen.set(value, result);
    const hasDiagnosticMessage =
        typeof (value as Record<string, unknown>).code === "string" &&
        typeof (value as Record<string, unknown>).message === "string";
    for (const [key, child] of Object.entries(value)) {
        if ((key === "start" || key === "end") && typeof child === "number") {
            result[key] = child + delta;
        } else if (key === "errors" && Array.isArray(child)) {
            result[key] = child.map((message) =>
                typeof message === "string" ? translateErrorLines(message, lineDelta) : message,
            );
        } else if (key === "message" && hasDiagnosticMessage && typeof child === "string") {
            result[key] = translateErrorLines(child, lineDelta);
        } else {
            result[key] = translateLocations(child, delta, lineDelta, seen);
        }
    }
    return result as T;
}

function translateErrorLines(message: string, lineDelta: number): string {
    return lineDelta === 0
        ? message
        : message.replace(
              /\bat line (\d+)\b/gu,
              (_match, line: string) => `at line ${Number.parseInt(line, 10) + lineDelta}`,
          );
}
