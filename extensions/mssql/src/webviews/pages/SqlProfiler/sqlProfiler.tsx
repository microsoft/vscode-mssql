/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { LocConstants } from "../../common/locConstants";
import { Fragment, useContext, useLayoutEffect, useRef } from "react";
import {
    Badge,
    Button,
    Dropdown,
    Input,
    Menu,
    MenuButton,
    MenuItem,
    MenuList,
    MenuPopover,
    MenuTrigger,
    MessageBar,
    MessageBarActions,
    MessageBarBody,
    Option,
    Popover,
    PopoverSurface,
    PopoverTrigger,
    Spinner,
    Tab,
    TabList,
    Text,
    Tooltip,
    makeStyles,
    tokens,
} from "@fluentui/react-components";
import {
    Add16Regular,
    ArrowClockwise16Regular,
    ArrowDown16Regular,
    ArrowDownload16Regular,
    Broom16Regular,
    Delete16Regular,
    Dismiss16Regular,
    MoreHorizontal16Regular,
    Pause16Regular,
    Play16Regular,
    Save16Regular,
    QuestionCircle16Regular,
    Search16Regular,
    Stop16Regular,
} from "@fluentui/react-icons";

import {
    ProfilerCaptureStatus,
    ProfilerViewMode,
    describeCounts,
    describeGap,
    eventLabel,
    fieldLabel,
    formatDuration,
    formatElapsed,
    formatEventTime,
} from "../../../sharedInterfaces/sqlProfiler";
import { SqlProfilerContext } from "./sqlProfilerStateProvider";
import { useSqlProfilerSelector } from "./sqlProfilerSelector";

const useStyles = makeStyles({
    root: { display: "flex", flexDirection: "column", height: "100vh", overflow: "hidden" },

    toolbar: {
        display: "flex",
        alignItems: "center",
        columnGap: "6px",
        flexWrap: "wrap",
        rowGap: "6px",
        padding: "6px 12px",
        borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
    },
    // A thin rule between groups, so capture controls read separately from view controls.
    divider: {
        width: "1px",
        height: "20px",
        margin: "0 4px",
        backgroundColor: tokens.colorNeutralStroke2,
    },
    spacer: { flexGrow: 1 },
    search: { minWidth: "240px" },
    filterHelp: {
        display: "grid",
        gridTemplateColumns: "max-content 1fr",
        columnGap: "16px",
        rowGap: "6px",
        maxWidth: "440px",
        alignItems: "baseline",
    },
    filterSyntax: {
        fontFamily: tokens.fontFamilyMonospace,
        whiteSpace: "nowrap",
        color: tokens.colorNeutralForeground1,
    },

    statusBar: {
        display: "flex",
        alignItems: "center",
        columnGap: "14px",
        rowGap: "4px",
        flexWrap: "wrap",
        padding: "4px 12px",
        borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
        backgroundColor: tokens.colorNeutralBackground2,
        color: tokens.colorNeutralForeground3,
    },
    statusPill: {
        display: "inline-flex",
        alignItems: "center",
        columnGap: "6px",
        fontWeight: tokens.fontWeightSemibold,
    },
    liveDot: {
        width: "8px",
        height: "8px",
        borderRadius: "50%",
        backgroundColor: tokens.colorPaletteGreenForeground3,
    },
    pausedDot: {
        width: "8px",
        height: "8px",
        borderRadius: "50%",
        backgroundColor: tokens.colorPaletteYellowForeground3,
    },
    stoppedDot: {
        width: "8px",
        height: "8px",
        borderRadius: "50%",
        backgroundColor: tokens.colorNeutralForeground4,
    },
    metric: { display: "inline-flex", columnGap: "5px", alignItems: "baseline" },
    metricValue: { fontVariantNumeric: "tabular-nums", color: tokens.colorNeutralForeground1 },

    messages: { padding: "8px 12px", display: "flex", flexDirection: "column", rowGap: "6px" },

    body: { flexGrow: 1, minHeight: 0, display: "flex", flexDirection: "column" },
    gridArea: { position: "relative", flexGrow: 1, minHeight: 0, display: "flex" },
    gridWrap: { flexGrow: 1, minHeight: 0, overflow: "auto" },
    // Sits over the newest rows rather than in the toolbar, where the reader is already looking.
    jumpOverlay: {
        position: "absolute",
        bottom: "12px",
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 2,
        boxShadow: tokens.shadow16,
    },

    // Sticky headers need separate borders: with collapsed borders the browser paints the
    // table's own border layer over the sticky cell, so rows show through it when scrolling.
    table: {
        borderCollapse: "separate",
        borderSpacing: 0,
        width: "100%",
        fontSize: tokens.fontSizeBase200,
    },
    th: {
        position: "sticky",
        top: 0,
        zIndex: 1,
        textAlign: "left",
        whiteSpace: "nowrap",
        backgroundColor: tokens.colorNeutralBackground3,
        color: tokens.colorNeutralForeground2,
        fontWeight: tokens.fontWeightSemibold,
        padding: "6px 10px",
        borderBottom: `1px solid ${tokens.colorNeutralStroke1}`,
    },
    thNumeric: { textAlign: "right" },
    td: {
        padding: "3px 10px",
        borderBottom: `1px solid ${tokens.colorNeutralStroke3}`,
        whiteSpace: "nowrap",
        overflow: "hidden",
        textOverflow: "ellipsis",
        maxWidth: "520px",
    },
    tdTime: { fontVariantNumeric: "tabular-nums", color: tokens.colorNeutralForeground3 },
    numeric: { textAlign: "right", fontVariantNumeric: "tabular-nums" },
    eventName: { color: tokens.colorNeutralForeground2 },
    row: {
        cursor: "pointer",
        ":hover": { backgroundColor: tokens.colorNeutralBackground1Hover },
    },
    rowSelected: { backgroundColor: tokens.colorNeutralBackground1Selected },
    gapRow: {
        backgroundColor: tokens.colorStatusWarningBackground1,
        color: tokens.colorStatusWarningForeground1,
        fontStyle: "italic",
    },
    empty: { padding: "32px", color: tokens.colorNeutralForeground3, textAlign: "center" },

    // Details pane. Resizable so long statement text can be given room without losing the grid.
    details: {
        borderTop: `1px solid ${tokens.colorNeutralStroke2}`,
        backgroundColor: tokens.colorNeutralBackground2,
        height: "220px",
        minHeight: "80px",
        maxHeight: "70vh",
        overflow: "auto",
        resize: "vertical",
        padding: "8px 12px",
    },
    detailsHeader: {
        display: "flex",
        alignItems: "center",
        columnGap: "8px",
        marginBottom: "6px",
    },
    detailsGrid: {
        display: "grid",
        gridTemplateColumns: "minmax(120px, max-content) 1fr",
        columnGap: "16px",
        rowGap: "3px",
        alignItems: "start",
    },
    detailsKey: { color: tokens.colorNeutralForeground3, whiteSpace: "nowrap" },
    detailsValue: {
        fontFamily: tokens.fontFamilyMonospace,
        whiteSpace: "pre-wrap",
        overflowWrap: "anywhere",
    },
});

const VIEW_LABELS: Record<ProfilerViewMode, string> = {
    live: "Live events",
    topQueries: "Top queries",
};

/**
 * How close to the bottom still counts as "at the newest row".
 *
 * Rows are not a uniform height and a browser's scroll maths is fractional, so an exact
 * comparison would fall out of follow mode on its own.
 */
const TAIL_THRESHOLD_PX = 24;

const STATUS_TEXT: Record<ProfilerCaptureStatus, string> = {
    idle: "Not capturing",
    starting: "Starting",
    streaming: "Live",
    reconnecting: "Reconnecting",
    stopped: "Stopped",
    failed: "Failed",
};

const SqlProfilerPage = () => {
    const styles = useStyles();
    const context = useContext(SqlProfilerContext);
    const gridRef = useRef<HTMLDivElement>(null);
    /** Whether the viewport is parked at the newest row. Drives following, and survives renders. */
    const atTailRef = useRef(true);
    /**
     * True when scrolling up is what froze the grid.
     *
     * Scrolling back to the bottom lifts that freeze, but must never lift a pause the user asked
     * for: returning to the newest row is not a request to start the rows moving again.
     */
    const autoPausedRef = useRef(false);

    const status = useSqlProfilerSelector((s) => s.status);
    const statusDetail = useSqlProfilerSelector((s) => s.statusDetail);
    const viewMode = useSqlProfilerSelector((s) => s.viewMode);
    const sessionName = useSqlProfilerSelector((s) => s.sessionName);
    const sessionLabel = useSqlProfilerSelector((s) => s.sessionLabel);
    const sessions = useSqlProfilerSelector((s) => s.sessions);
    const deletion = useSqlProfilerSelector((s) => s.sessionDeletion);
    const sessionLoc = LocConstants.getInstance().profilerSessions;
    const templates = useSqlProfilerSelector((s) => s.templates);
    const orphanCount = useSqlProfilerSelector((s) => s.orphanCount);
    const rows = useSqlProfilerSelector((s) => s.rows);
    const gaps = useSqlProfilerSelector((s) => s.gaps);
    const topQueries = useSqlProfilerSelector((s) => s.topQueries);
    const columns = useSqlProfilerSelector((s) => s.columns);
    const capturedCount = useSqlProfilerSelector((s) => s.capturedCount);
    const retainedCount = useSqlProfilerSelector((s) => s.retainedCount);
    const renderedCount = useSqlProfilerSelector((s) => s.renderedCount);
    const lostCount = useSqlProfilerSelector((s) => s.lostCount);
    const health = useSqlProfilerSelector((s) => s.health);
    const isPaused = useSqlProfilerSelector((s) => s.isPaused);
    const pausedBacklog = useSqlProfilerSelector((s) => s.pausedBacklog);
    const pausedByUser = useSqlProfilerSelector((s) => s.pausedByUser);
    const filterExamples = useSqlProfilerSelector((s) => s.filterExamples);
    const filterText = useSqlProfilerSelector((s) => s.filterText);
    const queryFilterText = useSqlProfilerSelector((s) => s.queryFilterText);
    const selectedRowId = useSqlProfilerSelector((s) => s.selectedRowId);
    const selectedEvent = useSqlProfilerSelector((s) => s.selectedEvent);
    const isReadOnly = useSqlProfilerSelector((s) => s.isReadOnly);
    const sourceName = useSqlProfilerSelector((s) => s.sourceName);
    const errorMessage = useSqlProfilerSelector((s) => s.errorMessage);
    const autoScroll = useSqlProfilerSelector((s) => s.autoScroll);

    const isCapturing =
        status === "streaming" || status === "starting" || status === "reconnecting";
    const hasRows = rows.length > 0;
    const isFiltered = filterText.trim().length > 0 || queryFilterText !== undefined;

    // Following happens after layout and by setting scrollTop on the grid itself. scrollIntoView
    // can move ancestor scrollers too, which is how a "follow" turns into a page that jumps.
    useLayoutEffect(() => {
        if (!autoScroll || isPaused || viewMode !== "live") {
            return;
        }
        const el = gridRef.current;
        if (el) {
            el.scrollTop = el.scrollHeight;
            atTailRef.current = true;
        }
    }, [rows, autoScroll, isPaused, viewMode]);

    if (!context) {
        return <Spinner label="Loading" />;
    }

    /** Puts the viewport back on the newest row and starts following again. */
    const jumpToLatest = () => {
        context.setAutoScroll(true);
        autoPausedRef.current = false;
        if (isPaused) {
            context.setPaused(false);
        }
        const el = gridRef.current;
        if (el) {
            el.scrollTop = el.scrollHeight;
        }
        atTailRef.current = true;
    };

    /**
     * Scrolling away from the newest row hands control back to the reader.
     *
     * Following stops, and a live capture is also frozen: the grid renders a bounded window of
     * the newest events, so on a busy server the rows someone scrolled up to read would be
     * evicted and replaced under them within a second. Returning to the bottom resumes both.
     * Only transitions act, so an ordinary scroll does not chatter at the controller.
     */
    const handleGridScroll = () => {
        const el = gridRef.current;
        if (!el || viewMode !== "live") {
            return;
        }
        const distanceFromTail = el.scrollHeight - el.scrollTop - el.clientHeight;
        const atTail = distanceFromTail <= TAIL_THRESHOLD_PX;
        if (atTail === atTailRef.current) {
            return;
        }
        atTailRef.current = atTail;

        if (atTail) {
            if (!autoScroll) {
                context.setAutoScroll(true);
            }
            if (isPaused && autoPausedRef.current) {
                autoPausedRef.current = false;
                context.setPaused(false);
            }
            return;
        }

        if (autoScroll) {
            context.setAutoScroll(false);
        }
        if (!isPaused && isCapturing) {
            // Holds the rendered rows so they are not evicted mid-read. Capture is untouched:
            // events keep arriving, the counters keep moving, and the overlay says how many.
            autoPausedRef.current = true;
            context.setPaused(true, false);
        }
    };

    const renderStatusBar = () => (
        <div className={styles.statusBar}>
            <span className={styles.statusPill}>
                <span
                    className={
                        pausedByUser
                            ? styles.pausedDot
                            : status === "streaming"
                              ? styles.liveDot
                              : styles.stoppedDot
                    }
                />
                <Text size={200} weight="semibold">
                    {pausedByUser ? "Paused" : STATUS_TEXT[status]}
                </Text>
            </span>

            {sessionLabel && !isReadOnly && <Text size={200}>{sessionLabel}</Text>}

            {(isCapturing || health.elapsedMs > 0) && (
                <span className={styles.metric}>
                    <Text size={200}>Elapsed</Text>
                    <Text size={200} className={styles.metricValue}>
                        {formatElapsed(health.elapsedMs)}
                    </Text>
                </span>
            )}

            {isCapturing && (
                <span className={styles.metric}>
                    <Text size={200}>Rate</Text>
                    <Text size={200} className={styles.metricValue}>
                        {health.eventsPerSecond.toLocaleString()}/s
                    </Text>
                </span>
            )}

            <span className={styles.metric}>
                <Text size={200}>
                    {describeCounts(renderedCount, retainedCount, capturedCount, isFiltered)}
                </Text>
            </span>

            {health.discardedCount > 0 && (
                <Tooltip
                    content="Oldest events left the retained window to make room. They are gone, not hidden."
                    relationship="description">
                    <Text size={200}>{health.discardedCount.toLocaleString()} discarded</Text>
                </Tooltip>
            )}

            {health.queuedCount > 500 && (
                <Tooltip
                    content="Events waiting to be added to the window. A number that keeps climbing means the viewer is behind the server."
                    relationship="description">
                    <Badge appearance="outline" color="warning">
                        {health.queuedCount.toLocaleString()} queued
                    </Badge>
                </Tooltip>
            )}

            {lostCount > 0 && (
                <Tooltip
                    content="Events the server produced that never reached the profiler"
                    relationship="description">
                    <Badge appearance="filled" color="warning">
                        {lostCount.toLocaleString()} lost
                    </Badge>
                </Tooltip>
            )}

            <div className={styles.spacer} />

            {isPaused && pausedByUser && (
                <Button size="small" appearance="primary" onClick={jumpToLatest}>
                    Resume and follow
                </Button>
            )}
        </div>
    );

    const renderLive = () => {
        if (!hasRows) {
            return (
                <div className={styles.empty}>
                    {isFiltered
                        ? "No events match this filter."
                        : isCapturing
                          ? "Waiting for events…"
                          : isReadOnly
                            ? "This capture has no events."
                            : "Choose a session, or start a new one, to begin capturing."}
                </div>
            );
        }

        // Gaps are rendered inline, at the point in the sequence where events went missing, so
        // a hole in the capture can never be mistaken for a quiet server.
        const gapsBefore = new Map<number, typeof gaps>();
        for (const gap of gaps) {
            const list = gapsBefore.get(gap.fromSequence) ?? [];
            list.push(gap);
            gapsBefore.set(gap.fromSequence, list);
        }

        return (
            <table className={styles.table}>
                <thead>
                    <tr>
                        <th className={styles.th}>Time</th>
                        <th className={styles.th}>Event</th>
                        {columns.map((c) => (
                            <th
                                key={c}
                                className={`${styles.th} ${isNumericField(c) ? styles.thNumeric : ""}`}>
                                {fieldLabel(c)}
                            </th>
                        ))}
                    </tr>
                </thead>
                <tbody>
                    {rows.map((row) => {
                        const rowGaps = gapsBefore.get(row.id) ?? [];
                        const isSelected = row.id === selectedRowId;
                        return (
                            <Fragment key={row.id}>
                                {rowGaps.map((gap) => (
                                    <tr key={`gap-${gap.id}`} className={styles.gapRow}>
                                        <td className={styles.td} colSpan={columns.length + 2}>
                                            {describeGap(gap)}
                                        </td>
                                    </tr>
                                ))}
                                <tr
                                    className={`${styles.row} ${isSelected ? styles.rowSelected : ""}`}
                                    onClick={() => context.selectRow(row.id)}
                                    onDoubleClick={() =>
                                        row.values.query_hash && context.showPlan(row.id)
                                    }
                                    title={
                                        row.values.query_hash
                                            ? "Double-click to open the execution plan"
                                            : undefined
                                    }>
                                    <td className={`${styles.td} ${styles.tdTime}`}>
                                        {formatEventTime(row.timestamp)}
                                    </td>
                                    <td className={`${styles.td} ${styles.eventName}`}>
                                        {eventLabel(row.name)}
                                    </td>
                                    {columns.map((c) => (
                                        <td
                                            key={c}
                                            title={row.values[c]}
                                            className={`${styles.td} ${isNumericField(c) ? styles.numeric : ""}`}>
                                            {formatField(c, row.values[c])}
                                        </td>
                                    ))}
                                </tr>
                            </Fragment>
                        );
                    })}
                </tbody>
            </table>
        );
    };

    const renderTopQueries = () => {
        if (topQueries.length === 0) {
            return (
                <div className={styles.empty}>
                    No completed queries captured yet. Sessions that collect only starting events
                    have no duration or CPU to rank.
                </div>
            );
        }
        return (
            <table className={styles.table}>
                <thead>
                    <tr>
                        <th className={`${styles.th} ${styles.thNumeric}`}>Executions</th>
                        <th className={`${styles.th} ${styles.thNumeric}`}>Total duration</th>
                        <th className={`${styles.th} ${styles.thNumeric}`}>Avg</th>
                        <th className={`${styles.th} ${styles.thNumeric}`}>Max</th>
                        <th className={`${styles.th} ${styles.thNumeric}`}>Total CPU</th>
                        <th className={`${styles.th} ${styles.thNumeric}`}>Reads</th>
                        <th className={styles.th}>Query</th>
                    </tr>
                </thead>
                <tbody>
                    {topQueries.map((q) => (
                        <tr
                            key={q.key}
                            className={styles.row}
                            onClick={() => context.filterToQuery(q.key)}
                            title="Click to show only this query in the live view">
                            <td className={`${styles.td} ${styles.numeric}`}>
                                {q.count.toLocaleString()}
                            </td>
                            <td className={`${styles.td} ${styles.numeric}`}>
                                {formatDuration(q.totalDurationUs)}
                            </td>
                            <td className={`${styles.td} ${styles.numeric}`}>
                                {formatDuration(q.avgDurationUs)}
                            </td>
                            <td className={`${styles.td} ${styles.numeric}`}>
                                {formatDuration(q.maxDurationUs)}
                            </td>
                            <td className={`${styles.td} ${styles.numeric}`}>
                                {formatDuration(q.totalCpuUs)}
                            </td>
                            <td className={`${styles.td} ${styles.numeric}`}>
                                {q.totalLogicalReads.toLocaleString()}
                            </td>
                            <td className={styles.td} title={q.text}>
                                {q.text}
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
        );
    };

    return (
        <div className={styles.root}>
            <div className={styles.toolbar}>
                {!isReadOnly && (
                    <>
                        <Dropdown
                            placeholder="Choose a session"
                            value={sessionLabel ?? ""}
                            selectedOptions={sessionName ? [sessionName] : []}
                            disabled={isCapturing || deletion?.busy}
                            onOptionSelect={(_, data) =>
                                data.optionValue && context.start(data.optionValue)
                            }>
                            {sessions.map((s) => (
                                <Option key={s.name} value={s.name} text={s.label}>
                                    {s.label}
                                    {s.isRunning ? " (running)" : ""}
                                    {s.isOrphan ? " — left over" : ""}
                                </Option>
                            ))}
                        </Dropdown>

                        {isCapturing ? (
                            <Button
                                icon={<Stop16Regular />}
                                appearance="primary"
                                onClick={() => context.stop()}>
                                Stop
                            </Button>
                        ) : (
                            <Button
                                icon={<Play16Regular />}
                                appearance="primary"
                                disabled={
                                    deletion?.busy || !sessions.some((s) => s.name === sessionName)
                                }
                                onClick={() => sessionName && context.start(sessionName)}>
                                Start
                            </Button>
                        )}

                        <Menu>
                            <MenuTrigger disableButtonEnhancement>
                                <MenuButton
                                    icon={<Delete16Regular />}
                                    disabled={deletion?.busy || sessions.length === 0}>
                                    {sessionLoc.deleteSession}
                                </MenuButton>
                            </MenuTrigger>
                            <MenuPopover>
                                <MenuList>
                                    {sessions.map((session) => (
                                        <MenuItem
                                            key={session.name}
                                            onClick={() => context.dropSession(session.name)}>
                                            {session.isRunning
                                                ? sessionLoc.running(session.name)
                                                : session.name}
                                        </MenuItem>
                                    ))}
                                </MenuList>
                            </MenuPopover>
                        </Menu>

                        <Menu>
                            <MenuTrigger disableButtonEnhancement>
                                <MenuButton
                                    icon={<Add16Regular />}
                                    appearance="subtle"
                                    disabled={
                                        isCapturing || deletion?.busy || templates.length === 0
                                    }>
                                    New session
                                </MenuButton>
                            </MenuTrigger>
                            <MenuPopover>
                                <MenuList>
                                    {templates.map((t) => (
                                        <MenuItem
                                            key={t.id}
                                            onClick={() => context.createSession(t.id)}>
                                            <Tooltip content={t.description} relationship="label">
                                                <span>{t.title}</span>
                                            </Tooltip>
                                        </MenuItem>
                                    ))}
                                </MenuList>
                            </MenuPopover>
                        </Menu>

                        <div className={styles.divider} />
                    </>
                )}

                <Input
                    className={styles.search}
                    size="small"
                    placeholder="Filter, e.g. duration:>100ms"
                    value={filterText}
                    contentBefore={<Search16Regular />}
                    contentAfter={
                        filterText ? (
                            <Button
                                appearance="transparent"
                                size="small"
                                icon={<Dismiss16Regular />}
                                aria-label="Clear filter"
                                onClick={() => context.setFilter("")}
                            />
                        ) : undefined
                    }
                    onChange={(_, data) => context.setFilter(data.value)}
                />

                <Popover withArrow>
                    <PopoverTrigger disableButtonEnhancement>
                        <Button
                            appearance="subtle"
                            size="small"
                            icon={<QuestionCircle16Regular />}
                            aria-label="Filter syntax"
                        />
                    </PopoverTrigger>
                    <PopoverSurface>
                        <Text weight="semibold">Filter syntax</Text>
                        <div className={styles.filterHelp} style={{ marginTop: "8px" }}>
                            {filterExamples.map((e) => (
                                <Fragment key={e.syntax}>
                                    <span className={styles.filterSyntax}>{e.syntax}</span>
                                    <Text size={200}>{e.meaning}</Text>
                                </Fragment>
                            ))}
                        </div>
                        <Text size={200} style={{ display: "block", marginTop: "10px" }}>
                            Terms combine, so each one narrows further. Fields also take their full
                            Extended Events names.
                        </Text>
                    </PopoverSurface>
                </Popover>

                <Button
                    icon={isPaused ? <Play16Regular /> : <Pause16Regular />}
                    appearance="subtle"
                    disabled={viewMode !== "live"}
                    title="Freezes the grid. Capture keeps running."
                    onClick={() => {
                        autoPausedRef.current = false;
                        context.setPaused(!isPaused, true);
                    }}>
                    {isPaused ? "Resume" : "Pause"}
                </Button>

                <Button
                    icon={<ArrowDownload16Regular />}
                    appearance={autoScroll ? "outline" : "subtle"}
                    disabled={viewMode !== "live"}
                    title="Keeps the newest row in view. Scrolling up turns this off."
                    onClick={() => (autoScroll ? context.setAutoScroll(false) : jumpToLatest())}>
                    Follow
                </Button>

                <div className={styles.spacer} />

                <TabList
                    size="small"
                    selectedValue={viewMode}
                    onTabSelect={(_, data) => context.setViewMode(data.value as ProfilerViewMode)}>
                    {(Object.keys(VIEW_LABELS) as ProfilerViewMode[]).map((mode) => (
                        <Tab key={mode} value={mode}>
                            {VIEW_LABELS[mode]}
                        </Tab>
                    ))}
                </TabList>

                <Menu>
                    <MenuTrigger disableButtonEnhancement>
                        <MenuButton
                            icon={<MoreHorizontal16Regular />}
                            appearance="subtle"
                            aria-label="More actions"
                        />
                    </MenuTrigger>
                    <MenuPopover>
                        <MenuList>
                            <MenuItem
                                icon={<Save16Regular />}
                                disabled={!hasRows}
                                onClick={() => context.saveCapture()}>
                                Save capture
                            </MenuItem>
                            <MenuItem
                                icon={<ArrowDownload16Regular />}
                                disabled={!hasRows}
                                onClick={() => context.exportCsv()}>
                                Export CSV
                            </MenuItem>
                            <MenuItem
                                icon={<Delete16Regular />}
                                disabled={!hasRows}
                                onClick={() => context.clear()}>
                                {sessionLoc.clearEvents}
                            </MenuItem>
                            {!isReadOnly && (
                                <MenuItem
                                    icon={<ArrowClockwise16Regular />}
                                    onClick={() => context.refreshSessions()}>
                                    Refresh session list
                                </MenuItem>
                            )}
                        </MenuList>
                    </MenuPopover>
                </Menu>
            </div>

            {renderStatusBar()}
            {deletion && (
                <MessageBar
                    intent={deletion.error ? "error" : deletion.completed ? "success" : "info"}>
                    {deletion.busy
                        ? sessionLoc.deleting(deletion.sessionName)
                        : deletion.error
                          ? sessionLoc.failed(deletion.sessionName, deletion.error)
                          : deletion.completed
                            ? sessionLoc.deleted(deletion.sessionName)
                            : ""}
                </MessageBar>
            )}

            {(errorMessage || statusDetail || orphanCount > 0 || isReadOnly || queryFilterText) && (
                <div className={styles.messages}>
                    {errorMessage && <MessageBar intent="error">{errorMessage}</MessageBar>}
                    {status === "reconnecting" && statusDetail && (
                        <MessageBar intent="warning">{statusDetail}</MessageBar>
                    )}
                    {status === "failed" && statusDetail && (
                        <MessageBar intent="error">{statusDetail}</MessageBar>
                    )}
                    {isReadOnly && sourceName && (
                        <MessageBar intent="info">
                            Viewing {sourceName}. Capture controls are unavailable for a saved file.
                        </MessageBar>
                    )}
                    {queryFilterText && (
                        <MessageBar intent="info">
                            <MessageBarBody>Showing one query only.</MessageBarBody>
                            <MessageBarActions>
                                <Button size="small" onClick={() => context.filterToQuery("")}>
                                    Show all
                                </Button>
                            </MessageBarActions>
                        </MessageBar>
                    )}
                    {orphanCount > 0 && !isReadOnly && (
                        <MessageBar intent="warning">
                            <MessageBarBody>
                                {orphanCount} profiler session{orphanCount === 1 ? "" : "s"} from an
                                earlier run {orphanCount === 1 ? "is" : "are"} still running on this
                                server and consuming memory.
                            </MessageBarBody>
                            <MessageBarActions>
                                <Button
                                    icon={<Broom16Regular />}
                                    size="small"
                                    onClick={() => context.cleanUpOrphans()}>
                                    Clean up
                                </Button>
                            </MessageBarActions>
                        </MessageBar>
                    )}
                </div>
            )}

            <div className={styles.body}>
                <div className={styles.gridArea}>
                    <div ref={gridRef} className={styles.gridWrap} onScroll={handleGridScroll}>
                        {viewMode === "live" ? renderLive() : renderTopQueries()}
                    </div>

                    {viewMode === "live" && !autoScroll && !pausedByUser && (
                        <Button
                            className={styles.jumpOverlay}
                            appearance="primary"
                            size="small"
                            icon={<ArrowDown16Regular />}
                            onClick={jumpToLatest}>
                            {pausedBacklog > 0
                                ? `${pausedBacklog.toLocaleString()} new events — jump to latest`
                                : "Jump to latest"}
                        </Button>
                    )}
                </div>

                {selectedEvent && (
                    <div className={styles.details}>
                        <div className={styles.detailsHeader}>
                            <Text weight="semibold">{selectedEvent.name}</Text>
                            <Text size={200}>{formatEventTime(selectedEvent.timestamp)}</Text>
                            <div className={styles.spacer} />
                            <Button
                                appearance="subtle"
                                size="small"
                                icon={<Dismiss16Regular />}
                                aria-label="Close details"
                                onClick={() => context.selectRow(undefined)}
                            />
                        </div>
                        <div className={styles.detailsGrid}>
                            {selectedEvent.fields.map(([key, value]) => (
                                <Fragment key={key}>
                                    <span className={styles.detailsKey}>{fieldLabel(key)}</span>
                                    <span className={styles.detailsValue}>
                                        {formatField(key, value)}
                                    </span>
                                </Fragment>
                            ))}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

const NUMERIC_FIELDS = new Set([
    "duration",
    "cpu_time",
    "logical_reads",
    "physical_reads",
    "page_server_reads",
    "writes",
    "spills",
    "row_count",
    "session_id",
    "error_number",
    "severity",
]);

function isNumericField(field: string): boolean {
    return NUMERIC_FIELDS.has(field);
}

/** Durations arrive in microseconds, which is easy to misread by a factor of 1000. */
function formatField(field: string, value: string | undefined): string {
    if (value === undefined) {
        return "";
    }
    if (field === "duration" || field === "cpu_time") {
        const n = Number(value);
        return Number.isFinite(n) ? formatDuration(n) : value;
    }
    if (isNumericField(field)) {
        const n = Number(value);
        return Number.isFinite(n) ? n.toLocaleString() : value;
    }
    return value;
}

export default SqlProfilerPage;
