/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * ts-native page builder (TSQ2 addendum §5.7-5.8): rows → CompactPage with
 * STS2-parity shaping rules — a page closes on pageRows OR pageBytes,
 * whichever first; a single row over pageBytes becomes its own one-row page
 * (never empty, never dropped); nullBitmap packing is byte-identical to
 * api.packBitmap (row-major LSB-first).
 *
 * approxBytes is the shared LOGICAL estimator (provider-neutral compact-
 * representation size) so RowStore policy and A/B byte metrics stay coherent
 * across providers; resident JS memory is tracked separately by the engine.
 */

import { CompactPage, RowsPage, packBitmap } from "../sqlDataPlane/api";

export interface PageLimits {
    pageRows: number;
    pageBytes: number;
}

/** STS2 defaults; client options clamp lower-only against these. */
export const TS_NATIVE_PAGE_DEFAULTS = {
    pageRows: 1000,
    pageBytes: 262_144,
    maxCellBytes: 1_048_576,
    truncatedPrefixBytes: 65_536,
    windowPages: 4,
} as const;

const PAGE_OVERHEAD_BYTES = 32;

export class PageBuilder {
    private values: unknown[][] = [];
    private nullBits: boolean[] = [];
    private bytes = PAGE_OVERHEAD_BYTES;
    private rowOffset = 0;
    private pageSeq = 0;

    constructor(
        private readonly resultSetId: string,
        private readonly typeHints: readonly string[],
        private readonly limits: PageLimits,
    ) {}

    get openRowCount(): number {
        return this.values.length;
    }

    /**
     * Add one encoded row. Returns 0..2 completed pages: an oversized row
     * first flushes any open rows as their own page, then closes immediately
     * as a single-row page (STS2 rule: never empty, never dropped, never
     * sharing a page with other rows).
     */
    addRow(cells: readonly unknown[], nulls: readonly boolean[], rowBytes: number): RowsPage[] {
        const completed: RowsPage[] = [];
        if (rowBytes >= this.limits.pageBytes && this.values.length > 0) {
            completed.push(this.closePage(false));
        }
        this.stage(cells, nulls, rowBytes);
        if (this.values.length >= this.limits.pageRows || this.bytes >= this.limits.pageBytes) {
            completed.push(this.closePage(false));
        }
        return completed;
    }

    /** Close any open page (result-set end / terminal path). */
    flush(complete: boolean): RowsPage | undefined {
        if (this.values.length === 0) {
            return undefined;
        }
        return this.closePage(complete);
    }

    private stage(cells: readonly unknown[], nulls: readonly boolean[], rowBytes: number): void {
        this.values.push([...cells]);
        for (const isNull of nulls) {
            this.nullBits.push(isNull);
        }
        this.bytes += rowBytes;
    }

    private closePage(complete: boolean): RowsPage {
        const compact: CompactPage = {
            values: this.values,
            nullBitmap: packBitmap(this.nullBits),
            typeHints: [...this.typeHints],
        };
        const page: RowsPage = {
            resultSetId: this.resultSetId,
            pageSeq: this.pageSeq++,
            rowOffset: this.rowOffset,
            compact,
            rowCount: this.values.length,
            approxBytes: this.bytes,
            ...(complete ? { complete: true } : {}),
        };
        this.rowOffset += this.values.length;
        this.values = [];
        this.nullBits = [];
        this.bytes = PAGE_OVERHEAD_BYTES;
        return page;
    }
}

/** Lower-only clamp against pinned defaults (STS2 D-0014 parity). */
export function clampPageLimit(requested: number | undefined, pinnedDefault: number): number {
    if (
        requested === undefined ||
        !Number.isFinite(requested) ||
        !Number.isInteger(requested) ||
        requested <= 0 ||
        requested > pinnedDefault
    ) {
        return pinnedDefault;
    }
    return requested;
}
