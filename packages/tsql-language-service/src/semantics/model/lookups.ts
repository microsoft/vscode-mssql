/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { TextRange } from "../../text/index.js";
import type { BoundColumn, BoundRelation } from "./contracts.js";

/**
 * Positional and name-keyed lookups over the collections the semantic layer carries.
 *
 * Binding asks the same two questions over and over: *which of these sit inside this range*, and
 * *which of these are called this*. Answered by scanning the collection, each is linear, and since
 * both are asked once per reference the whole layer becomes quadratic in the size of the document.
 * That is not a hypothetical: a keystroke in a 200 KB script cost 48 seconds, almost all of it
 * spent re-scanning collections that had not changed.
 *
 * So the rule this module exists to enforce is: **a lookup is keyed on what is being looked up.**
 * Position questions go through {@link RangeIndex}; name questions go through a name map. Neither
 * scans.
 *
 * Every index here is cached against the array it describes, using the array's own identity. The
 * arrays are rebuilt whenever the model they belong to is, so a cache entry cannot outlive the data
 * it summarises, and nothing has to remember to invalidate it.
 */

/** A collection of positioned items, answerable by position without scanning. */
export interface RangeIndex<T> {
    /**
     * The items lying entirely inside `range`, in the collection's original order.
     *
     * Order is preserved because callers use it to break ties -- when two relations expose the same
     * column name, the one built first wins -- so sorting by position would quietly change results.
     */
    within(range: TextRange): readonly T[];

    /**
     * The items completed at or before `offset`, most recent first.
     *
     * Most recent first because the caller almost always wants the declaration in force at a point,
     * which is the last one to have finished before it.
     */
    endingBefore(offset: number): Iterable<T>;

    /** The shortest item containing `offset`, or undefined when none does. */
    containing(offset: number): T | undefined;

    /** Every item, in the collection's original order, for a caller with no range to narrow by. */
    readonly all: readonly T[];
}

interface Positioned<T> {
    readonly item: T;
    readonly range: TextRange;
    readonly order: number;
}

class SortedRangeIndex<T> implements RangeIndex<T> {
    /** Sorted by start offset, which is what makes both queries a binary search. */
    private readonly _byStart: readonly Positioned<T>[];
    /** Sorted by end offset, for the "what was complete here" question. */
    private readonly _byEnd: readonly Positioned<T>[];
    /** Greatest end offset at or before each `_byStart` entry. */
    private readonly _prefixMaxEnd: readonly number[];
    public readonly all: readonly T[];

    public constructor(items: readonly T[], rangeOf: (item: T) => TextRange) {
        this.all = items;
        const positioned = items.map((item, order) => ({ item, range: rangeOf(item), order }));
        this._byStart = [...positioned].sort(
            (left, right) => left.range.start - right.range.start || left.order - right.order,
        );
        this._byEnd = [...positioned].sort(
            (left, right) =>
                left.range.end - right.range.end || left.range.start - right.range.start,
        );
        let maximum = -1;
        this._prefixMaxEnd = this._byStart.map((entry) => {
            maximum = Math.max(maximum, entry.range.end);
            return maximum;
        });
    }

    public within(range: TextRange): readonly T[] {
        const inside: Positioned<T>[] = [];
        for (
            let index = lowerBoundByStart(this._byStart, range.start);
            index < this._byStart.length;
            index++
        ) {
            const entry = this._byStart[index]!;
            if (entry.range.start > range.end) break;
            if (entry.range.end <= range.end) inside.push(entry);
        }
        inside.sort((left, right) => left.order - right.order);
        return inside.map((entry) => entry.item);
    }

    public *endingBefore(offset: number): Iterable<T> {
        for (let index = lastEndingAtOrBefore(this._byEnd, offset); index >= 0; index--) {
            yield this._byEnd[index]!.item;
        }
    }

    public containing(offset: number): T | undefined {
        let index = lastStartingAtOrBefore(this._byStart, offset);
        let best: Positioned<T> | undefined;
        while (index >= 0 && this._prefixMaxEnd[index]! >= offset) {
            const entry = this._byStart[index]!;
            if (
                entry.range.end >= offset &&
                (!best || entry.range.end - entry.range.start < best.range.end - best.range.start)
            ) {
                best = entry;
            }
            index--;
        }
        return best?.item;
    }
}

/** The first index whose item starts at or after `start`. */
function lowerBoundByStart<T>(entries: readonly Positioned<T>[], start: number): number {
    let low = 0;
    let high = entries.length;
    while (low < high) {
        const middle = (low + high) >> 1;
        if (entries[middle]!.range.start < start) low = middle + 1;
        else high = middle;
    }
    return low;
}

/** The last index whose item ends at or before `offset`, or -1 when none does. */
function lastEndingAtOrBefore<T>(entries: readonly Positioned<T>[], offset: number): number {
    let low = 0;
    let high = entries.length - 1;
    let found = -1;
    while (low <= high) {
        const middle = (low + high) >> 1;
        if (entries[middle]!.range.end <= offset) {
            found = middle;
            low = middle + 1;
        } else {
            high = middle - 1;
        }
    }
    return found;
}

/** The last index whose item starts at or before `offset`, or -1 when none does. */
function lastStartingAtOrBefore<T>(entries: readonly Positioned<T>[], offset: number): number {
    let low = 0;
    let high = entries.length - 1;
    let found = -1;
    while (low <= high) {
        const middle = (low + high) >> 1;
        if (entries[middle]!.range.start <= offset) {
            found = middle;
            low = middle + 1;
        } else {
            high = middle - 1;
        }
    }
    return found;
}

const rangeIndexes = new WeakMap<object, RangeIndex<unknown>>();

/**
 * The range index for one array, built once and cached against the array itself.
 *
 * The cache key is the array's identity rather than a document version, so a rebuilt array is a
 * different key and there is nothing to invalidate. Callers must therefore not mutate an array they
 * have indexed, which is already true of everything the semantic model publishes.
 */
export function rangeIndexFor<T extends object>(
    items: readonly T[],
    rangeOf: (item: T) => TextRange,
): RangeIndex<T> {
    const cached = rangeIndexes.get(items);
    if (cached) return cached as RangeIndex<T>;
    const built = new SortedRangeIndex(items, rangeOf);
    rangeIndexes.set(items, built as RangeIndex<unknown>);
    return built;
}

/** One column, together with the relation exposing it and that relation's position in the model. */
export interface ColumnBinding {
    readonly relation: BoundRelation;
    readonly column: BoundColumn;
    readonly order: number;
}

/**
 * Every column in a model, by folded name, and by position within each name.
 *
 * Both keys are needed, and one alone is not enough. Resolving `SELECT c FROM ...` by scanning the
 * document's relations makes the cost of naming a column the size of the whole script. Keying only
 * on the name fixes that until a script reuses column names -- `id`, `name`, `created` -- across
 * thousands of relations, at which point the list for one name is the document again.
 *
 * So the name selects a small set and the range index narrows it to the query asking. Each list
 * keeps the relations' original order, because which relation supplies a column when several expose
 * the same name is decided by that order.
 */
export type ColumnIndex = ReadonlyMap<string, RangeIndex<ColumnBinding>>;

const columnIndexes = new WeakMap<object, ColumnIndex>();

export function columnIndexFor(relations: readonly BoundRelation[]): ColumnIndex {
    const cached = columnIndexes.get(relations);
    if (cached) return cached;
    const byName = new Map<string, ColumnBinding[]>();
    relations.forEach((relation, order) => {
        if (relation.columns === "unknown") return;
        for (const column of relation.columns) {
            const folded = column.name.toLowerCase();
            const bindings = byName.get(folded) ?? [];
            bindings.push({ relation, column, order });
            byName.set(folded, bindings);
        }
    });
    const indexed = new Map<string, RangeIndex<ColumnBinding>>();
    for (const [folded, bindings] of byName) {
        indexed.set(folded, new SortedRangeIndex(bindings, (binding) => binding.relation.range));
    }
    columnIndexes.set(relations, indexed);
    return indexed;
}

/**
 * The items of an already document-ordered array that lie inside one of `ranges`.
 *
 * Deliberately not a {@link RangeIndex}. The arrays this answers for are the structural index's
 * per-kind buckets, which a pre-order tree walk already leaves sorted by start offset, and which are
 * rebuilt for every syntax snapshot. Building an index over them would sort what is already sorted
 * and would do it once per keystroke, costing more than the scan it set out to replace; a binary
 * search over the existing order costs nothing to prepare.
 *
 * The alternative it does replace is filtering the whole bucket per call, which made validating one
 * edited batch walk every node of that kind in the document.
 *
 * `ranges` may be in any order and the result is returned in the array's original order, because
 * callers report diagnostics in the order they visit nodes.
 */
export function itemsWithinRanges<T>(
    items: readonly T[],
    ranges: readonly TextRange[],
    rangeOf: (item: T) => TextRange,
): readonly T[] {
    if (ranges.length === 0) return [];
    const picked: number[] = [];
    for (const range of ranges) {
        for (
            let index = firstStartingAtOrAfter(items, range.start, rangeOf);
            index < items.length;
            index++
        ) {
            const item = rangeOf(items[index]!);
            if (item.start > range.end) break;
            if (item.end <= range.end) picked.push(index);
        }
    }
    if (ranges.length === 1) return picked.map((index) => items[index]!);
    // Ranges are normally disjoint and ascending, which would make the concatenation ordered
    // already. Sorting rather than assuming it keeps the contract true for any caller.
    return [...new Set(picked)].sort((left, right) => left - right).map((index) => items[index]!);
}

/** The first index whose item starts at or after `start`, in an array ordered by start offset. */
function firstStartingAtOrAfter<T>(
    items: readonly T[],
    start: number,
    rangeOf: (item: T) => TextRange,
): number {
    let low = 0;
    let high = items.length;
    while (low < high) {
        const middle = (low + high) >> 1;
        if (rangeOf(items[middle]!).start < start) low = middle + 1;
        else high = middle;
    }
    return low;
}
