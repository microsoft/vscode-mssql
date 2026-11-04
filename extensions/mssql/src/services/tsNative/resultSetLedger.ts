/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * ts-native result-set ledger (TSQ2 addendum §2.5/§5.6): the ledger — not ad
 * hoc event callbacks — owns domain ordering. DONE tokens are STATEMENT
 * boundaries, never the query terminal, and never create result sets:
 *
 *  - `metadata` defensively closes any still-open set, then opens a new one;
 *  - `row` requires an open set (else driver protocol violation);
 *  - a DONE token closes an open set once, recording its row-count evidence;
 *  - DONE with no open set contributes only to rows-affected accounting;
 *  - request completion closes a final open set;
 *  - `more` is diagnostic evidence, not a terminal.
 *
 * Rows-affected policy (pinned by live parity fixtures in N5): sum the valid
 * rowCounts of DONE tokens that closed NO result set (DML statements). Row
 * counts of SELECT-closing DONEs are result-set evidence, not rowsAffected.
 */

import { TdsColumn } from "./driver/tdsDriver";

export interface OpenResultSet {
    id: string;
    ordinal: number;
    columns: readonly TdsColumn[];
    rowCount: number;
}

export interface ClosedResultSet {
    id: string;
    ordinal: number;
    /** Engine-observed row count (authoritative for ResultSetEnded). */
    rowCount: number;
    /** DONE-carried count when present (diagnostic cross-check). */
    doneRowCount?: number;
    /** True when closed defensively by next metadata / completion. */
    implicitClose: boolean;
}

export type LedgerViolation = "rowWithoutMetadata";

export class ResultSetLedger {
    private open: OpenResultSet | undefined;
    private nextOrdinal = 0;
    private rowsAffectedTotal: number | undefined;
    private sawDml = false;

    constructor(private readonly newId: () => string) {}

    get openSet(): OpenResultSet | undefined {
        return this.open;
    }

    get resultSetCount(): number {
        return this.nextOrdinal;
    }

    /** Structured rowsAffected (undefined when no DML DONE carried a count). */
    get rowsAffected(): number | undefined {
        return this.sawDml ? this.rowsAffectedTotal : undefined;
    }

    /** Metadata opens a set; any still-open set closes defensively first. */
    onMetadata(columns: readonly TdsColumn[]): {
        closed?: ClosedResultSet;
        opened: OpenResultSet;
    } {
        const closed = this.open ? this.closeOpen(undefined, true) : undefined;
        const opened: OpenResultSet = {
            id: this.newId(),
            ordinal: this.nextOrdinal++,
            columns,
            rowCount: 0,
        };
        this.open = opened;
        return { ...(closed ? { closed } : {}), opened };
    }

    /** Row requires an open set. Returns a violation instead of throwing so
     *  the engine maps it to the stable ProtocolViolation identity. */
    onRow(): LedgerViolation | undefined {
        if (!this.open) {
            return "rowWithoutMetadata";
        }
        this.open.rowCount++;
        return undefined;
    }

    /**
     * DONE token: closes the open set once (row-count evidence recorded), or
     * accumulates rows-affected when no set is open.
     */
    onDone(rowCount: number | undefined): { closed?: ClosedResultSet } {
        if (this.open) {
            return { closed: this.closeOpen(rowCount, false) };
        }
        if (rowCount !== undefined) {
            this.sawDml = true;
            this.rowsAffectedTotal = (this.rowsAffectedTotal ?? 0) + rowCount;
        }
        return {};
    }

    /** Request completion closes a final open set (implicit). */
    onCompletion(): { closed?: ClosedResultSet } {
        if (this.open) {
            return { closed: this.closeOpen(undefined, true) };
        }
        return {};
    }

    private closeOpen(doneRowCount: number | undefined, implicit: boolean): ClosedResultSet {
        const open = this.open!;
        this.open = undefined;
        return {
            id: open.id,
            ordinal: open.ordinal,
            rowCount: open.rowCount,
            ...(doneRowCount !== undefined ? { doneRowCount } : {}),
            implicitClose: implicit,
        };
    }
}
