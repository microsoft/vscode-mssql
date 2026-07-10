/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Query Studio results region (doc 01 §4.4–4.6): tab strip (Results |
 * Messages), result grids, and the Messages tab whose error blocks navigate
 * the editor.
 *
 * Results-grid v2: each result set renders through the classic results
 * webview's FluentResultGrid (slickgrid-react) via the QS adapter in
 * resultsGrid.tsx — cell selection, keyboard navigation, header sort/filter,
 * column resize/freeze and copy commands ride the shared component while
 * rows keep flowing through bounded QsGetRows windows. Sizing v2 (issue A)
 * is computed by the app shell (queryStudioResultsLayout) and arrives here
 * as a per-grid body height or "fill"; per-grid maximize ⇄ restore keeps the
 * v1 caption control. Lazy grid mounting (ResultGridBlock) still gates
 * many-result-set runs on viewport proximity.
 */

import { memo, ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
    QsMessageRow,
    QsGetMessagesTextRequest,
    QsGridStyle,
    QsNavigateToLineRequest,
    QsOpenPlanRequest,
    QsResultSetSummary,
} from "../../../sharedInterfaces/queryStudio";
// Display formatting is shared with the host's Copy All builder (QO-7) so
// clipboard output stays byte-identical to the (virtualized) pane.
import {
    MESSAGE_SEPARATOR,
    MESSAGE_TIME_COLUMN_WIDTH,
    formatMessageForDisplay,
    messageLineCount,
} from "../../../sharedInterfaces/queryStudioMessages";
import type { QsGridSizing } from "../../../sharedInterfaces/queryStudioResultsLayout";
import { perfMark, perfMarkAfterNextPaint, perfMarksEnabled } from "../../common/perfMarks";
import { QsResultGridSurface, Rpc } from "./resultsGrid";

const NOTICE_DISMISS_MS = 6000;

/** Caption row shared by the live grid and the lazy placeholder. */
function GridCaption(props: {
    rpc: Rpc;
    summary: QsResultSetSummary;
    displayOrdinal: number;
    rowCount: number;
    /** Terminal runs never show "streaming…" even if a summary was missed. */
    runActive: boolean;
    /** Present when the stacked view offers maximize/restore (issue A). */
    onToggleMaximize?: (() => void) | undefined;
    maximized?: boolean | undefined;
    children?: ReactNode;
}) {
    const {
        rpc,
        summary,
        displayOrdinal,
        rowCount,
        runActive,
        onToggleMaximize,
        maximized,
        children,
    } = props;
    const streaming = runActive && !summary.complete && !summary.truncatedReason;
    return (
        <div className="qs-grid-caption">
            <span className="qs-grid-caption-title">Result {displayOrdinal}</span>
            <span className="qs-muted">
                {rowCount.toLocaleString()} row{rowCount === 1 ? "" : "s"}
                {summary.truncatedReason ? ` · truncated (${summary.truncatedReason})` : ""}
                {streaming ? " · streaming…" : ""}
            </span>
            {summary.isPlanResult ? (
                // QS-1: plan-flagged sets link out to the execution plan
                // viewer. The host answers {opened:false} silently on failure.
                <a
                    className="qs-cell-link qs-plan-link"
                    role="button"
                    title="Open in the execution plan viewer"
                    onClick={() => {
                        void rpc.sendRequest(QsOpenPlanRequest.type, {
                            resultSetId: summary.resultSetId,
                        });
                    }}>
                    Open execution plan
                </a>
            ) : null}
            {children}
            {onToggleMaximize ? (
                <button
                    className="qs-btn qs-grid-max"
                    title={
                        maximized
                            ? "Restore the stacked results view"
                            : "Maximize this grid to fill the results pane"
                    }
                    aria-label={maximized ? "Restore stacked view" : "Maximize grid"}
                    onClick={onToggleMaximize}>
                    <span
                        className={`codicon codicon-chrome-${maximized ? "restore" : "maximize"}`}
                    />
                </button>
            ) : null}
        </div>
    );
}

/** Sizing/maximize props shared by ResultGrid and ResultGridBlock (issue A). */
interface GridSizingProps {
    /** fill: the grid IS the pane (single set / maximized); height: stacked. */
    sizing: QsGridSizing;
    /** Another grid is maximized — stay mounted, render nothing visible. */
    hidden?: boolean | undefined;
    maximized?: boolean | undefined;
    onToggleMaximize?: (() => void) | undefined;
    /** The run is still executing (streaming caption + notices). */
    runActive: boolean;
}

interface GridProps extends GridSizingProps {
    rpc: Rpc;
    summary: QsResultSetSummary;
    displayOrdinal: number;
    /** Effective row count: max(state summary, QsRowsAppended accumulation). */
    rowCount: number;
    /** Grid styling from QsState (classic mssql.resultsGrid.* parity). */
    gridStyle?: QsGridStyle;
    /** Extra caption actions (e.g. the pin button, C2D-2). */
    captionExtras?: ReactNode;
}

/** One FluentResultGrid over a single result set (caption + sized body). */
export function ResultGrid(props: GridProps) {
    const { rpc, summary, rowCount, gridStyle, sizing, hidden, maximized, onToggleMaximize } =
        props;
    const [notice, setNotice] = useState<string | undefined>(undefined);
    const noticeTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
    const notify = useCallback((text: string) => {
        setNotice(text);
        if (noticeTimerRef.current) {
            clearTimeout(noticeTimerRef.current);
        }
        noticeTimerRef.current = setTimeout(() => setNotice(undefined), NOTICE_DISMISS_MS);
    }, []);
    useEffect(
        () => () => {
            if (noticeTimerRef.current) {
                clearTimeout(noticeTimerRef.current);
            }
        },
        [],
    );

    const fill = sizing.kind === "fill";
    const blockClass =
        `qs-grid-block results-grid--gridlines-${gridStyle?.showGridLines ?? "both"}` +
        (fill ? " qs-grid-fill" : "") +
        (hidden ? " qs-grid-hidden" : "");
    return (
        <div className={blockClass}>
            <GridCaption
                rpc={rpc}
                summary={summary}
                displayOrdinal={props.displayOrdinal}
                rowCount={rowCount}
                runActive={props.runActive}
                onToggleMaximize={onToggleMaximize}
                maximized={maximized}>
                {props.captionExtras}
            </GridCaption>
            {notice ? (
                <div className="qs-grid-notice" role="alert">
                    {notice}
                </div>
            ) : null}
            <div
                className="qs-grid-body"
                // Fill mode: flex sizing (CSS) — the grid IS the pane.
                style={fill ? undefined : { height: sizing.bodyPx }}>
                <QsResultGridSurface
                    rpc={rpc}
                    summary={summary}
                    rowCount={rowCount}
                    gridStyle={gridStyle}
                    notify={notify}
                />
            </div>
        </div>
    );
}

/**
 * Lazy-mount wrapper for many-result-sets runs: the caption always renders,
 * but the grid body only mounts once the block comes within ~1.5 viewports
 * of the results scroll container (IntersectionObserver, rootMargin
 * "150% 0px") — and never unmounts again. The placeholder reserves the same
 * height as the mounted body so scroll geometry stays stable.
 */
export function ResultGridBlock(props: GridProps) {
    const { rpc, summary, rowCount, hidden, maximized, onToggleMaximize } = props;
    const [mounted, setMounted] = useState(false);
    const placeholderRef = useRef<HTMLDivElement | null>(null);
    // Fill mode (single set / maximized) always mounts — it IS the pane.
    const fill = props.sizing.kind === "fill";

    useEffect(() => {
        if (mounted || fill) {
            return;
        }
        const el = placeholderRef.current;
        if (!el) {
            return;
        }
        const observer = new IntersectionObserver(
            (entries) => {
                if (entries.some((entry) => entry.isIntersecting)) {
                    setMounted(true); // never unmounts once mounted
                }
            },
            { root: el.closest(".qs-results-body"), rootMargin: "150% 0px" },
        );
        observer.observe(el);
        return () => observer.disconnect();
    }, [mounted, fill]);
    // A grid that ever filled the pane stays mounted after restore.
    useEffect(() => {
        if (fill) {
            setMounted(true);
        }
    }, [fill]);

    if (mounted || fill) {
        return <ResultGrid {...props} />;
    }
    const height = props.sizing.kind === "height" ? props.sizing.bodyPx : 0;
    return (
        <div className={`qs-grid-block${hidden ? " qs-grid-hidden" : ""}`} ref={placeholderRef}>
            <GridCaption
                rpc={rpc}
                summary={summary}
                displayOrdinal={props.displayOrdinal}
                rowCount={rowCount}
                runActive={props.runActive}
                onToggleMaximize={onToggleMaximize}
                maximized={maximized}>
                {props.captionExtras}
            </GridCaption>
            <div className="qs-grid-placeholder" style={{ height }}>
                {rowCount.toLocaleString()} row{rowCount === 1 ? "" : "s"} — scroll to load
            </div>
        </div>
    );
}

interface PreparedMessageRow {
    readonly message: QsMessageRow;
    readonly display: string;
    readonly lineNumber?: number;
    readonly lineLinkStart?: number;
    readonly lineLinkText?: string;
}

function prepareMessageForDisplay(message: QsMessageRow): PreparedMessageRow {
    const display = formatMessageForDisplay(message);
    if (!message.navigable) {
        return { message, display };
    }
    const lineLinkText = `Line ${message.navigable.line}`;
    const lineLinkStart = display.indexOf(lineLinkText);
    if (lineLinkStart < 0) {
        return { message, display };
    }

    return { message, display, lineNumber: message.navigable.line, lineLinkStart, lineLinkText };
}

function renderMessageForDisplay(
    row: PreparedMessageRow,
    navigate: (message: QsMessageRow) => void,
): ReactNode {
    if (row.lineLinkStart === undefined || row.lineLinkText === undefined) {
        return row.display;
    }

    return (
        <>
            {row.display.slice(0, row.lineLinkStart)}
            <a
                className="qs-message-line-link"
                href={`#line-${row.lineNumber}`}
                title={`Go to line ${row.lineNumber}`}
                aria-label={`Go to line ${row.lineNumber}`}
                onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    navigate(row.message);
                }}>
                {row.lineLinkText}
            </a>
            {row.display.slice(row.lineLinkStart + row.lineLinkText.length)}
        </>
    );
}

const MessageRow = memo(function MessageRow(props: {
    row: PreparedMessageRow;
    navigate: (message: QsMessageRow) => void;
}) {
    const { row, navigate } = props;
    return (
        <div
            className={`qs-message-row qs-message-${row.message.kind}`}
            aria-label={row.message.text}>
            {renderMessageForDisplay(row, navigate)}
        </div>
    );
});

/**
 * Messages tab: monospace log; error blocks navigate to the document line.
 * Server-error rows carry the SSMS "Msg N, Level L, State S, Line D" header
 * as the first line of their text. The layout mirrors the classic message
 * grid: fixed timestamp field, tight 18px rows, and rows-affected messages
 * aligned under the message column without repeating the timestamp.
 */
/** Message row pixel height per display LINE (matches .qs-message-row). */
const MESSAGE_LINE_HEIGHT_PX = 18;
/** Rows rendered beyond the viewport on each side. */
const MESSAGE_OVERSCAN_ROWS = 12;

function MessagesViewImpl(props: { rpc: Rpc; messages: QsMessageRow[] }) {
    const { rpc, messages } = props;
    // Virtualized pane (QO-7): only visible rows are prepared and mounted —
    // a 10k-PRINT flood keeps a bounded DOM and O(visible) format work.
    // Heights are line-count exact (multi-line server errors included), via
    // prefix sums rebuilt O(n) per append batch, never per scroll.
    const offsets = useMemo(() => {
        const arr = new Float64Array(messages.length + 1);
        for (let i = 0; i < messages.length; i++) {
            arr[i + 1] = arr[i] + messageLineCount(messages[i]) * MESSAGE_LINE_HEIGHT_PX;
        }
        return arr;
    }, [messages]);
    const scrollRef = useRef<HTMLDivElement | null>(null);
    const [range, setRange] = useState({ start: 0, end: 80 });
    const recompute = useCallback(() => {
        const el = scrollRef.current;
        if (!el) {
            return;
        }
        const firstVisible = lowerBound(offsets, el.scrollTop) - 1;
        const lastVisible = lowerBound(offsets, el.scrollTop + el.clientHeight);
        const start = Math.max(0, firstVisible - MESSAGE_OVERSCAN_ROWS);
        const end = Math.min(messages.length, lastVisible + MESSAGE_OVERSCAN_ROWS);
        setRange((current) =>
            current.start === start && current.end === end ? current : { start, end },
        );
    }, [offsets, messages.length]);
    useEffect(recompute, [recompute]);

    const visibleRows = useMemo(() => {
        const perfEnabled = perfMarksEnabled();
        const startedAt = perfEnabled ? performance.now() : 0;
        const rows: Array<{ index: number; row: PreparedMessageRow }> = [];
        for (let i = range.start; i < Math.min(range.end, messages.length); i++) {
            rows.push({ index: i, row: prepareMessageForDisplay(messages[i]) });
        }
        if (perfEnabled) {
            perfMark("mssql.queryStudio.messagesPrepared", {
                messages: messages.length,
                visibleRows: rows.length,
                durationMs: Math.round((performance.now() - startedAt) * 100) / 100,
            });
        }
        return rows;
    }, [messages, range]);
    useEffect(() => {
        if (messages.length > 0 && perfMarksEnabled()) {
            perfMarkAfterNextPaint("mssql.queryStudio.messagesRendered", {
                messages: messages.length,
            });
        }
    }, [messages.length]);
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
    const copyAllMessages = useCallback(() => {
        // Host-built text (QO-7): identical formatting, no webview-side join.
        void rpc
            .sendRequest<Record<string, never>, { text: string }>(QsGetMessagesTextRequest.type, {})
            .then((result) => navigator.clipboard.writeText(result.text));
    }, [rpc]);
    const totalHeight = offsets[messages.length] ?? 0;
    const topPad = offsets[Math.min(range.start, messages.length)] ?? 0;
    return (
        <div className="qs-messages-shell">
            <div className="qs-messages-toolbar">
                <button
                    type="button"
                    className="qs-btn qs-messages-copy"
                    title="Copy all messages"
                    aria-label="Copy all messages"
                    disabled={messages.length === 0}
                    onClick={copyAllMessages}>
                    <span className="codicon codicon-copy" aria-hidden="true" />
                    <span>Copy All</span>
                </button>
            </div>
            <div className="qs-messages" role="log" ref={scrollRef} onScroll={recompute}>
                <div style={{ height: totalHeight, position: "relative" }}>
                    <div style={{ position: "absolute", top: topPad, left: 0, right: 0 }}>
                        {visibleRows.map(({ index, row }) => (
                            <MessageRow key={index} row={row} navigate={navigate} />
                        ))}
                    </div>
                </div>
                {messages.length === 0 ? (
                    <div className="qs-muted qs-message-row">
                        {" ".repeat(MESSAGE_TIME_COLUMN_WIDTH + MESSAGE_SEPARATOR.length)}
                        No messages.
                    </div>
                ) : null}
            </div>
        </div>
    );
}

/** First index in the prefix-sum array with offsets[i] > value. */
function lowerBound(offsets: Float64Array, value: number): number {
    let low = 0;
    let high = offsets.length;
    while (low < high) {
        const mid = (low + high) >> 1;
        if (offsets[mid] <= value) {
            low = mid + 1;
        } else {
            high = mid;
        }
    }
    return low;
}

export const MessagesView = memo(MessagesViewImpl);
