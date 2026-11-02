/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type {
    FluentResultGridColumnWindow,
    FluentResultGridColumnWindowingOptions,
} from "../types/fluentResultGridDataSource";

const DEFAULT_MINIMUM_COLUMN_COUNT = 64;
const DEFAULT_OVERSCAN_COLUMN_COUNT = 8;

export interface FluentResultGridViewportColumn {
    field?: unknown;
    width?: number;
    hidden?: boolean;
    alwaysRenderColumn?: boolean;
}

export interface FluentResultGridColumnWindowInput {
    columns: readonly FluentResultGridViewportColumn[];
    sourceColumnCount: number;
    viewport: { leftPx: number; rightPx: number };
    frozenColumnIndex?: number;
    activeCellIndex?: number;
    options: FluentResultGridColumnWindowingOptions;
    /** A wider resident band is reused until the required span leaves it. */
    currentWindow?: FluentResultGridColumnWindow;
}

function nonNegativeInteger(value: number | undefined, fallback: number): number {
    if (value === undefined || !Number.isFinite(value)) {
        return fallback;
    }
    return Math.max(0, Math.floor(value));
}

function sourceOrdinal(field: unknown, sourceColumnCount: number): number | undefined {
    const ordinal = typeof field === "number" ? field : Number(field);
    return Number.isInteger(ordinal) && ordinal >= 0 && ordinal < sourceColumnCount
        ? ordinal
        : undefined;
}

function contains(
    window: FluentResultGridColumnWindow,
    requiredStart: number,
    requiredEnd: number,
): boolean {
    return window.start <= requiredStart && window.start + window.count >= requiredEnd;
}

/**
 * Resolve a contiguous source-column band for SlickGrid's current horizontal
 * viewport. Frozen/always-rendered/active data columns are correctness
 * dependencies. If they make the band span the full schema, undefined asks
 * the source for its normal full rows.
 */
export function resolveFluentResultGridColumnWindow(
    input: FluentResultGridColumnWindowInput,
): FluentResultGridColumnWindow | undefined {
    const sourceColumnCount = nonNegativeInteger(input.sourceColumnCount, 0);
    const minimumColumnCount = Math.max(
        1,
        nonNegativeInteger(input.options.minimumColumnCount, DEFAULT_MINIMUM_COLUMN_COUNT),
    );
    if (sourceColumnCount < minimumColumnCount) {
        return undefined;
    }

    const leftPx = Math.max(0, Number.isFinite(input.viewport.leftPx) ? input.viewport.leftPx : 0);
    const rightPx = Math.max(
        leftPx,
        Number.isFinite(input.viewport.rightPx) ? input.viewport.rightPx : leftPx,
    );
    const frozenColumnIndex = Number.isFinite(input.frozenColumnIndex)
        ? Math.floor(input.frozenColumnIndex ?? -1)
        : -1;
    const requiredOrdinals: number[] = [];
    let scrollableLeft = 0;

    for (let index = 0; index < input.columns.length; index++) {
        const column = input.columns[index];
        const frozen = index <= frozenColumnIndex;
        const width = column.hidden
            ? 0
            : Math.max(0, Number.isFinite(column.width) ? (column.width ?? 0) : 0);
        const scrollableRight = scrollableLeft + width;
        const intersectsViewport =
            width > 0 && scrollableRight > leftPx && scrollableLeft < rightPx;
        const required =
            !column.hidden &&
            (frozen ||
                intersectsViewport ||
                column.alwaysRenderColumn === true ||
                index === input.activeCellIndex);
        if (required) {
            const ordinal = sourceOrdinal(column.field, sourceColumnCount);
            if (ordinal !== undefined) {
                requiredOrdinals.push(ordinal);
            }
        }
        if (!frozen) {
            scrollableLeft = scrollableRight;
        }
    }

    // A zero-width pre-layout viewport still needs a useful first band.
    if (requiredOrdinals.length === 0) {
        requiredOrdinals.push(0);
    }

    const requiredStart = Math.min(...requiredOrdinals);
    const requiredEnd = Math.max(...requiredOrdinals) + 1;
    if (input.currentWindow && contains(input.currentWindow, requiredStart, requiredEnd)) {
        return input.currentWindow;
    }

    const overscan = nonNegativeInteger(
        input.options.overscanColumnCount,
        DEFAULT_OVERSCAN_COLUMN_COUNT,
    );
    const start = Math.max(0, requiredStart - overscan);
    const end = Math.min(sourceColumnCount, requiredEnd + overscan);
    if (start === 0 && end === sourceColumnCount) {
        return undefined;
    }
    return { start, count: end - start };
}
