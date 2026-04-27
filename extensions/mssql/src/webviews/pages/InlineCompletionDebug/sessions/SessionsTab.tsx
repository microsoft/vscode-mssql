/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useCallback, useEffect, useMemo, useState } from "react";
import {
    Button,
    Checkbox,
    Dropdown,
    Field,
    Input,
    Option,
    Text,
    Tooltip as FluentTooltip,
    makeStyles,
    mergeClasses,
    shorthands,
    tokens,
} from "@fluentui/react-components";
import {
    AddRegular,
    ArrowDownloadRegular,
    ArrowSyncRegular,
    ChevronDown16Regular,
    ChevronLeft16Regular,
    ChevronRight16Regular,
    FolderOpenRegular,
} from "@fluentui/react-icons";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import {
    Bar,
    BarChart,
    CartesianGrid,
    Line,
    LineChart,
    ResponsiveContainer,
    Tooltip as RechartsTooltip,
    XAxis,
    YAxis,
} from "recharts";
import {
    InlineCompletionAnalysisDimension,
    InlineCompletionAnalysisFilters,
    InlineCompletionPivotRow,
    computeInlineCompletionMetrics,
    createFacetCounts,
    filterInlineCompletionEvents,
    getEventDimension,
    pivotInlineCompletionEvents,
} from "../../../../sharedInterfaces/inlineCompletionAnalysis";
import {
    InlineCompletionDebugEvent,
    InlineCompletionDebugTraceIndexEntry,
} from "../../../../sharedInterfaces/inlineCompletionDebug";
import { useInlineCompletionDebugContext } from "../inlineCompletionDebugStateProvider";
import { useInlineCompletionDebugSelector } from "../inlineCompletionDebugSelector";
import { InlineCompletionDebugEventGrid } from "../components/EventGrid";
import { InlineCompletionDebugDetailPane } from "../components/DetailPane";
import { ReplayCartButton } from "../components/ReplayCartButton";

const dimensions: Array<{ key: InlineCompletionAnalysisDimension; label: string }> = [
    { key: "model", label: "Model" },
    { key: "profile", label: "Profile" },
    { key: "schemaMode", label: "Schema mode" },
    { key: "schemaSizeKind", label: "Schema size" },
    { key: "intentMode", label: "Intent" },
    { key: "result", label: "Result" },
    { key: "trigger", label: "Trigger" },
    { key: "language", label: "Language" },
    { key: "inferredSystemQuery", label: "System query" },
    { key: "completionCategory", label: "Completion kind" },
    { key: "replayRun", label: "Replay run" },
    { key: "replayMatrixCell", label: "Matrix cell" },
    { key: "replaySourceEvent", label: "Replay source" },
    { key: "replayTrace", label: "Replay trace" },
];

const chartMargin = { top: 0, right: 8, bottom: 0, left: 0 };
const axisTick = {
    fill: "var(--vscode-descriptionForeground)",
    fontSize: 11,
};
const tooltipStyle = {
    backgroundColor: "var(--vscode-editorWidget-background)",
    borderColor: "var(--vscode-panel-border)",
    color: "var(--vscode-foreground)",
};

const useStyles = makeStyles({
    root: {
        display: "flex",
        flexDirection: "column",
        height: "100%",
        minHeight: 0,
        backgroundColor: "var(--vscode-editor-background)",
        color: "var(--vscode-foreground)",
        ...shorthands.overflow("hidden"),
    },
    dataset: {
        flexShrink: 0,
        backgroundColor: "var(--vscode-sideBar-background)",
        ...shorthands.borderBottom("1px", "solid", "var(--vscode-panel-border)"),
    },
    datasetHeader: {
        display: "grid",
        gridTemplateColumns: "minmax(220px, 1fr) auto",
        columnGap: "8px",
        alignItems: "center",
        minHeight: "34px",
        ...shorthands.padding("0", "8px"),
    },
    folderText: {
        display: "flex",
        alignItems: "center",
        gap: "6px",
        minWidth: 0,
        overflowX: "hidden",
        whiteSpace: "nowrap",
        fontFamily: "var(--vscode-editor-font-family, Consolas, monospace)",
        color: "var(--vscode-descriptionForeground)",
    },
    folderPath: {
        minWidth: 0,
        overflowX: "hidden",
        textOverflow: "ellipsis",
    },
    fileListToggle: {
        flexShrink: 0,
    },
    datasetActions: {
        display: "flex",
        gap: "4px",
        alignItems: "center",
    },
    traceToggleActions: {
        display: "flex",
        gap: "2px",
        alignItems: "center",
    },
    datasetTable: {
        display: "grid",
        gridTemplateColumns: "34px minmax(260px, 1fr) 180px 72px 82px 108px 108px 152px",
        maxHeight: "176px",
        overflowY: "auto",
        ...shorthands.borderTop("1px", "solid", "var(--vscode-panel-border)"),
    },
    tableHeader: {
        position: "sticky",
        top: 0,
        zIndex: 1,
        backgroundColor: "var(--vscode-sideBar-background)",
        color: "var(--vscode-descriptionForeground)",
        textTransform: "uppercase",
        fontSize: tokens.fontSizeBase100,
        letterSpacing: "0.04em",
    },
    datasetCell: {
        minHeight: "24px",
        display: "flex",
        alignItems: "center",
        minWidth: 0,
        ...shorthands.padding("0", "8px"),
        ...shorthands.borderBottom("1px", "solid", "var(--vscode-panel-border)"),
        fontSize: tokens.fontSizeBase200,
    },
    mono: {
        fontFamily: "var(--vscode-editor-font-family, Consolas, monospace)",
    },
    truncate: {
        overflowX: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
    },
    savedCell: {
        whiteSpace: "nowrap",
    },
    summary: {
        display: "grid",
        gridTemplateColumns: "repeat(7, minmax(120px, 1fr))",
        flexShrink: 0,
        ...shorthands.borderBottom("1px", "solid", "var(--vscode-panel-border)"),
    },
    statTile: {
        minHeight: "52px",
        ...shorthands.padding("6px", "10px"),
        ...shorthands.borderRight("1px", "solid", "var(--vscode-panel-border)"),
    },
    statLabel: {
        color: "var(--vscode-descriptionForeground)",
        textTransform: "uppercase",
        fontSize: tokens.fontSizeBase100,
        letterSpacing: "0.05em",
    },
    statValue: {
        display: "block",
        marginTop: "3px",
        fontSize: tokens.fontSizeBase400,
        lineHeight: "18px",
    },
    statHint: {
        display: "block",
        marginTop: "1px",
        color: "var(--vscode-descriptionForeground)",
        fontSize: tokens.fontSizeBase200,
        lineHeight: "16px",
    },
    body: {
        ...shorthands.flex(1),
        minHeight: 0,
    },
    workspace: {
        display: "flex",
        height: "100%",
        minHeight: 0,
    },
    workspacePanels: {
        ...shorthands.flex(1),
        minWidth: 0,
        minHeight: 0,
    },
    collapsedFilters: {
        width: "34px",
        flexShrink: 0,
        display: "flex",
        justifyContent: "center",
        alignItems: "flex-start",
        backgroundColor: "var(--vscode-sideBar-background)",
        ...shorthands.padding("4px", "0"),
        ...shorthands.borderRight("1px", "solid", "var(--vscode-panel-border)"),
    },
    collapsedFiltersButton: {
        minWidth: "28px",
        width: "28px",
    },
    filters: {
        height: "100%",
        minHeight: 0,
        minWidth: 0,
        overflowY: "auto",
        backgroundColor: "var(--vscode-sideBar-background)",
    },
    filterHeader: {
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        gap: "8px",
        minHeight: "36px",
        ...shorthands.padding("0", "10px"),
        ...shorthands.borderBottom("1px", "solid", "var(--vscode-panel-border)"),
    },
    filterHeaderActions: {
        display: "flex",
        gap: "2px",
        alignItems: "center",
    },
    facet: {
        ...shorthands.padding("10px"),
        ...shorthands.borderBottom("1px", "solid", "var(--vscode-panel-border)"),
    },
    facetTitle: {
        display: "flex",
        justifyContent: "space-between",
        color: "var(--vscode-descriptionForeground)",
        textTransform: "uppercase",
        fontSize: tokens.fontSizeBase100,
        letterSpacing: "0.05em",
        marginBottom: "6px",
    },
    facetRow: {
        position: "relative",
        display: "grid",
        gridTemplateColumns: "minmax(0, 1fr) auto",
        alignItems: "center",
        minHeight: "25px",
        columnGap: "8px",
    },
    facetBar: {
        position: "absolute",
        left: "24px",
        top: "4px",
        bottom: "4px",
        backgroundColor: "var(--vscode-list-hoverBackground)",
        pointerEvents: "none",
    },
    facetCheckbox: {
        minWidth: 0,
        zIndex: 1,
    },
    facetCount: {
        zIndex: 1,
        color: "var(--vscode-descriptionForeground)",
        fontVariantNumeric: "tabular-nums",
    },
    numericFilters: {
        display: "grid",
        gridTemplateColumns: "1fr",
        gap: "8px",
    },
    main: {
        height: "100%",
        minHeight: 0,
        minWidth: 0,
        overflowY: "auto",
    },
    controls: {
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        flexWrap: "wrap",
        gap: "8px",
        minHeight: "34px",
        ...shorthands.padding("3px", "8px"),
        ...shorthands.borderBottom("1px", "solid", "var(--vscode-panel-border)"),
    },
    controlGroup: {
        display: "flex",
        alignItems: "center",
        flexWrap: "wrap",
        gap: "6px",
    },
    compactButton: {
        flexShrink: 1,
        height: "28px",
        minWidth: 0,
        maxWidth: "136px",
        overflowX: "hidden",
        whiteSpace: "nowrap",
        ...shorthands.padding("0", "8px"),
        "& .fui-Button__icon": {
            flexShrink: 0,
        },
        "& .fui-Button__content": {
            minWidth: 0,
            overflowX: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
        },
    },
    pivotMeta: {
        color: "var(--vscode-descriptionForeground)",
        fontSize: tokens.fontSizeBase200,
    },
    pivotTable: {
        width: "100%",
        borderCollapse: "collapse",
        tableLayout: "fixed",
        fontSize: tokens.fontSizeBase200,
    },
    pivotNameColumn: {
        width: "22%",
    },
    pivotCountColumn: {
        width: "6%",
    },
    pivotSampleColumn: {
        width: "8%",
    },
    pivotMetricColumn: {
        width: "7.5%",
    },
    pivotSchemaColumn: {
        width: "11%",
    },
    pivotHeaderCell: {
        position: "sticky",
        top: 0,
        zIndex: 1,
        textAlign: "right",
        color: "var(--vscode-descriptionForeground)",
        backgroundColor: "var(--vscode-editor-background)",
        textTransform: "uppercase",
        fontSize: tokens.fontSizeBase100,
        letterSpacing: "0.04em",
        ...shorthands.padding("7px", "8px"),
        ...shorthands.borderBottom("1px", "solid", "var(--vscode-panel-border)"),
    },
    pivotHeaderName: {
        textAlign: "left",
    },
    pivotCell: {
        textAlign: "right",
        fontVariantNumeric: "tabular-nums",
        ...shorthands.padding("7px", "8px"),
        ...shorthands.borderBottom("1px", "solid", "var(--vscode-panel-border)"),
    },
    pivotNameCell: {
        textAlign: "left",
        fontFamily: "var(--vscode-editor-font-family, Consolas, monospace)",
        overflowWrap: "break-word",
        wordBreak: "normal",
    },
    pivotRow: {
        cursor: "pointer",
        ":hover": {
            backgroundColor: "var(--vscode-list-hoverBackground)",
        },
    },
    selectedPivotRow: {
        backgroundColor: "var(--vscode-list-activeSelectionBackground)",
        color: "var(--vscode-list-activeSelectionForeground)",
    },
    lowConfidence: {
        opacity: 0.72,
    },
    sampleCell: {
        minWidth: "58px",
    },
    sampleTrack: {
        height: "5px",
        backgroundColor: "var(--vscode-editorWidget-background)",
    },
    sampleFill: {
        height: "5px",
    },
    sideCharts: {
        height: "100%",
        minHeight: 0,
        minWidth: 0,
        overflowY: "auto",
        backgroundColor: "var(--vscode-sideBar-background)",
    },
    chartPanel: {
        ...shorthands.padding("8px", "10px"),
        ...shorthands.borderBottom("1px", "solid", "var(--vscode-panel-border)"),
    },
    chartBox: {
        width: "100%",
        height: "132px",
    },
    chartTitle: {
        color: "var(--vscode-descriptionForeground)",
        textTransform: "uppercase",
        fontSize: tokens.fontSizeBase100,
        letterSpacing: "0.05em",
        marginBottom: "6px",
    },
    chartRow: {
        display: "grid",
        gridTemplateColumns: "minmax(82px, 1fr) 54px minmax(92px, 1.2fr)",
        gap: "8px",
        alignItems: "center",
        minHeight: "26px",
    },
    barTrack: {
        height: "10px",
        backgroundColor: "var(--vscode-editorWidget-background)",
        overflowX: "hidden",
    },
    stackedBar: {
        display: "flex",
        height: "12px",
        backgroundColor: "var(--vscode-editorWidget-background)",
    },
    accepted: {
        backgroundColor: "#53cdb8",
    },
    rejected: {
        backgroundColor: "#d7daa0",
    },
    cancelled: {
        backgroundColor: "#8f8f8f",
    },
    error: {
        backgroundColor: "#e06c75",
    },
    tokenIn: {
        backgroundColor: "#5aa9e6",
    },
    tokenOut: {
        backgroundColor: "#53cdb8",
    },
    sparkline: {
        width: "100%",
        height: "128px",
    },
    resizeHandle: {
        height: "2px",
        backgroundColor: "var(--vscode-focusBorder)",
    },
    horizontalResizeHandle: {
        width: "2px",
        flexShrink: 0,
        backgroundColor: "var(--vscode-panel-border)",
        cursor: "col-resize",
        ":hover": {
            backgroundColor: "var(--vscode-focusBorder)",
        },
        ":focus-visible": {
            backgroundColor: "var(--vscode-focusBorder)",
            outlineStyle: "none",
        },
    },
    drilldown: {
        height: "100%",
        minHeight: 0,
    },
    drillGrid: {
        height: "100%",
        minHeight: 0,
    },
    drillDetail: {
        height: "100%",
        minHeight: 0,
    },
    empty: {
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: "var(--vscode-descriptionForeground)",
        ...shorthands.padding("24px"),
        textAlign: "center",
    },
});

export function SessionsTab({ active }: { active: boolean }) {
    const classes = useStyles();
    const sessions = useInlineCompletionDebugSelector((state) => state.sessions);
    const {
        sessionsActivated,
        sessionsRefresh,
        sessionsToggleTrace,
        sessionsSetAllTraces,
        sessionsLoadIncluded,
        sessionsAddFile,
        sessionsChangeFolder,
        replaySessionEvent,
        addEventsToReplayCart,
    } = useInlineCompletionDebugContext();
    const [filters, setFilters] = useState<InlineCompletionAnalysisFilters>({});
    const [primaryDimension, setPrimaryDimension] =
        useState<InlineCompletionAnalysisDimension>("model");
    const [secondaryDimension, setSecondaryDimension] = useState<
        InlineCompletionAnalysisDimension | "none"
    >("none");
    const [selectedPivotKey, setSelectedPivotKey] = useState<string | undefined>();
    const [selectedEventKey, setSelectedEventKey] = useState<string | undefined>();
    const [filtersCollapsed, setFiltersCollapsed] = useState(false);
    const [gridResizeToken, setGridResizeToken] = useState(0);

    useEffect(() => {
        if (active) {
            sessionsActivated();
        }
    }, [active, sessionsActivated]);

    useEffect(() => {
        if (!active) {
            return;
        }
        const includedKeys = new Set(
            sessions.traceIndex.filter((entry) => entry.included).map((entry) => entry.fileKey),
        );
        const hasUnloadedIncluded = sessions.traceIndex.some(
            (entry) => entry.included && !entry.loaded && !entry.loadError,
        );
        if (includedKeys.size > 0 && hasUnloadedIncluded && !sessions.loading) {
            sessionsLoadIncluded();
        }
    }, [active, sessions.loading, sessions.traceIndex, sessionsLoadIncluded]);

    const includedFileKeys = useMemo(
        () =>
            new Set(
                sessions.traceIndex.filter((entry) => entry.included).map((entry) => entry.fileKey),
            ),
        [sessions.traceIndex],
    );
    const sessionEventDataset = useMemo(() => {
        const eventKeys = new WeakMap<InlineCompletionDebugEvent, string>();
        const eventSources = new WeakMap<InlineCompletionDebugEvent, string>();
        const sessionEvents: InlineCompletionDebugEvent[] = [];

        for (const loaded of sessions.loadedTraces) {
            if (!includedFileKeys.has(loaded.fileKey)) {
                continue;
            }

            loaded.trace.events.forEach((event, index) => {
                const sourceLabel = loaded.trace._savedAt ?? loaded.fileKey;
                const eventWithSource: InlineCompletionDebugEvent = {
                    ...event,
                    locals: {
                        ...event.locals,
                        replaySessionSourceLabel: sourceLabel,
                    },
                };
                eventKeys.set(
                    eventWithSource,
                    createSessionEventKey(loaded.fileKey, event.id, index),
                );
                eventSources.set(eventWithSource, sourceLabel);
                sessionEvents.push(eventWithSource);
            });
        }

        return { events: sessionEvents, eventKeys, eventSources };
    }, [includedFileKeys, sessions.loadedTraces]);
    const events = sessionEventDataset.events;
    const getSessionEventKey = useCallback(
        (event: InlineCompletionDebugEvent, index: number) =>
            sessionEventDataset.eventKeys.get(event) ??
            createSessionEventKey("unknown-trace", event.id, index),
        [sessionEventDataset],
    );
    const filteredEvents = useMemo(
        () => filterInlineCompletionEvents(events, filters),
        [events, filters],
    );
    const summaryMetrics = useMemo(
        () => computeInlineCompletionMetrics(filteredEvents),
        [filteredEvents],
    );
    const pivotRows = useMemo(
        () =>
            pivotInlineCompletionEvents(
                filteredEvents,
                primaryDimension,
                secondaryDimension === "none" ? undefined : secondaryDimension,
            ),
        [filteredEvents, primaryDimension, secondaryDimension],
    );
    const flatPivotRows = useMemo(() => flattenPivotRows(pivotRows), [pivotRows]);
    const selectedPivot = useMemo(
        () => flatPivotRows.find((row) => row.key === selectedPivotKey),
        [flatPivotRows, selectedPivotKey],
    );
    const drilldownEvents = selectedPivot?.events ?? [];
    const selectedEvent = useMemo(
        () =>
            drilldownEvents.find(
                (event, index) => getSessionEventKey(event, index) === selectedEventKey,
            ),
        [drilldownEvents, getSessionEventKey, selectedEventKey],
    );

    useEffect(() => {
        if (selectedPivotKey && !flatPivotRows.some((row) => row.key === selectedPivotKey)) {
            setSelectedPivotKey(undefined);
            setSelectedEventKey(undefined);
        }
    }, [flatPivotRows, selectedPivotKey]);

    useEffect(() => {
        if (!selectedPivot) {
            return;
        }

        const selectedEventStillVisible =
            selectedEventKey !== undefined &&
            drilldownEvents.some(
                (event, index) => getSessionEventKey(event, index) === selectedEventKey,
            );
        if (selectedEventStillVisible) {
            return;
        }

        const firstEvent = drilldownEvents[0];
        setSelectedEventKey(firstEvent ? getSessionEventKey(firstEvent, 0) : undefined);
    }, [drilldownEvents, getSessionEventKey, selectedEventKey, selectedPivot]);

    const updateFacet = useCallback(
        (dimension: InlineCompletionAnalysisDimension, value: string, checked: boolean) => {
            setFilters((current) => updateFacetFilter(current, dimension, value, checked));
        },
        [],
    );

    const setLatencyBound = useCallback((key: "min" | "max", value: string) => {
        const numericValue = value.trim() === "" ? undefined : Number(value);
        setFilters((current) => ({
            ...current,
            latencyRange: {
                ...current.latencyRange,
                [key]: Number.isFinite(numericValue) ? numericValue : undefined,
            },
        }));
    }, []);
    const addSessionEventsToReplayCart = useCallback(
        (eventsToAdd: InlineCompletionDebugEvent[]) => {
            addEventsToReplayCart(
                eventsToAdd.map((event) => ({
                    event,
                    sourceLabel:
                        asString(event.locals.replaySessionSourceLabel) ??
                        sessionEventDataset.eventSources.get(event) ??
                        "Sessions",
                })),
            );
        },
        [addEventsToReplayCart, sessionEventDataset],
    );

    return (
        <div className={classes.root}>
            <DatasetSelector
                traceFolder={sessions.traceFolder}
                entries={sessions.traceIndex}
                loading={sessions.loading}
                onRefresh={sessionsRefresh}
                onChangeFolder={sessionsChangeFolder}
                onAddFile={sessionsAddFile}
                onToggleTrace={sessionsToggleTrace}
                onSetAllTraces={sessionsSetAllTraces}
            />
            {sessions.error ? <div className={classes.empty}>{sessions.error}</div> : null}
            {!sessions.error ? (
                <>
                    <SummaryTiles
                        metrics={summaryMetrics}
                        traceCount={sessions.traceIndex.filter((entry) => entry.included).length}
                        configCount={countConfigs(filteredEvents)}
                    />
                    <PanelGroup
                        direction="vertical"
                        className={classes.body}
                        onLayout={() => setGridResizeToken((value) => value + 1)}>
                        <Panel defaultSize={selectedPivot ? 62 : 100} minSize={34}>
                            <div className={classes.workspace}>
                                {filtersCollapsed ? (
                                    <div className={classes.collapsedFilters}>
                                        <FluentTooltip content="Show filters" relationship="label">
                                            <Button
                                                appearance="subtle"
                                                size="small"
                                                className={classes.collapsedFiltersButton}
                                                icon={<ChevronRight16Regular />}
                                                onClick={() => setFiltersCollapsed(false)}
                                            />
                                        </FluentTooltip>
                                    </div>
                                ) : null}
                                <PanelGroup
                                    key={filtersCollapsed ? "filters-collapsed" : "filters-open"}
                                    direction="horizontal"
                                    className={classes.workspacePanels}
                                    onLayout={() => setGridResizeToken((value) => value + 1)}>
                                    {!filtersCollapsed ? (
                                        <>
                                            <Panel defaultSize={20} minSize={14} maxSize={34}>
                                                <FilterRail
                                                    events={events}
                                                    filters={filters}
                                                    onFacetChange={updateFacet}
                                                    onClear={() => setFilters({})}
                                                    onCollapse={() => setFiltersCollapsed(true)}
                                                    onLatencyBoundChange={setLatencyBound}
                                                />
                                            </Panel>
                                            <PanelResizeHandle
                                                className={classes.horizontalResizeHandle}
                                            />
                                        </>
                                    ) : null}
                                    <Panel defaultSize={filtersCollapsed ? 64 : 48} minSize={34}>
                                        <div className={classes.main}>
                                            <div className={classes.controls}>
                                                <div className={classes.controlGroup}>
                                                    <Text>Group by</Text>
                                                    <DimensionDropdown
                                                        value={primaryDimension}
                                                        onChange={setPrimaryDimension}
                                                    />
                                                    <Text>then by</Text>
                                                    <SecondaryDimensionDropdown
                                                        value={secondaryDimension}
                                                        onChange={setSecondaryDimension}
                                                    />
                                                </div>
                                                <div className={classes.controlGroup}>
                                                    <Text className={classes.pivotMeta}>
                                                        {filteredEvents.length.toLocaleString()}{" "}
                                                        events
                                                    </Text>
                                                    <Button
                                                        className={classes.compactButton}
                                                        size="small"
                                                        icon={<ArrowDownloadRegular />}
                                                        onClick={() =>
                                                            exportPivotCsv(
                                                                flatPivotRows,
                                                                primaryDimension,
                                                            )
                                                        }>
                                                        Export CSV
                                                    </Button>
                                                </div>
                                            </div>
                                            {flatPivotRows.length > 0 ? (
                                                <PivotTable
                                                    rows={flatPivotRows}
                                                    selectedKey={selectedPivotKey}
                                                    onSelect={(row) => {
                                                        setSelectedPivotKey(row.key);
                                                        const firstEvent = row.events[0];
                                                        setSelectedEventKey(
                                                            firstEvent
                                                                ? getSessionEventKey(firstEvent, 0)
                                                                : undefined,
                                                        );
                                                    }}
                                                    primaryDimension={primaryDimension}
                                                />
                                            ) : (
                                                <div className={classes.empty}>
                                                    No loaded events match the current dataset and
                                                    filters.
                                                </div>
                                            )}
                                        </div>
                                    </Panel>
                                    <PanelResizeHandle className={classes.horizontalResizeHandle} />
                                    <Panel defaultSize={filtersCollapsed ? 36 : 32} minSize={22}>
                                        <ChartsPanel rows={flatPivotRows} events={filteredEvents} />
                                    </Panel>
                                </PanelGroup>
                            </div>
                        </Panel>
                        {selectedPivot ? (
                            <>
                                <PanelResizeHandle className={classes.resizeHandle} />
                                <Panel defaultSize={38} minSize={22}>
                                    <PanelGroup
                                        direction="horizontal"
                                        className={classes.drilldown}
                                        onLayout={() => setGridResizeToken((value) => value + 1)}>
                                        <Panel defaultSize={42} minSize={24}>
                                            <div className={classes.drillGrid}>
                                                <InlineCompletionDebugEventGrid
                                                    events={drilldownEvents}
                                                    onSelectEvent={setSelectedEventKey}
                                                    autoScroll={false}
                                                    resizeToken={gridResizeToken}
                                                    onCopyEventPayload={copySessionEventPayload}
                                                    onReplayEvent={replaySessionEvent}
                                                    onAddEventsToReplayCart={
                                                        addSessionEventsToReplayCart
                                                    }
                                                    showReplay={true}
                                                    getEventKey={getSessionEventKey}
                                                />
                                            </div>
                                        </Panel>
                                        <PanelResizeHandle
                                            className={classes.horizontalResizeHandle}
                                        />
                                        <Panel defaultSize={58} minSize={28}>
                                            <div className={classes.drillDetail}>
                                                <InlineCompletionDebugDetailPane
                                                    event={selectedEvent}
                                                    onCopyEventPayload={copySessionEventPayload}
                                                />
                                            </div>
                                        </Panel>
                                    </PanelGroup>
                                </Panel>
                            </>
                        ) : null}
                    </PanelGroup>
                </>
            ) : null}
        </div>
    );
}

function DatasetSelector({
    traceFolder,
    entries,
    loading,
    onRefresh,
    onChangeFolder,
    onAddFile,
    onToggleTrace,
    onSetAllTraces,
}: {
    traceFolder: string;
    entries: InlineCompletionDebugTraceIndexEntry[];
    loading: boolean;
    onRefresh: () => void;
    onChangeFolder: () => void;
    onAddFile: () => void;
    onToggleTrace: (fileKey: string, included: boolean) => void;
    onSetAllTraces: (included: boolean) => void;
}) {
    const classes = useStyles();
    const [fileListOpen, setFileListOpen] = useState(false);
    const included = entries.filter((entry) => entry.included);
    const eventCount = included.reduce((sum, entry) => sum + entry.eventCount, 0);
    const range = getDatasetRange(included);
    const allIncluded = entries.length > 0 && included.length === entries.length;
    const noneIncluded = included.length === 0;

    return (
        <div className={classes.dataset}>
            <div className={classes.datasetHeader}>
                <div className={classes.folderText}>
                    <FluentTooltip
                        content={fileListOpen ? "Hide trace files" : "Show trace files"}
                        relationship="label">
                        <Button
                            appearance="subtle"
                            size="small"
                            className={classes.fileListToggle}
                            icon={
                                fileListOpen ? <ChevronDown16Regular /> : <ChevronRight16Regular />
                            }
                            onClick={() => setFileListOpen((value) => !value)}
                        />
                    </FluentTooltip>
                    <span className={classes.folderPath}>FOLDER&nbsp;&nbsp;{traceFolder}</span>
                </div>
                <div className={classes.datasetActions}>
                    <Text className={classes.pivotMeta}>
                        {included.length}/{entries.length} traces · {eventCount.toLocaleString()}{" "}
                        events{range ? ` · ${range}` : ""}
                    </Text>
                    <ReplayCartButton />
                    <div className={classes.traceToggleActions}>
                        <FluentTooltip content="Select all traces" relationship="label">
                            <Button
                                className={classes.compactButton}
                                appearance="subtle"
                                size="small"
                                disabled={allIncluded || entries.length === 0}
                                onClick={() => onSetAllTraces(true)}>
                                All
                            </Button>
                        </FluentTooltip>
                        <FluentTooltip content="Deselect all traces" relationship="label">
                            <Button
                                className={classes.compactButton}
                                appearance="subtle"
                                size="small"
                                disabled={noneIncluded || entries.length === 0}
                                onClick={() => onSetAllTraces(false)}>
                                None
                            </Button>
                        </FluentTooltip>
                    </div>
                    <Button
                        className={classes.compactButton}
                        icon={<ArrowSyncRegular />}
                        size="small"
                        onClick={onRefresh}
                        disabled={loading}>
                        Refresh
                    </Button>
                    <Button
                        className={classes.compactButton}
                        icon={<FolderOpenRegular />}
                        size="small"
                        onClick={onChangeFolder}>
                        Change folder
                    </Button>
                    <Button
                        className={classes.compactButton}
                        icon={<AddRegular />}
                        size="small"
                        onClick={onAddFile}>
                        Add file
                    </Button>
                </div>
            </div>
            {fileListOpen ? (
                <div className={classes.datasetTable}>
                    {["", "Filename", "Saved", "Events", "Size", "Profile", "Schema", "Replay"].map(
                        (label) => (
                            <div
                                key={label || "checkbox"}
                                className={mergeClasses(classes.datasetCell, classes.tableHeader)}>
                                {label}
                            </div>
                        ),
                    )}
                    {entries.map((entry) => (
                        <TraceRow key={entry.fileKey} entry={entry} onToggleTrace={onToggleTrace} />
                    ))}
                </div>
            ) : null}
        </div>
    );
}

function TraceRow({
    entry,
    onToggleTrace,
}: {
    entry: InlineCompletionDebugTraceIndexEntry;
    onToggleTrace: (fileKey: string, included: boolean) => void;
}) {
    const classes = useStyles();
    const { addSessionToReplayCart, replaySessionNow } = useInlineCompletionDebugContext();
    return (
        <>
            <div className={classes.datasetCell}>
                <Checkbox
                    checked={entry.included}
                    onChange={(_, data) => onToggleTrace(entry.fileKey, data.checked === true)}
                />
            </div>
            <div
                className={mergeClasses(classes.datasetCell, classes.mono, classes.truncate)}
                title={entry.loadError ?? `${entry.path} (right-click to add to replay trace)`}
                onContextMenu={(event) => {
                    event.preventDefault();
                    addSessionToReplayCart(entry.fileKey);
                }}>
                {entry.filename}
            </div>
            <div className={mergeClasses(classes.datasetCell, classes.mono, classes.savedCell)}>
                {entry.savedAt ? formatShortDate(entry.savedAt) : "--"}
            </div>
            <div className={mergeClasses(classes.datasetCell, classes.mono)}>
                {entry.eventCount.toLocaleString()}
            </div>
            <div className={mergeClasses(classes.datasetCell, classes.mono)}>
                {formatBytes(entry.fileSizeBytes)}
            </div>
            <div className={mergeClasses(classes.datasetCell, classes.truncate)}>
                {entry.profile ?? "--"}
            </div>
            <div className={mergeClasses(classes.datasetCell, classes.truncate)}>
                {entry.schemaMode ?? entry.schemaSizeKind ?? "--"}
            </div>
            <div className={classes.datasetCell}>
                <div className={classes.traceToggleActions}>
                    <Button
                        className={classes.compactButton}
                        size="small"
                        disabled={entry.eventCount === 0}
                        onClick={() => addSessionToReplayCart(entry.fileKey)}>
                        Add
                    </Button>
                    <Button
                        className={classes.compactButton}
                        size="small"
                        disabled={entry.eventCount === 0}
                        onClick={() => replaySessionNow(entry.fileKey)}>
                        Run
                    </Button>
                </div>
            </div>
        </>
    );
}

function SummaryTiles({
    metrics,
    traceCount,
    configCount,
}: {
    metrics: ReturnType<typeof computeInlineCompletionMetrics>;
    traceCount: number;
    configCount: number;
}) {
    const classes = useStyles();
    return (
        <div className={classes.summary}>
            <StatTile
                label="Events"
                value={metrics.count.toLocaleString()}
                hint={`${traceCount} traces`}
            />
            <StatTile
                label="Latency mean"
                value={formatDuration(metrics.latencyMean)}
                hint={`p95 ${formatDuration(metrics.latencyP95)}`}
            />
            <StatTile
                label="Latency p99"
                value={formatDuration(metrics.latencyP99)}
                hint={`max ${formatDuration(metrics.latencyMax)}`}
            />
            <StatTile
                label="Accept rate"
                value={formatPercent(metrics.acceptRate)}
                hint={`${metrics.acceptedCount}/${metrics.count}`}
            />
            <StatTile
                label="Input tokens"
                value={formatCompact(metrics.inputTokensSum)}
                hint={`avg ${formatCompact(metrics.inputTokensMean)}`}
            />
            <StatTile
                label="Output tokens"
                value={formatCompact(metrics.outputTokensSum)}
                hint={`avg ${formatCompact(metrics.outputTokensMean)}`}
            />
            <StatTile
                label="Configs"
                value={configCount.toLocaleString()}
                hint="model x profile x schema"
            />
        </div>
    );
}

function StatTile({ label, value, hint }: { label: string; value: string; hint: string }) {
    const classes = useStyles();
    return (
        <div className={classes.statTile}>
            <Text className={classes.statLabel}>{label}</Text>
            <Text className={classes.statValue}>
                {value}
                <span className={classes.statHint}>{hint}</span>
            </Text>
        </div>
    );
}

function FilterRail({
    events,
    filters,
    onFacetChange,
    onClear,
    onCollapse,
    onLatencyBoundChange,
}: {
    events: InlineCompletionDebugEvent[];
    filters: InlineCompletionAnalysisFilters;
    onFacetChange: (
        dimension: InlineCompletionAnalysisDimension,
        value: string,
        checked: boolean,
    ) => void;
    onClear: () => void;
    onCollapse: () => void;
    onLatencyBoundChange: (key: "min" | "max", value: string) => void;
}) {
    const classes = useStyles();
    return (
        <div className={classes.filters}>
            <div className={classes.filterHeader}>
                <Text className={classes.statLabel}>Filters</Text>
                <div className={classes.filterHeaderActions}>
                    <Button appearance="subtle" size="small" onClick={onClear}>
                        Clear
                    </Button>
                    <FluentTooltip content="Collapse filters" relationship="label">
                        <Button
                            appearance="subtle"
                            size="small"
                            icon={<ChevronLeft16Regular />}
                            onClick={onCollapse}
                        />
                    </FluentTooltip>
                </div>
            </div>
            {dimensions.map((dimension) => (
                <Facet
                    key={dimension.key}
                    dimension={dimension.key}
                    title={dimension.label}
                    counts={createFacetCounts(events, dimension.key)}
                    selected={getSelectedFacetValues(filters, dimension.key)}
                    onChange={onFacetChange}
                />
            ))}
            <div className={classes.facet}>
                <div className={classes.facetTitle}>Latency</div>
                <div className={classes.numericFilters}>
                    <Field label="Min ms">
                        <Input
                            size="small"
                            type="number"
                            value={filters.latencyRange?.min?.toString() ?? ""}
                            onChange={(_, data) => onLatencyBoundChange("min", data.value)}
                        />
                    </Field>
                    <Field label="Max ms">
                        <Input
                            size="small"
                            type="number"
                            value={filters.latencyRange?.max?.toString() ?? ""}
                            onChange={(_, data) => onLatencyBoundChange("max", data.value)}
                        />
                    </Field>
                </div>
            </div>
        </div>
    );
}

function Facet({
    dimension,
    title,
    counts,
    selected,
    onChange,
}: {
    dimension: InlineCompletionAnalysisDimension;
    title: string;
    counts: Array<{ value: string; count: number }>;
    selected: string[];
    onChange: (
        dimension: InlineCompletionAnalysisDimension,
        value: string,
        checked: boolean,
    ) => void;
}) {
    const classes = useStyles();
    const max = counts[0]?.count ?? 1;
    return (
        <div className={classes.facet}>
            <div className={classes.facetTitle}>{title}</div>
            {counts.slice(0, 12).map((item) => (
                <div key={item.value} className={classes.facetRow}>
                    <div
                        className={classes.facetBar}
                        style={{ width: `${Math.max(4, (item.count / max) * 78)}%` }}
                    />
                    <Checkbox
                        className={classes.facetCheckbox}
                        checked={selected.includes(item.value)}
                        label={item.value}
                        onChange={(_, data) =>
                            onChange(dimension, item.value, data.checked === true)
                        }
                    />
                    <Text className={classes.facetCount}>{item.count.toLocaleString()}</Text>
                </div>
            ))}
        </div>
    );
}

function DimensionDropdown({
    value,
    onChange,
}: {
    value: InlineCompletionAnalysisDimension;
    onChange: (value: InlineCompletionAnalysisDimension) => void;
}) {
    return (
        <Dropdown
            size="small"
            selectedOptions={[value]}
            value={dimensions.find((dimension) => dimension.key === value)?.label ?? value}
            onOptionSelect={(_, data) =>
                onChange(data.optionValue as InlineCompletionAnalysisDimension)
            }>
            {dimensions.map((dimension) => (
                <Option key={dimension.key} value={dimension.key}>
                    {dimension.label}
                </Option>
            ))}
        </Dropdown>
    );
}

function SecondaryDimensionDropdown({
    value,
    onChange,
}: {
    value: InlineCompletionAnalysisDimension | "none";
    onChange: (value: InlineCompletionAnalysisDimension | "none") => void;
}) {
    const label =
        value === "none"
            ? "(none)"
            : (dimensions.find((dimension) => dimension.key === value)?.label ?? value);
    return (
        <Dropdown
            size="small"
            selectedOptions={[value]}
            value={label}
            onOptionSelect={(_, data) =>
                onChange(data.optionValue as InlineCompletionAnalysisDimension | "none")
            }>
            <Option value="none">(none)</Option>
            {dimensions.map((dimension) => (
                <Option key={dimension.key} value={dimension.key}>
                    {dimension.label}
                </Option>
            ))}
        </Dropdown>
    );
}

function PivotTable({
    rows,
    selectedKey,
    primaryDimension,
    onSelect,
}: {
    rows: InlineCompletionPivotRow[];
    selectedKey: string | undefined;
    primaryDimension: InlineCompletionAnalysisDimension;
    onSelect: (row: InlineCompletionPivotRow) => void;
}) {
    const classes = useStyles();
    const maxCount = Math.max(1, ...rows.map((row) => row.metrics.count));
    const primaryLabel = dimensions.find((dimension) => dimension.key === primaryDimension)?.label;
    return (
        <table className={classes.pivotTable}>
            <colgroup>
                <col className={classes.pivotNameColumn} />
                <col className={classes.pivotCountColumn} />
                <col className={classes.pivotSampleColumn} />
                {Array.from({ length: 7 }).map((_, index) => (
                    <col key={index} className={classes.pivotMetricColumn} />
                ))}
                <col className={classes.pivotSchemaColumn} />
            </colgroup>
            <thead>
                <tr>
                    <th className={mergeClasses(classes.pivotHeaderCell, classes.pivotHeaderName)}>
                        {primaryLabel ?? "Group"}
                    </th>
                    <th className={classes.pivotHeaderCell}>N</th>
                    <th className={classes.pivotHeaderCell}>Sample</th>
                    <th className={classes.pivotHeaderCell}>Lat mean</th>
                    <th className={classes.pivotHeaderCell}>Lat p95</th>
                    <th className={classes.pivotHeaderCell}>Lat p99</th>
                    <th className={classes.pivotHeaderCell}>Accept</th>
                    <th className={classes.pivotHeaderCell}>Errors</th>
                    <th className={classes.pivotHeaderCell}>In tok</th>
                    <th className={classes.pivotHeaderCell}>Out tok</th>
                    <th className={classes.pivotHeaderCell}>Schema chars</th>
                </tr>
            </thead>
            <tbody>
                {rows.map((row) => (
                    <tr
                        key={row.key}
                        className={mergeClasses(
                            classes.pivotRow,
                            row.key === selectedKey && classes.selectedPivotRow,
                            row.metrics.count < 30 && classes.lowConfidence,
                        )}
                        onClick={() => onSelect(row)}>
                        <td className={mergeClasses(classes.pivotCell, classes.pivotNameCell)}>
                            {row.label}
                        </td>
                        <td className={classes.pivotCell}>{row.metrics.count.toLocaleString()}</td>
                        <td className={mergeClasses(classes.pivotCell, classes.sampleCell)}>
                            <SampleIndicator count={row.metrics.count} maxCount={maxCount} />
                        </td>
                        <td className={classes.pivotCell}>
                            {formatDuration(row.metrics.latencyMean)}
                        </td>
                        <td className={classes.pivotCell}>
                            {formatDuration(row.metrics.latencyP95)}
                        </td>
                        <td className={classes.pivotCell}>
                            {formatDuration(row.metrics.latencyP99)}
                        </td>
                        <td className={classes.pivotCell}>
                            {formatPercent(row.metrics.acceptRate)}
                        </td>
                        <td className={classes.pivotCell}>
                            {formatPercent(row.metrics.errorRate)}
                        </td>
                        <td className={classes.pivotCell}>
                            {formatCompact(row.metrics.inputTokensMean)}
                        </td>
                        <td className={classes.pivotCell}>
                            {formatCompact(row.metrics.outputTokensMean)}
                        </td>
                        <td className={classes.pivotCell}>
                            {formatCompact(row.metrics.meanSchemaContextChars)}
                        </td>
                    </tr>
                ))}
            </tbody>
        </table>
    );
}

function SampleIndicator({ count, maxCount }: { count: number; maxCount: number }) {
    const classes = useStyles();
    const color =
        count < 30 ? "var(--vscode-descriptionForeground)" : count < 200 ? "#d7daa0" : "#53cdb8";
    return (
        <div className={classes.sampleTrack}>
            <div
                className={classes.sampleFill}
                style={{
                    width: `${Math.max(6, (count / maxCount) * 100)}%`,
                    backgroundColor: color,
                }}
            />
        </div>
    );
}

function ChartsPanel({
    rows,
    events,
}: {
    rows: InlineCompletionPivotRow[];
    events: InlineCompletionDebugEvent[];
}) {
    const classes = useStyles();
    const groupData = rows.slice(0, 10).map((row) => ({
        name: row.label,
        latencyP95: Math.round(row.metrics.latencyP95),
        inputTokens: Math.round(row.metrics.inputTokensMean),
        outputTokens: Math.round(row.metrics.outputTokensMean),
        accepted: row.metrics.acceptedCount,
        rejected: row.metrics.rejectedCount,
        cancelled: row.metrics.cancelledCount,
        error: row.metrics.errorCount,
    }));
    const timeSeriesData = useMemo(() => createTimeSeriesPoints(events), [events]);
    const groupChartHeight = getGroupChartHeight(groupData.length);
    return (
        <div className={classes.sideCharts}>
            <div className={classes.chartPanel}>
                <div className={classes.chartTitle}>By group · latency p95</div>
                <div className={classes.chartBox} style={{ height: groupChartHeight }}>
                    <ResponsiveContainer>
                        <BarChart data={groupData} layout="vertical" margin={chartMargin}>
                            <CartesianGrid stroke="var(--vscode-panel-border)" horizontal={false} />
                            <XAxis type="number" hide />
                            <YAxis
                                type="category"
                                dataKey="name"
                                width={112}
                                tick={axisTick}
                                interval={0}
                            />
                            <RechartsTooltip
                                contentStyle={tooltipStyle}
                                formatter={(value) => `${value} ms`}
                            />
                            <Bar dataKey="latencyP95" fill="#5aa9e6" />
                        </BarChart>
                    </ResponsiveContainer>
                </div>
            </div>
            <div className={classes.chartPanel}>
                <div className={classes.chartTitle}>Acceptance funnel</div>
                <div className={classes.chartBox} style={{ height: groupChartHeight }}>
                    <ResponsiveContainer>
                        <BarChart data={groupData} layout="vertical" margin={chartMargin}>
                            <CartesianGrid stroke="var(--vscode-panel-border)" horizontal={false} />
                            <XAxis type="number" hide />
                            <YAxis
                                type="category"
                                dataKey="name"
                                width={112}
                                tick={axisTick}
                                interval={0}
                            />
                            <RechartsTooltip contentStyle={tooltipStyle} />
                            <Bar dataKey="accepted" stackId="result" fill="#53cdb8" />
                            <Bar dataKey="rejected" stackId="result" fill="#d7daa0" />
                            <Bar dataKey="cancelled" stackId="result" fill="#8f8f8f" />
                            <Bar dataKey="error" stackId="result" fill="#e06c75" />
                        </BarChart>
                    </ResponsiveContainer>
                </div>
            </div>
            <div className={classes.chartPanel}>
                <div className={classes.chartTitle}>Token cost in / out</div>
                <div className={classes.chartBox} style={{ height: groupChartHeight }}>
                    <ResponsiveContainer>
                        <BarChart data={groupData} layout="vertical" margin={chartMargin}>
                            <CartesianGrid stroke="var(--vscode-panel-border)" horizontal={false} />
                            <XAxis type="number" hide />
                            <YAxis
                                type="category"
                                dataKey="name"
                                width={112}
                                tick={axisTick}
                                interval={0}
                            />
                            <RechartsTooltip contentStyle={tooltipStyle} />
                            <Bar dataKey="inputTokens" stackId="tokens" fill="#5aa9e6" />
                            <Bar dataKey="outputTokens" stackId="tokens" fill="#53cdb8" />
                        </BarChart>
                    </ResponsiveContainer>
                </div>
            </div>
            <div className={classes.chartPanel}>
                <div className={classes.chartTitle}>Time series · latency p95</div>
                <div className={classes.chartBox}>
                    <ResponsiveContainer>
                        <LineChart data={timeSeriesData} margin={chartMargin}>
                            <CartesianGrid stroke="var(--vscode-panel-border)" vertical={false} />
                            <XAxis dataKey="bucket" tick={axisTick} minTickGap={16} />
                            <YAxis tick={axisTick} width={42} />
                            <RechartsTooltip
                                contentStyle={tooltipStyle}
                                labelFormatter={(_, points) =>
                                    points?.[0]?.payload?.range ?? "No events"
                                }
                                formatter={(value) => `${value} ms`}
                            />
                            <Line
                                type="monotone"
                                dataKey="latencyP95"
                                stroke="#53cdb8"
                                dot={false}
                                strokeWidth={2}
                            />
                        </LineChart>
                    </ResponsiveContainer>
                </div>
            </div>
        </div>
    );
}

function getGroupChartHeight(rowCount: number): number {
    if (rowCount <= 8) {
        return 132;
    }

    return Math.min(240, 198 + Math.max(0, rowCount - 10) * 18);
}

function updateFacetFilter(
    filters: InlineCompletionAnalysisFilters,
    dimension: InlineCompletionAnalysisDimension,
    value: string,
    checked: boolean,
): InlineCompletionAnalysisFilters {
    const key = getFilterKey(dimension);
    if (!key) {
        return filters;
    }

    const currentValues = getSelectedFacetValues(filters, dimension);
    const nextValues = checked
        ? Array.from(new Set([...currentValues, value]))
        : currentValues.filter((item) => item !== value);
    return {
        ...filters,
        [key]: coerceFilterValues(dimension, nextValues),
    };
}

function copySessionEventPayload(
    event: InlineCompletionDebugEvent,
    kind:
        | "id"
        | "json"
        | "prompt"
        | "systemPrompt"
        | "userPrompt"
        | "rawResponse"
        | "sanitizedResponse",
): void {
    let text = "";
    switch (kind) {
        case "id":
            text = event.id;
            break;
        case "json":
            text = JSON.stringify(event, undefined, 2);
            break;
        case "prompt":
            text = event.promptMessages
                .map((message, index) => `#${index + 1} ${message.role}\n${message.content}`)
                .join("\n\n");
            break;
        case "systemPrompt":
            text = event.promptMessages[0]?.content ?? "";
            break;
        case "userPrompt":
            text = event.promptMessages[1]?.content ?? "";
            break;
        case "rawResponse":
            text = event.rawResponse;
            break;
        case "sanitizedResponse":
            text = event.sanitizedResponse ?? event.finalCompletionText ?? "";
            break;
    }

    void navigator.clipboard?.writeText(text);
}

function getSelectedFacetValues(
    filters: InlineCompletionAnalysisFilters,
    dimension: InlineCompletionAnalysisDimension,
): string[] {
    switch (dimension) {
        case "model":
            return filters.models ?? [];
        case "profile":
            return filters.profiles ?? [];
        case "schemaMode":
            return filters.schemaModes ?? [];
        case "schemaSizeKind":
            return filters.schemaSizeKinds ?? [];
        case "intentMode":
            return (filters.intentModes ?? []).map((value) => (value ? "on" : "off"));
        case "result":
            return filters.results ?? [];
        case "trigger":
            return filters.triggers ?? [];
        case "language":
            return filters.languages ?? [];
        case "inferredSystemQuery":
            return (filters.inferredSystemQuery ?? []).map((value) => (value ? "yes" : "no"));
        case "completionCategory":
            return [];
        case "replayTrace":
            return filters.replayTraces ?? [];
        case "replayRun":
            return filters.replayRuns ?? [];
        case "replayMatrixCell":
            return filters.replayMatrixCells ?? [];
        case "replaySourceEvent":
            return filters.replaySourceEvents ?? [];
    }
}

function getFilterKey(
    dimension: InlineCompletionAnalysisDimension,
): keyof InlineCompletionAnalysisFilters | undefined {
    switch (dimension) {
        case "model":
            return "models";
        case "profile":
            return "profiles";
        case "schemaMode":
            return "schemaModes";
        case "schemaSizeKind":
            return "schemaSizeKinds";
        case "intentMode":
            return "intentModes";
        case "result":
            return "results";
        case "trigger":
            return "triggers";
        case "language":
            return "languages";
        case "inferredSystemQuery":
            return "inferredSystemQuery";
        case "completionCategory":
            return undefined;
        case "replayTrace":
            return "replayTraces";
        case "replayRun":
            return "replayRuns";
        case "replayMatrixCell":
            return "replayMatrixCells";
        case "replaySourceEvent":
            return "replaySourceEvents";
    }
}

function coerceFilterValues(
    dimension: InlineCompletionAnalysisDimension,
    values: string[],
): string[] | boolean[] {
    if (dimension === "intentMode" || dimension === "inferredSystemQuery") {
        return values.map((value) => value === "on" || value === "yes");
    }
    return values;
}

function flattenPivotRows(rows: InlineCompletionPivotRow[]): InlineCompletionPivotRow[] {
    return rows.flatMap((row) => [
        row,
        ...(row.children ?? []).map((child) => ({
            ...child,
            key: `${row.key}/${child.key}`,
            label: `${row.label} / ${child.label}`,
        })),
    ]);
}

function createSessionEventKey(
    fileKey: string,
    eventId: string | undefined,
    index: number,
): string {
    return `${fileKey}#${index}#${eventId || "missing-id"}`;
}

function exportPivotCsv(
    rows: InlineCompletionPivotRow[],
    dimension: InlineCompletionAnalysisDimension,
) {
    const header = [
        "dimension",
        "group",
        "count",
        "latencyMean",
        "latencyP95",
        "latencyP99",
        "acceptRate",
        "cancelRate",
        "rejectRate",
        "errorRate",
        "inputTokensMean",
        "inputTokensSum",
        "outputTokensMean",
        "outputTokensSum",
        "meanCompletionLength",
        "meanSchemaContextChars",
        "meanSchemaObjectCount",
    ];
    const lines = [
        header.join(","),
        ...rows.map((row) =>
            [
                dimension,
                row.label,
                row.metrics.count,
                Math.round(row.metrics.latencyMean),
                Math.round(row.metrics.latencyP95),
                Math.round(row.metrics.latencyP99),
                row.metrics.acceptRate,
                row.metrics.cancelRate,
                row.metrics.rejectRate,
                row.metrics.errorRate,
                row.metrics.inputTokensMean,
                row.metrics.inputTokensSum,
                row.metrics.outputTokensMean,
                row.metrics.outputTokensSum,
                row.metrics.meanCompletionLength,
                row.metrics.meanSchemaContextChars,
                row.metrics.meanSchemaObjectCount,
            ]
                .map(csvCell)
                .join(","),
        ),
    ];
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `mssql-copilot-trace-aggregation-${Date.now()}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
}

function createTimeSeriesPoints(
    events: InlineCompletionDebugEvent[],
): Array<{ bucket: string; range: string; latencyP95: number }> {
    if (events.length === 0) {
        return [];
    }
    const sorted = [...events].sort((left, right) => left.timestamp - right.timestamp);
    const bucketCount = Math.min(24, Math.max(6, Math.ceil(Math.sqrt(sorted.length))));
    const min = sorted[0]?.timestamp ?? 0;
    const max = sorted[sorted.length - 1]?.timestamp ?? min;
    const span = Math.max(1, max - min);
    const bucketSpan = span / bucketCount;
    const buckets = Array.from({ length: bucketCount }, () => [] as InlineCompletionDebugEvent[]);
    for (const event of sorted) {
        const index = Math.min(
            bucketCount - 1,
            Math.floor(((event.timestamp - min) / span) * bucketCount),
        );
        buckets[index]?.push(event);
    }
    return buckets.map((bucket, index) => ({
        bucket: formatTimeAxisLabel(min + bucketSpan * index, span),
        range: `${formatTimeAxisLabel(min + bucketSpan * index, span)}-${formatTimeAxisLabel(
            min + bucketSpan * (index + 1),
            span,
        )}`,
        latencyP95: Math.round(computeInlineCompletionMetrics(bucket).latencyP95),
    }));
}

function formatTimeAxisLabel(timestamp: number, span: number): string {
    return new Date(timestamp).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
        second: span <= 15 * 60 * 1000 ? "2-digit" : undefined,
        hour12: false,
    });
}

function countConfigs(events: InlineCompletionDebugEvent[]): number {
    return new Set(
        events.map((event) =>
            [
                getEventDimension(event, "model"),
                getEventDimension(event, "profile"),
                getEventDimension(event, "schemaMode"),
                getEventDimension(event, "intentMode"),
            ].join("|"),
        ),
    ).size;
}

function getDatasetRange(entries: InlineCompletionDebugTraceIndexEntry[]): string | undefined {
    const starts = entries
        .map((entry) => entry.dateRange?.start)
        .filter((value): value is number => typeof value === "number");
    const ends = entries
        .map((entry) => entry.dateRange?.end)
        .filter((value): value is number => typeof value === "number");
    if (starts.length === 0 || ends.length === 0) {
        return undefined;
    }
    return `${formatDateOnly(Math.min(...starts))} -> ${formatDateOnly(Math.max(...ends))}`;
}

function formatShortDate(value: string): string {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
        return value;
    }
    return `${date.toLocaleDateString()} ${date.toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
    })}`;
}

function formatDateOnly(value: number): string {
    return new Date(value).toLocaleDateString();
}

function formatBytes(value: number): string {
    if (value >= 1024 * 1024) {
        return `${(value / (1024 * 1024)).toFixed(1)} MB`;
    }
    return `${(value / 1024).toFixed(1)} KB`;
}

function formatDuration(value: number): string {
    if (value >= 1000) {
        return `${(value / 1000).toFixed(value >= 10_000 ? 1 : 2)}s`;
    }
    return `${Math.round(value)}ms`;
}

function formatPercent(value: number): string {
    return `${(value * 100).toFixed(1)}%`;
}

function asString(value: unknown): string | undefined {
    return typeof value === "string" && value.length > 0 ? value : undefined;
}

function formatCompact(value: number): string {
    if (!Number.isFinite(value)) {
        return "0";
    }
    if (Math.abs(value) >= 1_000_000) {
        return `${(value / 1_000_000).toFixed(1)}M`;
    }
    if (Math.abs(value) >= 1_000) {
        return `${(value / 1_000).toFixed(1)}k`;
    }
    return `${Math.round(value)}`;
}

function csvCell(value: unknown): string {
    const text = String(value ?? "");
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}
