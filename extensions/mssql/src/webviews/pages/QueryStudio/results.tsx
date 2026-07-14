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

import {
    memo,
    ReactNode,
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState,
    type RefObject,
} from "react";
import {
    QsMessageRow,
    QsCopyMessagesToClipboardRequest,
    type QsCopyMessagesResult,
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
    updateQueryStudioMessageOffsetIndex,
    type QueryStudioMessageOffsetIndex,
} from "../../../sharedInterfaces/queryStudioMessages";
import type { QsGridSizing } from "../../../sharedInterfaces/queryStudioResultsLayout";
import type {
    QsMessageSelectionPoint,
    QsMessagesPanelViewState,
} from "../../../sharedInterfaces/queryStudioViewState";
import { perfMark, perfMarkAfterNextPaint, perfMarksEnabled } from "../../common/perfMarks";
import { QsResultGridSurface, Rpc } from "./resultsGrid";
import type { FluentResultGridState } from "../../common/FluentResultGrid";
import {
    registerQueryStudioPerfMessagesController,
    type QueryStudioPerfInteractionOutcome,
} from "./queryStudioPerfInteraction";

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
    /** Panel-local state restored when this result surface is recreated. */
    initialGridState?: FluentResultGridState;
    onGridStateChange?: (state: FluentResultGridState) => void;
    /** Stable observation target shared by the live grid and placeholder. */
    blockRef?: RefObject<HTMLDivElement | null>;
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
        <div className={blockClass} ref={props.blockRef}>
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
                    initialState={props.initialGridState}
                    onStateChange={props.onGridStateChange}
                />
            </div>
        </div>
    );
}

/**
 * Lazy-mount wrapper for many-result-sets runs: the caption always renders,
 * but the grid body only mounts once the block comes within ~1.5 viewports
 * of the results scroll container (IntersectionObserver, rootMargin
 * "150% 0px"). Blocks outside that warm band return to equal-height
 * placeholders; the latest grid state is retained locally for reconstruction.
 */
export function ResultGridBlock(props: GridProps) {
    const { rpc, summary, rowCount, hidden, maximized, onToggleMaximize } = props;
    const [mounted, setMounted] = useState(false);
    const blockRef = useRef<HTMLDivElement | null>(null);
    const mountedRef = useRef(false);
    const latestGridStateRef = useRef(props.initialGridState);
    // Fill mode (single set / maximized) always mounts — it IS the pane.
    const fill = props.sizing.kind === "fill";

    const handleGridStateChange = useCallback(
        (state: FluentResultGridState) => {
            latestGridStateRef.current = state;
            props.onGridStateChange?.(state);
        },
        [props.onGridStateChange],
    );

    useEffect(() => {
        if (fill) {
            mountedRef.current = true;
            setMounted(true);
            return;
        }
        const el = blockRef.current;
        if (!el) {
            return;
        }
        const observer = new IntersectionObserver(
            (entries) => {
                const nextMounted = entries.some((entry) => entry.isIntersecting);
                if (mountedRef.current !== nextMounted) {
                    mountedRef.current = nextMounted;
                    perfMark("mssql.queryStudio.results.block.visibility", {
                        resultSetId: summary.resultSetId,
                        mounted: nextMounted,
                        reason: "viewport",
                    });
                    setMounted(nextMounted);
                }
            },
            {
                root: el.closest(".qs-tab-panel") ?? el.closest(".qs-results-body"),
                rootMargin: "150% 0px",
            },
        );
        observer.observe(el);
        return () => observer.disconnect();
    }, [fill, mounted, summary.resultSetId]);

    if (mounted || fill) {
        return (
            <ResultGrid
                {...props}
                blockRef={blockRef}
                initialGridState={latestGridStateRef.current}
                onGridStateChange={handleGridStateChange}
            />
        );
    }
    const height = props.sizing.kind === "height" ? props.sizing.bodyPx : 0;
    return (
        <div className={`qs-grid-block${hidden ? " qs-grid-hidden" : ""}`} ref={blockRef}>
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
    index: number;
    row: PreparedMessageRow;
    navigate: (message: QsMessageRow) => void;
}) {
    const { index, row, navigate } = props;
    return (
        <div
            className={`qs-message-row qs-message-${row.message.kind}`}
            data-message-index={index}
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

function MessagesViewImpl(props: {
    rpc: Rpc;
    messages: QsMessageRow[];
    active?: boolean;
    initialViewState?: QsMessagesPanelViewState;
    onViewStateChange?: (state: QsMessagesPanelViewState) => void;
}) {
    const { rpc, messages, active = true, initialViewState, onViewStateChange } = props;
    // Virtualized pane (QO-7): only visible rows are prepared and mounted —
    // a 10k-PRINT flood keeps a bounded DOM and O(visible) format work.
    // Heights are line-count exact (multi-line server errors included). The
    // append-only index extends in O(new messages); a new run rebuilds once.
    const offsetIndexRef = useRef<QueryStudioMessageOffsetIndex>({
        messages: [],
        offsets: [0],
    });
    offsetIndexRef.current = updateQueryStudioMessageOffsetIndex(
        offsetIndexRef.current,
        messages,
        MESSAGE_LINE_HEIGHT_PX,
    );
    const offsets = offsetIndexRef.current.offsets;
    const scrollRef = useRef<HTMLDivElement | null>(null);
    const selectionRef = useRef(initialViewState?.selection);
    const restoredInitialScrollRef = useRef(false);
    const [copyInProgress, setCopyInProgress] = useState(false);
    const copyInProgressRef = useRef(false);
    const [copyNotice, setCopyNotice] = useState<string | undefined>(undefined);
    const copyNoticeTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
    const notifyCopy = useCallback((text: string) => {
        setCopyNotice(text);
        if (copyNoticeTimerRef.current) {
            clearTimeout(copyNoticeTimerRef.current);
        }
        copyNoticeTimerRef.current = setTimeout(() => setCopyNotice(undefined), NOTICE_DISMISS_MS);
    }, []);
    useEffect(
        () => () => {
            if (copyNoticeTimerRef.current) {
                clearTimeout(copyNoticeTimerRef.current);
            }
        },
        [],
    );
    const restoreSelectionPendingRef = useRef(active);
    const previousActiveRef = useRef(active);
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
    useEffect(() => {
        const el = scrollRef.current;
        if (!el) {
            return;
        }
        if (!restoredInitialScrollRef.current) {
            const restoreNeedsHydratedMessages =
                messages.length === 0 &&
                ((initialViewState?.scrollTop ?? 0) > 0 ||
                    initialViewState?.selection !== undefined);
            if (restoreNeedsHydratedMessages) {
                return;
            }
            restoredInitialScrollRef.current = true;
            el.scrollTop = initialViewState?.scrollTop ?? 0;
        }
        recompute();
    }, [initialViewState?.scrollTop, recompute]);

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
    const copyAllMessages = useCallback(async (): Promise<QueryStudioPerfInteractionOutcome> => {
        if (copyInProgressRef.current) {
            return "alreadySelected";
        }
        copyInProgressRef.current = true;
        const started = performance.now();
        perfMark("mssql.queryStudio.messages.copy.begin", { visibleMessages: messages.length });
        setCopyInProgress(true);
        try {
            // The host builds and writes the bounded exact payload. Only its
            // aggregate result crosses the webview boundary, so a message flood
            // never duplicates the complete text in renderer memory.
            const result = await rpc.sendRequest<Record<string, never>, QsCopyMessagesResult>(
                QsCopyMessagesToClipboardRequest.type,
                {},
            );
            const outcome: QueryStudioPerfInteractionOutcome =
                result.outcome === "copied"
                    ? "applied"
                    : result.outcome === "tooLarge"
                      ? "copyTooLarge"
                      : "copyEmpty";
            if (result.outcome === "tooLarge") {
                notifyCopy(
                    result.reason === "messages"
                        ? "Too many messages to copy at once."
                        : "Messages are too large to copy at once.",
                );
            }
            perfMark("mssql.queryStudio.messages.copy.end", {
                outcome: result.outcome,
                messages: result.messages,
                characters: result.characters,
                buildMs: result.buildMs,
                clipboardMs: result.clipboardMs,
                copyRoute: "hostDirect",
                ...(result.reason ? { reason: result.reason } : {}),
                durationMs: Math.max(0, performance.now() - started),
            });
            return outcome;
        } catch {
            notifyCopy("Couldn't copy messages. Please try again.");
            perfMark("mssql.queryStudio.messages.copy.end", {
                outcome: "error",
                messages: messages.length,
                characters: 0,
                buildMs: 0,
                clipboardMs: 0,
                copyRoute: "hostDirect",
                durationMs: Math.max(0, performance.now() - started),
            });
            return "copyFailed";
        } finally {
            copyInProgressRef.current = false;
            setCopyInProgress(false);
        }
    }, [messages.length, notifyCopy, rpc]);
    useEffect(
        () => registerQueryStudioPerfMessagesController({ copyAll: copyAllMessages }),
        [copyAllMessages],
    );
    const totalHeight = offsets[messages.length] ?? 0;
    const topPad = offsets[Math.min(range.start, messages.length)] ?? 0;
    const emitViewState = useCallback(() => {
        onViewStateChange?.({
            scrollTop: scrollRef.current?.scrollTop ?? 0,
            ...(selectionRef.current ? { selection: selectionRef.current } : {}),
        });
    }, [onViewStateChange]);
    const onScroll = useCallback(() => {
        recompute();
        emitViewState();
    }, [emitViewState, recompute]);

    useEffect(() => {
        const shell = scrollRef.current;
        if (!shell) {
            return;
        }
        const onSelectionChange = () => {
            const selection = document.getSelection();
            if (!selection || selection.rangeCount === 0) {
                return;
            }
            if (selection.isCollapsed) {
                // A click inside Messages explicitly clears its bookmark. A
                // tab click collapses selection outside this shell and must
                // retain the last in-pane bookmark for restoration.
                if (logicalMessagePoint(shell, selection.anchorNode, selection.anchorOffset)) {
                    selectionRef.current = undefined;
                    emitViewState();
                }
                return;
            }
            const anchor = logicalMessagePoint(shell, selection.anchorNode, selection.anchorOffset);
            const focus = logicalMessagePoint(shell, selection.focusNode, selection.focusOffset);
            if (!anchor || !focus) {
                // A tab click moves selection outside this pane. Keep the last
                // in-pane bookmark instead of overwriting it with that collapse.
                return;
            }
            selectionRef.current = { anchor, focus };
            emitViewState();
        };
        document.addEventListener("selectionchange", onSelectionChange);
        return () => document.removeEventListener("selectionchange", onSelectionChange);
    }, [emitViewState]);

    useEffect(() => {
        if (active && !previousActiveRef.current) {
            restoreSelectionPendingRef.current = true;
        }
        previousActiveRef.current = active;
        if (!active || !restoreSelectionPendingRef.current || !selectionRef.current) {
            return;
        }
        const shell = scrollRef.current;
        if (!shell) {
            return;
        }
        const { anchor, focus } = selectionRef.current;
        const anchorRow = shell.querySelector<HTMLElement>(
            `[data-message-index="${anchor.messageIndex}"]`,
        );
        const focusRow = shell.querySelector<HTMLElement>(
            `[data-message-index="${focus.messageIndex}"]`,
        );
        if (!anchorRow || !focusRow) {
            return;
        }
        const anchorDom = domPointForMessageOffset(anchorRow, anchor.offset);
        const focusDom = domPointForMessageOffset(focusRow, focus.offset);
        const selection = document.getSelection();
        if (!selection || !anchorDom || !focusDom) {
            return;
        }
        selection.setBaseAndExtent(
            anchorDom.node,
            anchorDom.offset,
            focusDom.node,
            focusDom.offset,
        );
        restoreSelectionPendingRef.current = false;
    }, [active, range, visibleRows]);

    return (
        <div className="qs-messages-shell">
            <div className="qs-messages-toolbar">
                <button
                    type="button"
                    className="qs-btn qs-messages-copy"
                    title="Copy all messages"
                    aria-label="Copy all messages"
                    disabled={messages.length === 0 || copyInProgress}
                    onClick={() => void copyAllMessages()}>
                    <span className="codicon codicon-copy" aria-hidden="true" />
                    <span>Copy All</span>
                </button>
            </div>
            {copyNotice ? (
                <div className="qs-grid-notice" role="alert">
                    {copyNotice}
                </div>
            ) : null}
            <div className="qs-messages" role="log" ref={scrollRef} onScroll={onScroll}>
                <div style={{ height: totalHeight, position: "relative" }}>
                    <div style={{ position: "absolute", top: topPad, left: 0, right: 0 }}>
                        {visibleRows.map(({ index, row }) => (
                            <MessageRow key={index} index={index} row={row} navigate={navigate} />
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

function logicalMessagePoint(
    shell: HTMLElement,
    node: Node | null,
    offset: number,
): QsMessageSelectionPoint | undefined {
    const element = node instanceof Element ? node : node?.parentElement;
    const row = element?.closest<HTMLElement>("[data-message-index]");
    if (!row || !shell.contains(row)) {
        return undefined;
    }
    const messageIndex = Number(row.dataset.messageIndex);
    if (!Number.isInteger(messageIndex) || messageIndex < 0) {
        return undefined;
    }
    try {
        const range = document.createRange();
        range.selectNodeContents(row);
        range.setEnd(node!, offset);
        return { messageIndex, offset: range.toString().length };
    } catch {
        return undefined;
    }
}

function domPointForMessageOffset(
    row: HTMLElement,
    requestedOffset: number,
): { node: Node; offset: number } | undefined {
    const walker = document.createTreeWalker(row, NodeFilter.SHOW_TEXT);
    let remaining = Math.max(0, requestedOffset);
    let last: Text | undefined;
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const text = node as Text;
        last = text;
        if (remaining <= text.data.length) {
            return { node: text, offset: remaining };
        }
        remaining -= text.data.length;
    }
    return last ? { node: last, offset: last.data.length } : { node: row, offset: 0 };
}

/** First index in the prefix-sum array with offsets[i] > value. */
function lowerBound(offsets: readonly number[], value: number): number {
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
