/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Query Studio results region (doc 01 §4.4–4.6): tab strip (Results |
 * Messages), stacked virtualized grids (24px rows) pulling cell windows via
 * QsGetRows (rows NEVER ride notifications — counts only trigger refetch),
 * follow-tail with a "rows added" chip when unpinned, NULL styling from the
 * null bitmap, and a Messages tab whose error blocks navigate the editor.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
    QsCellWindow,
    QsGetRowsRequest,
    QsMessageRow,
    QsNavigateToLineRequest,
    QsResultSetSummary,
} from "../../../sharedInterfaces/queryStudio";

const ROW_HEIGHT = 24;
const HEADER_HEIGHT = 24;
const OVERSCAN_ROWS = 10;
const MAX_GRID_ROWS_VISIBLE = 14;

interface Rpc {
    sendRequest<P, R>(type: { method: string }, params: P): Promise<R>;
}

function isNullCell(window: QsCellWindow, rowInWindow: number, col: number): boolean {
    if (!window.nullBitmap) {
        return window.values[rowInWindow]?.[col] === null;
    }
    const index = rowInWindow * window.columns.length + col;
    const bytes = atob(window.nullBitmap);
    const byteIndex = index >> 3;
    return byteIndex < bytes.length && (bytes.charCodeAt(byteIndex) & (1 << (index & 7))) !== 0;
}

function cellText(value: unknown): string {
    if (value === undefined || value === null) {
        return "NULL";
    }
    if (typeof value === "object") {
        return JSON.stringify(value);
    }
    return String(value);
}

/** One virtualized grid over a single result set. */
export function ResultGrid(props: {
    rpc: Rpc;
    summary: QsResultSetSummary;
    /** Bumped by QsRowsAppended for this set — triggers window refresh. */
    version: number;
}) {
    const { rpc, summary, version } = props;
    const containerRef = useRef<HTMLDivElement | null>(null);
    const [window_, setWindow] = useState<QsCellWindow | undefined>(undefined);
    const [scrollTop, setScrollTop] = useState(0);
    const [pinned, setPinned] = useState(true);
    const [unseenRows, setUnseenRows] = useState(0);
    const lastCountRef = useRef(summary.rowCount);
    const fetchSeqRef = useRef(0);

    const viewportRows = Math.min(summary.rowCount, MAX_GRID_ROWS_VISIBLE);
    const viewportHeight = viewportRows * ROW_HEIGHT + HEADER_HEIGHT + 2;

    const fetchWindow = useCallback(
        (top: number) => {
            const first = Math.max(0, Math.floor(top / ROW_HEIGHT) - OVERSCAN_ROWS);
            const count = viewportRows + OVERSCAN_ROWS * 2;
            const seq = ++fetchSeqRef.current;
            void rpc
                .sendRequest<
                    { resultSetId: string; start: number; count: number },
                    QsCellWindow
                >(QsGetRowsRequest.type, { resultSetId: summary.resultSetId, start: first, count })
                .then((result) => {
                    if (seq === fetchSeqRef.current) {
                        setWindow(result);
                    }
                });
        },
        [rpc, summary.resultSetId, viewportRows],
    );

    // Refetch when rows arrive: follow-tail if pinned, else count unseen.
    useEffect(() => {
        const container = containerRef.current;
        const added = summary.rowCount - lastCountRef.current;
        lastCountRef.current = summary.rowCount;
        if (pinned && container) {
            const bottom = Math.max(0, summary.rowCount * ROW_HEIGHT - viewportRows * ROW_HEIGHT);
            container.scrollTop = bottom;
            fetchWindow(bottom);
        } else {
            if (added > 0) {
                setUnseenRows((n) => n + added);
            }
            fetchWindow(scrollTop);
        }
    }, [version, summary.rowCount]);

    const onScroll = useCallback(
        (e: React.UIEvent<HTMLDivElement>) => {
            const top = e.currentTarget.scrollTop;
            setScrollTop(top);
            const atBottom =
                top + e.currentTarget.clientHeight >= e.currentTarget.scrollHeight - ROW_HEIGHT;
            setPinned(atBottom);
            if (atBottom) {
                setUnseenRows(0);
            }
            requestAnimationFrame(() => fetchWindow(top));
        },
        [fetchWindow],
    );

    const jumpToTail = useCallback(() => {
        setPinned(true);
        setUnseenRows(0);
        const container = containerRef.current;
        if (container) {
            container.scrollTop = container.scrollHeight;
            fetchWindow(container.scrollTop);
        }
    }, [fetchWindow]);

    const firstRendered = window_?.start ?? 0;

    return (
        <div className="qs-grid-block">
            <div className="qs-grid-caption">
                <span className="qs-grid-caption-title">
                    Result {summary.batchOrdinal + 1}.{summary.resultSetId.split("s").pop()}
                </span>
                <span className="qs-muted">
                    {summary.rowCount.toLocaleString()} row{summary.rowCount === 1 ? "" : "s"}
                    {summary.truncatedReason ? ` · truncated (${summary.truncatedReason})` : ""}
                    {!summary.complete && !summary.truncatedReason ? " · streaming…" : ""}
                </span>
                {unseenRows > 0 ? (
                    <button className="qs-chip" onClick={jumpToTail}>
                        ↓ {unseenRows.toLocaleString()} new rows
                    </button>
                ) : null}
            </div>
            <div
                ref={containerRef}
                className="qs-grid-viewport"
                style={{ height: viewportHeight }}
                onScroll={onScroll}>
                <table
                    className="qs-grid-table"
                    style={{ height: HEADER_HEIGHT + summary.rowCount * ROW_HEIGHT }}>
                    <thead>
                        <tr>
                            <th className="qs-grid-rownum" />
                            {summary.columnNames.map((name, i) => (
                                <th key={i}>{name || `(col ${i + 1})`}</th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {window_ ? (
                            <>
                                {/* Spacer row positions the fetched window. */}
                                {firstRendered > 0 ? (
                                    <tr style={{ height: firstRendered * ROW_HEIGHT }}>
                                        <td colSpan={summary.columnNames.length + 1} />
                                    </tr>
                                ) : null}
                                {window_.values.map((row, r) => (
                                    <tr key={firstRendered + r} className="qs-grid-row">
                                        <td className="qs-grid-rownum">{firstRendered + r + 1}</td>
                                        {row.map((cell, c) => {
                                            const isNull =
                                                cell === undefined || cell === null
                                                    ? isNullCell(window_, r, c) || true
                                                    : false;
                                            return (
                                                <td
                                                    key={c}
                                                    className={isNull ? "qs-cell-null" : undefined}
                                                    title={isNull ? "NULL" : cellText(cell)}>
                                                    {isNull ? "NULL" : cellText(cell)}
                                                </td>
                                            );
                                        })}
                                    </tr>
                                ))}
                            </>
                        ) : null}
                    </tbody>
                </table>
            </div>
        </div>
    );
}

/** Messages tab: monospace log; error blocks navigate to the document line. */
export function MessagesView(props: { rpc: Rpc; messages: QsMessageRow[] }) {
    const { rpc, messages } = props;
    const navigate = useCallback(
        (message: QsMessageRow) => {
            if (message.navigable) {
                void rpc.sendRequest(QsNavigateToLineRequest.type, {
                    line: message.navigable.line,
                    column: message.navigable.column,
                });
            }
        },
        [rpc],
    );
    return (
        <div className="qs-messages" role="log">
            {messages.map((message, i) => (
                <div
                    key={i}
                    className={`qs-message qs-message-${message.kind}${message.navigable ? " qs-message-nav" : ""}`}
                    onClick={() => navigate(message)}
                    title={message.navigable ? "Go to line" : undefined}>
                    {message.server?.number !== undefined ? (
                        <span className="qs-message-server">
                            Msg {message.server.number}, Level {message.server.severity ?? 0}
                            {message.server.line !== undefined
                                ? `, Line ${message.server.line}`
                                : ""}
                            {": "}
                        </span>
                    ) : null}
                    {message.text}
                </div>
            ))}
            {messages.length === 0 ? <div className="qs-muted qs-message">No messages.</div> : null}
        </div>
    );
}
