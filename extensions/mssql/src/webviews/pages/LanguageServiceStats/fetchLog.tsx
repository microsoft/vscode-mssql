/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { CatalogFetch } from "@vscode-mssql/tsql-language-service";
import {
    Badge,
    MessageBar,
    MessageBarBody,
    Text,
    makeStyles,
    tokens,
} from "@fluentui/react-components";
import { ChevronDown16Regular, ChevronRight16Regular } from "@fluentui/react-icons";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useCallback, useRef, useState, type KeyboardEvent } from "react";

import { locConstants } from "../../common/locConstants";
import { formatMs } from "./format";
import { useTableStyles } from "./statTable";

const loc = locConstants.languageServiceStats;

/** Chevron, time, kind, scope, duration, rows, source. */
const template = "20px 92px 96px minmax(160px, 1fr) 84px 64px 76px";

/** A collapsed row, used as the starting estimate before a row measures itself. */
const estimatedRowHeight = 44;
const overscan = 8;

const useStyles = makeStyles({
    /**
     * The log is the one unbounded thing on the page -- a session can produce hundreds of fetches --
     * so it scrolls inside a fixed frame rather than pushing everything below it off the screen.
     */
    viewport: {
        maxHeight: "360px",
        overflowY: "auto",
        position: "relative",
        ":focus-visible": {
            outline: `2px solid ${tokens.colorStrokeFocus2}`,
            outlineOffset: "-2px",
        },
    },
    scope: { display: "flex", flexDirection: "column", minWidth: 0 },
    detail: {
        padding: `${tokens.spacingVerticalS} ${tokens.spacingHorizontalM}`,
        backgroundColor: tokens.colorNeutralBackground2,
        borderTop: `1px solid ${tokens.colorNeutralStroke3}`,
        display: "flex",
        flexDirection: "column",
        gap: tokens.spacingVerticalXS,
    },
    query: {
        margin: 0,
        padding: tokens.spacingHorizontalS,
        fontFamily: tokens.fontFamilyMonospace,
        fontSize: tokens.fontSizeBase200,
        backgroundColor: tokens.colorNeutralBackground3,
        borderRadius: tokens.borderRadiusSmall,
        whiteSpace: "pre-wrap",
        wordBreak: "break-word",
        overflowX: "auto",
    },
});

/**
 * What this document loaded, newest first.
 *
 * The rows a reader looks for first are the failures and the slow ones, so the outcome is a badge
 * rather than another column of text, and the query is one keystroke away rather than behind a
 * separate view.
 *
 * Virtualized because the log is bounded only by how long the session ran. Rows measure themselves
 * rather than assuming a fixed height, since an expanded row carries a query of unknown length and a
 * fixed estimate would leave it overlapping its neighbour.
 */
export const FetchLog = ({ fetches }: { fetches: readonly CatalogFetch[] }) => {
    const table = useTableStyles();
    const styles = useStyles();
    const [expanded, setExpanded] = useState<string | undefined>(undefined);
    const [activeIndex, setActiveIndex] = useState(0);
    const viewportRef = useRef<HTMLDivElement | undefined>(undefined);

    const virtualizer = useVirtualizer({
        count: fetches.length,
        getScrollElement: () => viewportRef.current ?? null,
        estimateSize: () => estimatedRowHeight,
        overscan,
    });

    // Arrow keys move between rows, which a virtualized list has to do for itself: the row a reader
    // is moving to may not be rendered yet, so focus follows the scroll rather than the other way
    // round.
    const onKeyDown = useCallback(
        (event: KeyboardEvent<HTMLDivElement>) => {
            if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
            event.preventDefault();
            const next = Math.min(
                Math.max(activeIndex + (event.key === "ArrowDown" ? 1 : -1), 0),
                fetches.length - 1,
            );
            setActiveIndex(next);
            virtualizer.scrollToIndex(next);
            requestAnimationFrame(() => {
                viewportRef.current
                    ?.querySelector<HTMLButtonElement>(`[data-row-index="${next}"] button`)
                    ?.focus();
            });
        },
        [activeIndex, fetches.length, virtualizer],
    );

    if (fetches.length === 0) {
        return (
            <MessageBar intent="info">
                <MessageBarBody>{loc.noFetches}</MessageBarBody>
            </MessageBar>
        );
    }

    return (
        <div className={table.table} role="table" aria-label={loc.fetchLog}>
            <div className={table.headerRow} style={{ gridTemplateColumns: template }} role="row">
                <span />
                {[loc.columnTime, loc.columnSection, loc.columnScope].map((label) => (
                    <Text key={label} size={200} role="columnheader" className={table.headerText}>
                        {label}
                    </Text>
                ))}
                {[loc.columnDuration, loc.columnRows, loc.columnSource].map((label) => (
                    <Text
                        key={label}
                        size={200}
                        role="columnheader"
                        className={`${table.headerText} ${table.numeric}`}>
                        {label}
                    </Text>
                ))}
            </div>
            <div
                ref={(node) => {
                    viewportRef.current = node ?? undefined;
                }}
                className={styles.viewport}
                role="rowgroup"
                aria-rowcount={fetches.length}
                onKeyDown={onKeyDown}>
                <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
                    {virtualizer.getVirtualItems().map((virtualRow) => {
                        const fetch = fetches[virtualRow.index]!;
                        const key = `${fetch.at}-${virtualRow.index}`;
                        const isOpen = expanded === key;
                        const hasDetail = Boolean(fetch.query || fetch.error);
                        return (
                            <div
                                key={key}
                                data-index={virtualRow.index}
                                data-row-index={virtualRow.index}
                                ref={virtualizer.measureElement}
                                style={{
                                    position: "absolute",
                                    top: 0,
                                    left: 0,
                                    width: "100%",
                                    transform: `translateY(${virtualRow.start}px)`,
                                }}>
                                <button
                                    type="button"
                                    className={table.rowButton}
                                    style={{ gridTemplateColumns: template }}
                                    role="row"
                                    aria-rowindex={virtualRow.index + 1}
                                    aria-expanded={hasDetail ? isOpen : undefined}
                                    tabIndex={virtualRow.index === activeIndex ? 0 : -1}
                                    disabled={!hasDetail}
                                    onFocus={() => setActiveIndex(virtualRow.index)}
                                    onClick={() => setExpanded(isOpen ? undefined : key)}>
                                    {hasDetail ? (
                                        isOpen ? (
                                            <ChevronDown16Regular />
                                        ) : (
                                            <ChevronRight16Regular />
                                        )
                                    ) : (
                                        <span />
                                    )}
                                    <Text size={200} className={`${table.subtle} ${table.mono}`}>
                                        {clockTime(fetch.at)}
                                    </Text>
                                    <Text size={200} className={table.truncate}>
                                        {fetch.section}
                                    </Text>
                                    <span className={styles.scope}>
                                        <Text
                                            size={200}
                                            className={`${table.mono} ${table.truncate}`}>
                                            {scopeLabel(fetch)}
                                        </Text>
                                        <Text
                                            size={100}
                                            className={`${table.subtle} ${table.truncate}`}>
                                            {fetch.trigger}
                                        </Text>
                                    </span>
                                    <Text size={200} className={table.numeric}>
                                        {loc.milliseconds(formatMs(fetch.elapsedMs))}
                                    </Text>
                                    <Text size={200} className={`${table.numeric} ${table.subtle}`}>
                                        {fetch.rowCount === undefined
                                            ? "—"
                                            : String(fetch.rowCount)}
                                    </Text>
                                    <span className={table.numeric}>
                                        <OutcomeBadge fetch={fetch} />
                                    </span>
                                </button>
                                {isOpen && hasDetail && (
                                    <div className={styles.detail}>
                                        {fetch.error && (
                                            <MessageBar intent="error">
                                                <MessageBarBody>
                                                    {fetch.error.code === undefined
                                                        ? fetch.error.message
                                                        : `${fetch.error.code}: ${fetch.error.message}`}
                                                </MessageBarBody>
                                            </MessageBar>
                                        )}
                                        {fetch.query && (
                                            <>
                                                <Text size={200} className={table.subtle}>
                                                    {loc.queryHeading}
                                                </Text>
                                                <pre className={styles.query}>{fetch.query}</pre>
                                            </>
                                        )}
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            </div>
        </div>
    );
};

const OutcomeBadge = ({ fetch }: { fetch: CatalogFetch }) => {
    if (fetch.outcome === "failed" || fetch.outcome === "denied") {
        return (
            <Badge appearance="tint" color="danger">
                {loc.outcomeFailed}
            </Badge>
        );
    }
    if (fetch.outcome === "cancelled") {
        return (
            <Badge appearance="tint" color="informative">
                {loc.outcomeCancelled}
            </Badge>
        );
    }
    if (fetch.outcome === "empty") {
        return (
            <Badge appearance="tint" color="warning">
                {loc.outcomeEmpty}
            </Badge>
        );
    }
    return (
        <Badge appearance="tint" color={fetch.source === "resident" ? "subtle" : "brand"}>
            {fetch.source === "resident" ? loc.sourceResident : loc.sourceServer}
        </Badge>
    );
};

/**
 * The database and object a fetch covered.
 *
 * A connection's first queries run before the server has said which database it opened, so there is
 * genuinely no name to show for them. That reads better as an em dash than as the internal handle,
 * which looks like a defect; the handle stays in the exported log, where it is what correlates rows.
 */
function scopeLabel(fetch: CatalogFetch): string {
    const database =
        fetch.databaseName ?? (fetch.databaseHandle === "db:unknown" ? "—" : fetch.databaseHandle);
    return fetch.objectName ? `${database} · ${fetch.objectName}` : database;
}

function clockTime(epochMs: number): string {
    const at = new Date(epochMs);
    const pad = (value: number, width = 2) => String(value).padStart(width, "0");
    return `${pad(at.getHours())}:${pad(at.getMinutes())}:${pad(at.getSeconds())}.${pad(
        at.getMilliseconds(),
        3,
    )}`;
}
