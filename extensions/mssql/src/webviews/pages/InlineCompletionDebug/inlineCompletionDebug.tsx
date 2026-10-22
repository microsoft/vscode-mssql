/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { locConstants } from "../../common/locConstants";
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Button, Text, makeStyles, shorthands } from "@fluentui/react-components";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import { InlineCompletionDebugEvent } from "../../../sharedInterfaces/inlineCompletionDebug";
import { useInlineCompletionDebugContext } from "./inlineCompletionDebugStateProvider";
import { useInlineCompletionDebugSelector } from "./inlineCompletionDebugSelector";
import { InlineCompletionDebugToolbar } from "./components/Toolbar";
import { InlineCompletionDebugEventGrid } from "./components/EventGrid";
import { InlineCompletionDebugDetailPane } from "./components/DetailPane";
import { CustomPromptDialog } from "./components/CustomPromptDialog";

const useStyles = makeStyles({
    root: {
        display: "flex",
        flexDirection: "column",
        height: "100%",
        width: "100%",
        backgroundColor: "var(--vscode-editor-background)",
        color: "var(--vscode-foreground)",
        ...shorthands.overflow("hidden"),
    },
    panelGroup: {
        ...shorthands.flex(1),
        minHeight: 0,
    },
    resizeHandle: {
        height: "2px",
        backgroundColor: "var(--vscode-panel-border)",
    },
    topPanel: {
        display: "flex",
        flexDirection: "column",
        minHeight: 0,
        height: "100%",
    },
    detailPanel: {
        minHeight: 0,
        height: "100%",
        backgroundColor: "var(--vscode-editor-background)",
    },
    runStrip: {
        display: "grid",
        gridTemplateColumns: "minmax(0, 1fr) auto",
        alignItems: "center",
        gap: "12px",
        minHeight: "40px",
        flexShrink: 0,
        backgroundColor: "var(--vscode-button-background)",
        color: "var(--vscode-button-foreground)",
        ...shorthands.padding("0", "12px"),
    },
    runMeta: {
        display: "flex",
        alignItems: "center",
        gap: "10px",
        minWidth: 0,
        fontFamily: "var(--vscode-editor-font-family, Consolas, monospace)",
    },
    progressTrack: {
        height: "4px",
        width: "260px",
        maxWidth: "24vw",
        backgroundColor: "color-mix(in srgb, var(--vscode-button-foreground) 22%, transparent)",
        ...shorthands.borderRadius("999px"),
        overflow: "hidden",
    },
    progressFill: {
        height: "100%",
        backgroundColor: "var(--vscode-button-foreground)",
    },
    cancelRunButton: {
        color: "var(--vscode-button-foreground)",
        ...shorthands.borderColor(
            "color-mix(in srgb, var(--vscode-button-foreground) 55%, transparent)",
        ),
    },
    // Honest partial-stream state (addendum §2.2): oldest events fell out of
    // the bounded live ring — a compact inline notice, not a dialog.
    truncationStrip: {
        display: "flex",
        alignItems: "center",
        minHeight: "22px",
        flexShrink: 0,
        color: "var(--vscode-descriptionForeground)",
        fontFamily: "var(--vscode-editor-font-family, Consolas, monospace)",
        fontSize: "11px",
        ...shorthands.padding("0", "12px"),
        ...shorthands.borderBottom("1px", "solid", "var(--vscode-panel-border)"),
    },
});

export const InlineCompletionDebugPage = () => {
    const classes = useStyles();
    const { cancelReplayRun, selectEvent } = useInlineCompletionDebugContext();
    const events = useInlineCompletionDebugSelector((state) => state.events);
    const liveEvictedCount = useInlineCompletionDebugSelector(
        (state) => state.liveEvictedCount ?? 0,
    );
    const replay = useInlineCompletionDebugSelector((state) => state.replay);
    const selectedEventId = useInlineCompletionDebugSelector((state) => state.selectedEventId);
    const toolbarState = useInlineCompletionDebugSelector((state) => state);
    const [filterQuery, setFilterQuery] = useState("");
    const [autoScroll, setAutoScroll] = useState(true);
    const [gridResizeToken, setGridResizeToken] = useState(0);
    const filterInputRef = useRef<HTMLInputElement | null>(null);
    const pendingFilterFocusRestoreRef = useRef<FilterFocusRestoreState | undefined>(undefined);

    const filterResult = useMemo(() => parseFilterQuery(filterQuery), [filterQuery]);
    const displayEvents = useMemo(
        () => [...events, ...replay.queueRows.map((row) => row.event)],
        [events, replay.queueRows],
    );
    const filteredEvents = useMemo(() => {
        if (filterResult.error) {
            return [];
        }
        return displayEvents.filter(filterResult.predicate);
    }, [displayEvents, filterResult]);
    const selectedEvent = useMemo(
        () => displayEvents.find((event) => event.id === selectedEventId),
        [displayEvents, selectedEventId],
    );
    const summary = useMemo(() => {
        const documents = new Set(filteredEvents.map((event) => event.documentFileName));
        const completedEvents = filteredEvents.filter(
            (event) => event.result !== "pending" && event.result !== "queued",
        );
        const averageLatency =
            completedEvents.length > 0
                ? Math.round(
                      completedEvents.reduce((sum, event) => sum + event.latencyMs, 0) /
                          completedEvents.length,
                  )
                : 0;
        return {
            eventCount: filteredEvents.length,
            documentCount: documents.size,
            averageLatency,
        };
    }, [filteredEvents]);
    const activeRun = replay.runs.find((run) => run.id === replay.activeRunId);
    // "cancelling" stays visible: the active item is still settling and the
    // user must see that the cancel is in progress (honesty, WI-3.5 fix —
    // the strip previously vanished the moment cancel was pressed).
    const activeRunIsVisible =
        !!activeRun &&
        (activeRun.status === "queued" ||
            activeRun.status === "running" ||
            activeRun.status === "cancelling");
    const activeRunCancelling = activeRun?.status === "cancelling";
    const activeMatrixCell = activeRun?.matrixCells?.find(
        (cell) => cell.cellId === activeRun.activeMatrixCellId,
    );

    const restoreFilterInputFocus = useCallback(() => {
        const focusState = pendingFilterFocusRestoreRef.current;
        const filterInput = filterInputRef.current;
        if (!focusState || !filterInput) {
            return;
        }

        if (document.activeElement !== filterInput) {
            filterInput.focus({ preventScroll: true });
        }

        if (focusState.selectionStart !== null && focusState.selectionEnd !== null) {
            filterInput.setSelectionRange(
                focusState.selectionStart,
                focusState.selectionEnd,
                focusState.selectionDirection ?? undefined,
            );
        }
    }, []);

    const handleFilterQueryChange = useCallback((value: string) => {
        const filterInput = filterInputRef.current;
        pendingFilterFocusRestoreRef.current =
            filterInput && document.activeElement === filterInput
                ? {
                      selectionStart: filterInput.selectionStart,
                      selectionEnd: filterInput.selectionEnd,
                      selectionDirection: filterInput.selectionDirection,
                  }
                : undefined;
        setFilterQuery(value);
    }, []);

    useLayoutEffect(() => {
        restoreFilterInputFocus();

        const restoreFocusFrame = requestAnimationFrame(() => {
            restoreFilterInputFocus();
            pendingFilterFocusRestoreRef.current = undefined;
        });

        return () => cancelAnimationFrame(restoreFocusFrame);
    }, [filterQuery, filteredEvents.length, restoreFilterInputFocus]);

    return (
        <div className={classes.root}>
            <InlineCompletionDebugToolbar
                state={toolbarState}
                filterInputRef={filterInputRef}
                filterQuery={filterQuery}
                onFilterQueryChange={handleFilterQueryChange}
                filterWarning={filterResult.error}
                summary={summary}
                autoScroll={autoScroll}
                onAutoScrollChange={setAutoScroll}
            />

            <PanelGroup
                direction="vertical"
                className={classes.panelGroup}
                onLayout={() => setGridResizeToken((value) => value + 1)}>
                <Panel defaultSize={56} minSize={28}>
                    <div className={classes.topPanel}>
                        {activeRunIsVisible && activeRun ? (
                            <div className={classes.runStrip}>
                                <div className={classes.runMeta}>
                                    <Text weight="semibold">
                                        {activeRun.kind === "matrix"
                                            ? locConstants.inlineCompletionDebug.replayMatrixRun
                                            : locConstants.inlineCompletionDebug.replayRun}
                                    </Text>
                                    <Text>
                                        {activeMatrixCell
                                            ? locConstants.inlineCompletionDebug.cell012X3(
                                                  String(activeMatrixCell.ordinal),
                                                  String(activeRun.matrixCells?.length ?? 0),
                                                  String(activeMatrixCell.profileLabel),
                                                  String(activeMatrixCell.schemaLabel),
                                              )
                                            : ""}
                                        {locConstants.inlineCompletionDebug.event}
                                        {activeRun.completedEvents}/{activeRun.totalEvents}
                                    </Text>
                                    <div className={classes.progressTrack}>
                                        <div
                                            className={classes.progressFill}
                                            style={{
                                                width: `${Math.min(
                                                    100,
                                                    (activeRun.completedEvents /
                                                        Math.max(1, activeRun.totalEvents)) *
                                                        100,
                                                )}%`,
                                            }}
                                        />
                                    </div>
                                </div>
                                <Button
                                    className={classes.cancelRunButton}
                                    appearance="outline"
                                    size="small"
                                    disabled={activeRunCancelling}
                                    onClick={() => cancelReplayRun(activeRun.id)}>
                                    {activeRunCancelling
                                        ? locConstants.inlineCompletionDebug
                                              .cancellingWaitingForTheActiveItem
                                        : locConstants.inlineCompletionDebug.cancelQueue}
                                </Button>
                            </div>
                        ) : null}
                        {liveEvictedCount > 0 ? (
                            <div className={classes.truncationStrip}>
                                {liveEvictedCount.toLocaleString()}{" "}
                                {locConstants.inlineCompletionDebug.olderEvent}
                                {liveEvictedCount === 1 ? "" : "s"}{" "}
                                {
                                    locConstants.inlineCompletionDebug
                                        .droppedFromTheLiveRingBoundedBuffer
                                }
                            </div>
                        ) : null}
                        <InlineCompletionDebugEventGrid
                            events={filteredEvents}
                            onSelectEvent={selectEvent}
                            autoScroll={autoScroll}
                            resizeToken={gridResizeToken}
                            showReplay={true}
                        />
                    </div>
                </Panel>
                <PanelResizeHandle className={classes.resizeHandle} />
                <Panel defaultSize={44} minSize={24}>
                    <div className={classes.detailPanel}>
                        <InlineCompletionDebugDetailPane event={selectedEvent} />
                    </div>
                </Panel>
            </PanelGroup>

            <CustomPromptDialog />
        </div>
    );
};

type FilterFocusRestoreState = {
    selectionStart: number | null;
    selectionEnd: number | null;
    selectionDirection: "forward" | "backward" | "none" | null;
};

type FilterParseResult = {
    predicate: (event: InlineCompletionDebugEvent) => boolean;
    error?: string;
};

function parseFilterQuery(query: string): FilterParseResult {
    const trimmed = query.trim();
    if (!trimmed) {
        return { predicate: () => true };
    }

    const parts = trimmed.split(/\s+(and|or)\s+/i);
    if (parts.length === 0) {
        return { predicate: () => true };
    }

    const predicates: Array<(event: InlineCompletionDebugEvent) => boolean> = [];
    const operators: Array<"and" | "or"> = [];

    for (let index = 0; index < parts.length; index++) {
        const part = parts[index]?.trim();
        if (!part) {
            return {
                predicate: () => false,
                error: locConstants.inlineCompletionDebug.invalidFilterExpression,
            };
        }

        if (index % 2 === 1) {
            const normalizedOperator = part.toLowerCase();
            if (normalizedOperator !== "and" && normalizedOperator !== "or") {
                return {
                    predicate: () => false,
                    error: locConstants.inlineCompletionDebug.useAndOrOrBetweenClauses,
                };
            }
            operators.push(normalizedOperator);
            continue;
        }

        const clause = parseClause(part);
        if (clause.error) {
            return { predicate: () => false, error: clause.error };
        }
        predicates.push(clause.predicate);
    }

    return {
        predicate: (event) => {
            let result = predicates[0]?.(event) ?? true;
            for (let index = 0; index < operators.length; index++) {
                const next = predicates[index + 1]?.(event) ?? false;
                result = operators[index] === "and" ? result && next : result || next;
            }
            return result;
        },
    };
}

function parseClause(expression: string): {
    predicate: (event: InlineCompletionDebugEvent) => boolean;
    error?: string;
} {
    const match = /^([a-zA-Z]+)\s*(=|!=|~=|>=|<=|>|<)\s*(.+)$/.exec(expression);
    if (!match) {
        return {
            predicate: () => false,
            error: locConstants.inlineCompletionDebug.couldnTParse0TryResultSuccess(
                String(expression),
            ),
        };
    }

    const [, rawField, operator, rawValue] = match;
    const field = rawField.toLowerCase();
    const value = stripQuotes(rawValue.trim());
    const getter = getFieldValueGetter(field);
    if (!getter) {
        return {
            predicate: () => false,
            error: locConstants.inlineCompletionDebug.unknownFilterField0(String(rawField)),
        };
    }

    if (getter.type === "number") {
        const numericValue = Number(value);
        if (!Number.isFinite(numericValue)) {
            return {
                predicate: () => false,
                error: locConstants.inlineCompletionDebug.value0ExpectsANumericValue(
                    String(rawField),
                ),
            };
        }

        return {
            predicate: (event) => compareNumbers(getter.get(event), operator, numericValue),
        };
    }

    return {
        predicate: (event) => compareStrings(getter.get(event), operator, value),
    };
}

function getFieldValueGetter(field: string):
    | {
          type: "string" | "number";
          get: (event: InlineCompletionDebugEvent) => string | number;
      }
    | undefined {
    switch (field) {
        case "result":
            return { type: "string", get: (event) => event.result };
        case "doc":
        case "document":
            return { type: "string", get: (event) => event.documentFileName };
        case "model":
            return {
                type: "string",
                get: (event) =>
                    `${event.modelVendor ?? ""} ${event.modelFamily ?? ""} ${
                        event.modelId ?? ""
                    }`.trim(),
            };
        case "mode":
            return {
                type: "string",
                get: (event) =>
                    event.completionCategory ?? (event.intentMode ? "intent" : "continuation"),
            };
        case "trigger":
            return {
                type: "string",
                get: (event) =>
                    getReplayTag(event, "replayRunId")
                        ? "replay"
                        : event.explicitFromUser
                          ? "explicit"
                          : "automatic",
            };
        case "latency":
            return { type: "number", get: (event) => event.latencyMs };
        case "id":
            return { type: "string", get: (event) => event.id };
        case "info":
            return { type: "string", get: getInfoText };
        case "replayrun":
            return { type: "string", get: (event) => getReplayTag(event, "replayRunId") ?? "" };
        case "replaytrace":
            return { type: "string", get: (event) => getReplayTag(event, "replayTraceId") ?? "" };
        case "replaycell":
        case "matrixcell":
            return {
                type: "string",
                get: (event) => getReplayTag(event, "replayMatrixCellId") ?? "",
            };
        case "replaysource":
            return {
                type: "string",
                get: (event) => getReplayTag(event, "replaySourceEventId") ?? "",
            };
        default:
            return undefined;
    }
}

function compareStrings(left: string | number, operator: string, value: string): boolean {
    const normalizedLeft = String(left).toLowerCase();
    const normalizedValue = value.toLowerCase();

    switch (operator) {
        case "=":
            return normalizedLeft === normalizedValue;
        case "!=":
            return normalizedLeft !== normalizedValue;
        case "~=":
            return normalizedLeft.includes(normalizedValue);
        default:
            return false;
    }
}

function compareNumbers(left: string | number, operator: string, value: number): boolean {
    const numericLeft = Number(left);
    switch (operator) {
        case "=":
            return numericLeft === value;
        case "!=":
            return numericLeft !== value;
        case ">":
            return numericLeft > value;
        case ">=":
            return numericLeft >= value;
        case "<":
            return numericLeft < value;
        case "<=":
            return numericLeft <= value;
        default:
            return false;
    }
}

function stripQuotes(value: string): string {
    if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
    ) {
        return value.slice(1, -1);
    }
    return value;
}

export function getInfoText(event: InlineCompletionDebugEvent): string {
    if (event.result === "queued") {
        return locConstants.inlineCompletionDebug.detailText1;
    }

    if (event.result === "pending") {
        const stage = event.locals.pendingStage;
        return typeof stage === "string"
            ? locConstants.inlineCompletionDebug.inFlight0(String(formatPendingStage(stage)))
            : locConstants.inlineCompletionDebug.inFlight;
    }

    if (event.result === "skipped") {
        const reason = event.locals.skipReason;
        return locConstants.inlineCompletionDebug.detailText2(
            String(typeof reason === "string" ? `: ${reason}` : ""),
        );
    }

    return (
        event.finalCompletionText ??
        event.sanitizedResponse ??
        event.error?.message ??
        event.rawResponse ??
        ""
    );
}

function formatPendingStage(stage: string): string {
    switch (stage) {
        case "selectingModel":
            return locConstants.inlineCompletionDebug.detailText3;
        case "checkingModelAccess":
            return locConstants.inlineCompletionDebug.detailText4;
        case "buildingSchemaContext":
            return locConstants.inlineCompletionDebug.detailText5;
        case "countingInputTokens":
            return locConstants.inlineCompletionDebug.detailText6;
        case "countingTrimmedInputTokens":
            return locConstants.inlineCompletionDebug.detailText7;
        case "waitingForModelResponse":
            return locConstants.inlineCompletionDebug.detailText8;
        case "readingModelResponse":
            return locConstants.inlineCompletionDebug.detailText9;
        case "countingOutputTokens":
            return locConstants.inlineCompletionDebug.detailText10;
        default:
            return stage.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();
    }
}

function getReplayTag(event: InlineCompletionDebugEvent, key: string): string | undefined {
    const localValue = event.locals[key];
    return event.tags?.[key] ?? (typeof localValue === "string" ? localValue : undefined);
}
