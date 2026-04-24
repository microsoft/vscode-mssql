/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useCallback, useEffect, useMemo, useRef } from "react";
import { Column, GridOption, SlickgridReactInstance } from "slickgrid-react";
import { makeStyles } from "@fluentui/react-components";
import { ColorThemeKind } from "../../../../sharedInterfaces/webview";
import { InlineCompletionDebugEvent } from "../../../../sharedInterfaces/inlineCompletionDebug";
import { useVscodeWebview } from "../../../common/vscodeWebviewProvider";
import {
    baseFluentReadOnlyGridOption,
    createFluentAutoResizeOptions,
    FluentSlickGrid,
} from "../../../common/FluentSlickGrid/FluentSlickGrid";
import { useInlineCompletionDebugContext } from "../inlineCompletionDebugStateProvider";
import { getInfoText } from "../inlineCompletionDebug";

const GRID_CONTAINER_ID = "inlineCompletionDebugGridContainer";

const useStyles = makeStyles({
    container: {
        height: "100%",
        minHeight: 0,
    },
});

export const InlineCompletionDebugEventGrid = ({
    events,
    onSelectEvent,
    autoScroll,
    resizeToken,
}: {
    events: InlineCompletionDebugEvent[];
    onSelectEvent: (eventId?: string) => void;
    autoScroll: boolean;
    resizeToken: number;
}) => {
    const classes = useStyles();
    const { themeKind } = useVscodeWebview();
    const { copyEventPayload, replayEvent } = useInlineCompletionDebugContext();
    const reactGridRef = useRef<SlickgridReactInstance | undefined>(undefined);
    const resizeRafRef = useRef<number | null>(null);
    const eventsRef = useRef(events);
    const onSelectEventRef = useRef(onSelectEvent);
    const autoScrollRef = useRef(autoScroll);
    const eventCountRef = useRef(events.length);
    const pointerDownRef = useRef(false);

    useEffect(() => {
        eventsRef.current = events;
    }, [events]);

    useEffect(() => {
        onSelectEventRef.current = onSelectEvent;
    }, [onSelectEvent]);

    useEffect(() => {
        autoScrollRef.current = autoScroll;
    }, [autoScroll]);

    useEffect(() => {
        eventCountRef.current = events.length;
    }, [events.length]);

    const columns = useMemo<Column<InlineCompletionDebugEvent>[]>(
        () => [
            {
                id: "id",
                name: "#",
                field: "id",
                minWidth: 54,
                maxWidth: 68,
                formatter: (_row, _cell, value) => monoFormatter(String(value).replace(/^E-/, "")),
            },
            {
                id: "time",
                name: "Time",
                field: "timestamp",
                minWidth: 118,
                formatter: (_row, _cell, value) => monoFormatter(formatTime(Number(value))),
            },
            {
                id: "document",
                name: "Document",
                field: "documentFileName",
                minWidth: 160,
                formatter: (_row, _cell, value) => monoFormatter(String(value ?? "")),
            },
            {
                id: "location",
                name: "Ln:Col",
                field: "id",
                minWidth: 88,
                formatter: (_row, _cell, _value, _column, event) =>
                    monoFormatter(`${event.line}:${event.column}`),
            },
            {
                id: "trigger",
                name: "Trigger",
                field: "explicitFromUser",
                minWidth: 104,
                formatter: (_row, _cell, value) => monoFormatter(value ? "explicit" : "automatic"),
            },
            {
                id: "mode",
                name: "Mode",
                field: "intentMode",
                minWidth: 110,
                formatter: (_row, _cell, value) =>
                    badgeFormatter(value ? "intent" : "continuation", value ? "intent" : "neutral"),
            },
            {
                id: "model",
                name: "Model",
                field: "modelFamily",
                minWidth: 148,
                formatter: (_row, _cell, value) => monoFormatter(String(value ?? "default")),
            },
            {
                id: "latency",
                name: "Latency",
                field: "latencyMs",
                minWidth: 92,
                formatter: (_row, _cell, value) =>
                    monoFormatter(`${Number(value ?? 0).toLocaleString()} ms`),
            },
            {
                id: "tokens",
                name: "In/Out",
                field: "id",
                minWidth: 92,
                formatter: (_row, _cell, _value, _column, event) =>
                    monoFormatter(
                        `${formatTokenCount(event.inputTokens)}/${formatTokenCount(event.outputTokens)}`,
                    ),
            },
            {
                id: "result",
                name: "Result",
                field: "result",
                minWidth: 132,
                formatter: (_row, _cell, value) =>
                    badgeFormatter(String(value), resultTone(String(value))),
            },
            {
                id: "info",
                name: "Info (sanitized completion)",
                field: "id",
                minWidth: 280,
                formatter: (_row, _cell, _value, _column, event) =>
                    monoFormatter(truncate(getInfoText(event), 80)),
            },
        ],
        [],
    );

    const gridOptions = useMemo<GridOption>(
        () => ({
            ...baseFluentReadOnlyGridOption,
            autoResize: createFluentAutoResizeOptions("#inlineCompletionDebugGridContainer", {
                bottomPadding: 0,
                minHeight: 120,
            }),
            darkMode:
                themeKind === ColorThemeKind.Dark || themeKind === ColorThemeKind.HighContrast,
            rowHeight: 27,
            headerRowHeight: 30,
            enableContextMenu: true,
            enableCellNavigation: true,
            enableColumnReorder: true,
            contextMenu: {
                commandItems: [
                    { command: "copy-id", title: "Copy ID", iconCssClass: "fi fi-copy" },
                    { command: "copy-json", title: "Copy as JSON", iconCssClass: "fi fi-copy" },
                    { divider: true, command: "" },
                    { command: "copy-prompt", title: "Copy prompt", iconCssClass: "fi fi-copy" },
                    {
                        command: "copy-raw",
                        title: "Copy raw response",
                        iconCssClass: "fi fi-copy",
                    },
                    {
                        command: "copy-sanitized",
                        title: "Copy sanitized response",
                        iconCssClass: "fi fi-copy",
                    },
                    { divider: true, command: "" },
                    {
                        command: "replay",
                        title: "Replay this prompt with current overrides",
                        iconCssClass: "fi fi-arrow-sync",
                    },
                ],
                onCommand: (_event, args) => {
                    const event = args?.dataContext as InlineCompletionDebugEvent | undefined;
                    if (!event) {
                        return;
                    }

                    switch (args.command) {
                        case "copy-id":
                            copyEventPayload(event.id, "id");
                            break;
                        case "copy-json":
                            copyEventPayload(event.id, "json");
                            break;
                        case "copy-prompt":
                            copyEventPayload(event.id, "prompt");
                            break;
                        case "copy-raw":
                            copyEventPayload(event.id, "rawResponse");
                            break;
                        case "copy-sanitized":
                            copyEventPayload(event.id, "sanitizedResponse");
                            break;
                        case "replay":
                            replayEvent(event.id);
                            break;
                    }
                },
            },
        }),
        [copyEventPayload, replayEvent, themeKind],
    );

    const handleRowSelection = useCallback((rowIndex: number | undefined) => {
        if (rowIndex === undefined || rowIndex < 0) {
            return;
        }
        const event = eventsRef.current[rowIndex];
        if (event) {
            onSelectEventRef.current(event.id);
        }
    }, []);

    const clearGridFocusState = useCallback(() => {
        const activeElement = document.activeElement as HTMLElement | null;
        const gridContainer = document.getElementById(GRID_CONTAINER_ID);
        reactGridRef.current?.slickGrid?.resetActiveCell?.();
        if (activeElement && gridContainer?.contains(activeElement)) {
            activeElement.blur();
        }
    }, []);

    const scheduleGridResize = useCallback(() => {
        if (resizeRafRef.current !== null) {
            cancelAnimationFrame(resizeRafRef.current);
        }

        resizeRafRef.current = requestAnimationFrame(() => {
            resizeRafRef.current = null;

            const resizerService = reactGridRef.current?.resizerService;
            if (resizerService) {
                void resizerService.resizeGrid();
            }

            if (!document.hasFocus()) {
                clearGridFocusState();
            }

            if (autoScrollRef.current && eventCountRef.current > 0) {
                reactGridRef.current?.slickGrid?.scrollRowToTop(eventCountRef.current - 1);
            }
        });
    }, [clearGridFocusState]);

    useEffect(() => {
        scheduleGridResize();
    }, [events.length, resizeToken, scheduleGridResize]);

    useEffect(() => {
        const handlePointerUp = () => {
            pointerDownRef.current = false;
        };
        const handleWindowBlur = () => {
            requestAnimationFrame(() => {
                clearGridFocusState();
            });
        };

        window.addEventListener("mouseup", handlePointerUp);
        window.addEventListener("blur", handleWindowBlur);
        return () => {
            window.removeEventListener("mouseup", handlePointerUp);
            window.removeEventListener("blur", handleWindowBlur);
        };
    }, [clearGridFocusState]);

    useEffect(() => {
        return () => {
            if (resizeRafRef.current !== null) {
                cancelAnimationFrame(resizeRafRef.current);
            }
        };
    }, []);

    const handleReactGridCreated = useCallback(
        (event: CustomEvent) => {
            reactGridRef.current = event.detail as SlickgridReactInstance;
            scheduleGridResize();
        },
        [scheduleGridResize],
    );

    const handleGridClick = useCallback(
        ($event: CustomEvent) => {
            pointerDownRef.current = false;
            handleRowSelection($event.detail.args?.row);
        },
        [handleRowSelection],
    );

    const handleActiveCellChanged = useCallback(
        ($event: CustomEvent) => {
            if (pointerDownRef.current) {
                return;
            }
            handleRowSelection($event.detail.args?.row);
        },
        [handleRowSelection],
    );

    const handleSelectedRowsChanged = useCallback(
        ($event: CustomEvent) => {
            if (pointerDownRef.current) {
                return;
            }
            const rowIndex = $event.detail.args?.rows?.[0];
            handleRowSelection(rowIndex);
        },
        [handleRowSelection],
    );

    return (
        <div
            id={GRID_CONTAINER_ID}
            className={classes.container}
            onMouseDownCapture={() => {
                pointerDownRef.current = true;
            }}>
            <FluentSlickGrid
                gridId="inlineCompletionDebugGrid"
                columns={columns}
                options={gridOptions}
                dataset={events}
                onReactGridCreated={handleReactGridCreated}
                onClick={handleGridClick}
                onActiveCellChanged={handleActiveCellChanged}
                onSelectedRowsChanged={handleSelectedRowsChanged}
            />
        </div>
    );
};

function monoFormatter(value: string): string {
    return `<span style="font-family: var(--vscode-editor-font-family, Consolas, monospace);">${escapeHtml(
        value,
    )}</span>`;
}

function badgeFormatter(
    label: string,
    tone: "success" | "warning" | "danger" | "intent" | "neutral",
): string {
    const styles = {
        success:
            "background: color-mix(in srgb, var(--vscode-testing-iconPassed) 16%, transparent); color: var(--vscode-testing-iconPassed);",
        warning:
            "background: color-mix(in srgb, var(--vscode-editorWarning-foreground) 16%, transparent); color: var(--vscode-editorWarning-foreground);",
        danger: "background: color-mix(in srgb, var(--vscode-errorForeground) 16%, transparent); color: var(--vscode-errorForeground);",
        intent: "background: color-mix(in srgb, var(--vscode-focusBorder) 18%, transparent); color: var(--vscode-focusBorder);",
        neutral:
            "background: color-mix(in srgb, var(--vscode-descriptionForeground) 18%, transparent); color: var(--vscode-descriptionForeground);",
    }[tone];

    return `<span style="display:inline-flex; align-items:center; padding:2px 8px; border-radius:999px; font-family: var(--vscode-editor-font-family, Consolas, monospace); font-size: 11px; ${styles}">${escapeHtml(
        label,
    )}</span>`;
}

function resultTone(result: string): "success" | "warning" | "danger" | "neutral" {
    switch (result) {
        case "success":
        case "accepted":
            return "success";
        case "error":
            return "danger";
        case "cancelled":
            return "neutral";
        default:
            return "warning";
    }
}

function formatTime(timestamp: number): string {
    const date = new Date(timestamp);
    return date.toLocaleTimeString([], {
        hour12: false,
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        fractionalSecondDigits: 3,
    });
}

function formatTokenCount(value: number | undefined): string {
    return value === undefined ? "--" : value.toLocaleString();
}

function truncate(value: string, maxLength: number): string {
    if (value.length <= maxLength) {
        return value;
    }
    return `${value.slice(0, maxLength - 3)}...`;
}

function escapeHtml(value: string): string {
    return value
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}
