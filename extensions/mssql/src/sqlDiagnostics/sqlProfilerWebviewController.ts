/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import { SqlFeatures } from "../constants/locConstants";

import {
    CaptureFile,
    EventGap,
    ProfilerEvent,
    ProfilerEventBuffer,
    ProfilerLiveStream,
    ProfilerSessionManager,
    buildCapture,
    buildCreateStatement,
    FILTER_EXAMPLES,
    eventsToCsv,
    matchesFilter,
    parseFilter,
    readXelFileAll,
    serializeCapture,
    templatesFor,
} from "sql-feature/diagnostics/profiler";
import { ServerCapabilities } from "sql-feature/core";

import {
    ProfilerGapMarker,
    ProfilerRow,
    ProfilerViewMode,
    SqlProfilerReducers,
    SqlProfilerState,
    eventLabel,
} from "../sharedInterfaces/sqlProfiler";
import { WebviewPanelController } from "../controllers/webviewPanelController";
import { DataPlaneRunner } from "./dataPlaneRunner";
import { DiagnosticsAdapter } from "./diagnosticsAdapter";
import { WorkspaceClaimStore } from "./claimStore";
import { getErrorMessage } from "../utils/utils";

/** Columns shown in the live grid, in order, when the session collects them. */
const DEFAULT_COLUMNS = [
    "batch_text",
    "duration",
    "cpu_time",
    "logical_reads",
    "row_count",
    "database_name",
    "client_app_name",
    "session_id",
];

/** How many events the grid renders at once. The buffer keeps more; this is a view bound. */
const RENDERED_ROWS = 500;

/** Window over which the event rate is averaged, long enough not to flicker. */
const RATE_WINDOW_MS = 3000;

/** How often accumulated events are pushed to the webview. */
const FLUSH_INTERVAL_MS = 250;

export interface SqlProfilerOptions {
    /** Absent when the panel only views a file, which needs no server. */
    readonly runner?: DataPlaneRunner;
    readonly capabilities?: ServerCapabilities;
    readonly connectionLabel: string;
    readonly serverKey: string;
    /** Retained event window; comes from mssql.profiler.eventBufferSize. */
    readonly bufferSize: number;
}

/**
 * Drives the profiler panel: session lifecycle, the live stream, the retained window, and the
 * top-queries view.
 *
 * Losses are first-class here. A gap in the capture is rendered inline and counted separately
 * from retained rows, because a hole a user cannot see is worse than one they can.
 */
export class SqlProfilerWebviewController extends WebviewPanelController<
    SqlProfilerState,
    SqlProfilerReducers
> {
    private readonly _diagnostics = new DiagnosticsAdapter();
    private readonly _buffer: ProfilerEventBuffer;
    private readonly _sessions?: ProfilerSessionManager;

    private _stream?: ProfilerLiveStream;
    private _pending: ProfilerEvent[] = [];
    private _flushTimer?: NodeJS.Timeout;
    private _captured = 0;
    private _lost = 0;
    private _gapId = 0;
    private _localId = 0;
    private _queryFilter?: string;
    private _textFilter = "";
    /** Fields seen at any point in this capture, so the table does not change shape mid-scroll. */
    private _seenFields = new Set<string>();
    private _paused = false;
    /** Events added to the window since the grid was frozen. */
    private _pausedBacklog = 0;
    private _startedAtMs?: number;
    /** Rolling (timestamp, cumulative count) samples behind the events-per-second figure. */
    private _rateSamples: { at: number; count: number }[] = [];

    constructor(
        context: vscode.ExtensionContext,
        private readonly _profiler: SqlProfilerOptions,
    ) {
        super(
            context,
            "sqlProfiler",
            "sqlProfiler",
            {
                status: "idle",
                viewMode: "live",
                sessions: [],
                orphanCount: 0,
                templates: [],
                rows: [],
                gaps: [],
                topQueries: [],
                columns: DEFAULT_COLUMNS,
                capturedCount: 0,
                retainedCount: 0,
                renderedCount: 0,
                lostCount: 0,
                health: {
                    eventsPerSecond: 0,
                    elapsedMs: 0,
                    queuedCount: 0,
                    discardedCount: 0,
                },
                isPaused: false,
                pausedByUser: false,
                pausedBacklog: 0,
                filterText: "",
                filterExamples: FILTER_EXAMPLES.map((e) => ({ ...e })),
                isReadOnly: false,
                autoScroll: true,
            },
            {
                title: `Profiler: ${_profiler.connectionLabel}`,
                viewColumn: vscode.ViewColumn.Active,
                iconPath: vscode.Uri.joinPath(context.extensionUri, "media", "database.svg"),
            },
        );

        this._buffer = new ProfilerEventBuffer(_profiler.bufferSize);

        if (
            _profiler.runner &&
            _profiler.capabilities &&
            _profiler.capabilities.xeventScope !== "none"
        ) {
            this._sessions = new ProfilerSessionManager({
                runner: _profiler.runner,
                capabilities: _profiler.capabilities,
                claims: new WorkspaceClaimStore(context),
                serverKey: _profiler.serverKey,
                diagnostics: this._diagnostics,
            });
        }

        this.state.templates = _profiler.capabilities
            ? templatesFor(_profiler.capabilities).map((t) => ({
                  id: t.id,
                  title: t.title,
                  description: t.description,
              }))
            : [];

        this.registerReducers();
        // A file panel has no server to list sessions from, and saying so as an error would be
        // misleading: nothing is wrong.
        if (_profiler.runner) {
            void this.refreshSessions();
        }
    }

    // -----------------------------------------------------------------------
    // Read-only sources
    // -----------------------------------------------------------------------

    /** Loads a .xel file for review. No capture controls apply to a file. */
    async loadXelFile(filePath: string, displayName: string): Promise<void> {
        try {
            const events = await readXelFileAll(filePath);
            this.showReadOnly(events, [], displayName);
        } catch (error) {
            this.state.errorMessage = `Could not read ${displayName}: ${getErrorMessage(error)}`;
            this.updateState();
        }
    }

    /** Reopens a saved capture, gaps included. */
    async loadCapture(capture: CaptureFile, displayName: string): Promise<void> {
        this.showReadOnly(capture.events, capture.gaps, displayName);
    }

    private showReadOnly(
        events: readonly ProfilerEvent[],
        gaps: readonly EventGap[],
        sourceName: string,
    ): void {
        this._buffer.clear();
        this._seenFields.clear();
        this._buffer.add(events);
        for (const gap of gaps) {
            this._buffer.addGap(gap);
            this.state.gaps.push(this.toMarker(gap));
        }
        this._captured = events.length;
        this._lost = gaps.reduce((sum, g) => sum + g.count, 0);

        this.state.isReadOnly = true;
        this.state.sourceName = sourceName;
        this.state.status = "stopped";
        this.publish();
    }

    // -----------------------------------------------------------------------
    // Capture
    // -----------------------------------------------------------------------

    private async start(sessionName: string): Promise<void> {
        const runner = this._profiler.runner;
        if (
            this.state.isReadOnly ||
            this.state.sessionDeletion?.busy ||
            !this._sessions ||
            !runner
        ) {
            return;
        }
        if (!this.state.sessions.some((session) => session.name === sessionName)) return;
        await this.stop();

        this.state.sessionName = sessionName;
        this.state.sessionLabel = this.sessionLabel(sessionName);
        this.state.errorMessage = undefined;
        this.updateState();

        try {
            // The session must be running before the stream attaches, or it reads nothing.
            await this._sessions.start(sessionName);
        } catch (error) {
            this.state.status = "failed";
            this.state.errorMessage = `Could not start "${sessionName}": ${getErrorMessage(error)}`;
            this.updateState();
            return;
        }

        this._stream = new ProfilerLiveStream({
            runner,
            sessionName,
            diagnostics: this._diagnostics,
            callbacks: {
                onEvents: (events) => {
                    this._pending.push(...events);
                    this._captured += events.length;
                },
                onGap: (gap) => {
                    this._buffer.addGap(gap);
                    this.state.gaps.push(this.toMarker(gap));
                    this._lost += gap.count;
                },
                onStatus: (status, detail) => {
                    this.state.status = status;
                    this.state.statusDetail = detail;
                    this.updateState();
                },
            },
        });

        this._startedAtMs = Date.now();
        this._rateSamples = [{ at: Date.now(), count: this._captured }];
        this._seenFields.clear();
        this.startFlushing();
        await this._stream.start();
        // Keep the claim fresh so a live session is never mistaken for a leak.
        await this._sessions.renew(sessionName);
    }

    private async stop(): Promise<void> {
        this.stopFlushing();
        const stream = this._stream;
        this._stream = undefined;
        if (stream) {
            await stream.stop();
        }
        this.flush();
    }

    /**
     * Events accumulate and are pushed on a timer. A busy server produces tens of thousands a
     * second, and posting each one would flood the webview with messages it cannot render.
     */
    private startFlushing(): void {
        this.stopFlushing();
        this._flushTimer = setInterval(() => this.flush(), FLUSH_INTERVAL_MS);
    }

    private stopFlushing(): void {
        if (this._flushTimer) {
            clearInterval(this._flushTimer);
            this._flushTimer = undefined;
        }
    }

    private flush(): void {
        if (this._pending.length === 0) {
            // Still refresh the clock and rate while idle, or a quiet server looks frozen.
            if (this.state.status === "streaming") {
                this.publishCounts();
                this.updateState();
            }
            return;
        }
        if (this._paused) {
            this._pausedBacklog += this._pending.length;
        }
        this._buffer.add(this._pending);
        this._pending = [];
        this.publish();
    }

    // -----------------------------------------------------------------------
    // Sessions
    // -----------------------------------------------------------------------

    private async refreshSessions(): Promise<void> {
        if (!this._sessions) {
            this.state.errorMessage =
                "Extended Events sessions are not available on this kind of server.";
            this.updateState();
            return;
        }

        try {
            const sessions = await this._sessions.list();
            const orphans = await this._sessions.findOrphans();
            const orphanNames = new Set(orphans.map((o) => o.name));

            this.state.sessions = sessions.map((s) => ({
                name: s.name,
                label: this.sessionLabel(s.name),
                isRunning: s.isRunning,
                ownedByThisClient: s.ownedByThisClient,
                isOrphan: orphanNames.has(s.name),
            }));
            this.state.orphanCount = orphans.length;
            this.updateState();
        } catch (error) {
            this.state.errorMessage = getErrorMessage(error);
            this.updateState();
        }
    }

    /**
     * Creates a session from a built-in template and starts capturing from it.
     *
     * The name carries the template and a timestamp so two panels never collide on one session
     * object, and so a leftover session is recognisable as this extension's when found later.
     */
    private async createSession(templateId: string): Promise<void> {
        const capabilities = this._profiler.capabilities;
        if (
            this.state.isReadOnly ||
            this.state.sessionDeletion?.busy ||
            !this._sessions ||
            !capabilities
        ) {
            return;
        }

        const template = templatesFor(capabilities).find((t) => t.id === templateId);
        if (!template) {
            this.state.errorMessage = `Unknown session template "${templateId}".`;
            this.updateState();
            return;
        }

        const name = `vscode-mssql-${template.id}-${Date.now().toString(36)}`;
        try {
            await this._sessions.create(name, buildCreateStatement(template, name, capabilities));
        } catch (error) {
            this.state.status = "failed";
            this.state.errorMessage = `Could not create "${name}": ${getErrorMessage(error)}`;
            this.updateState();
            return;
        }

        await this.refreshSessions();
        await this.start(name);
    }

    /**
     * Drops sessions this client created in an earlier run. Confirmed first, and named, because
     * dropping a session someone is watching would be surprising.
     */
    private async cleanUpOrphans(): Promise<void> {
        if (this.state.isReadOnly || this.state.sessionDeletion?.busy || !this._sessions) {
            return;
        }
        const orphans = await this._sessions.findOrphans();
        if (orphans.length === 0) {
            return;
        }

        const names = orphans.map((o) => o.name);
        const choice = await vscode.window.showWarningMessage(
            `Stop and remove ${names.length} profiler session${names.length === 1 ? "" : "s"} left running from an earlier session?`,
            { modal: true, detail: names.join("\n") },
            "Remove",
        );
        if (choice !== "Remove") {
            return;
        }

        for (const name of names) {
            try {
                await this._sessions.stop(name);
                await this._sessions.drop(name);
            } catch (error) {
                this.state.errorMessage = `Could not remove "${name}": ${getErrorMessage(error)}`;
            }
        }
        await this.refreshSessions();
    }

    private async dropSession(sessionName: string): Promise<void> {
        const sessions = this._sessions;
        if (
            !sessions ||
            this.state.isReadOnly ||
            this.state.sessionDeletion?.busy ||
            !this.state.sessions.some((session) => session.name === sessionName)
        )
            return;
        this.state.sessionDeletion = { sessionName, busy: true };
        this.updateState();
        try {
            const target = (await sessions.list()).find((session) => session.name === sessionName);
            if (!target) throw new Error(SqlFeatures.profilerSessionUnavailable);
            const choice = await vscode.window.showWarningMessage(
                SqlFeatures.profilerDeleteTitle(sessionName),
                {
                    modal: true,
                    detail: SqlFeatures.profilerDeleteDetail(
                        this._profiler.connectionLabel,
                        sessionName,
                        target.isRunning
                            ? SqlFeatures.profilerRunning
                            : SqlFeatures.profilerStopped,
                    ),
                },
                SqlFeatures.profilerDelete,
            );
            if (choice !== SqlFeatures.profilerDelete) {
                this.state.sessionDeletion = undefined;
                return;
            }
            // Detach our stream before stopping the server so it cannot reconnect during deletion.
            if (this.state.sessionName === sessionName) {
                await this.stop();
                this.state.status = "stopped";
                this.state.statusDetail = undefined;
            }
            await sessions.stop(sessionName);
            await sessions.drop(sessionName);
            if ((await sessions.list()).some((session) => session.name === sessionName)) {
                throw new Error(SqlFeatures.profilerDeleteUnverified);
            }
            this.state.sessions = this.state.sessions.filter(
                (session) => session.name !== sessionName,
            );
            this.state.sessionDeletion = { sessionName, busy: false, completed: true };
            await this.refreshSessions();
        } catch (error) {
            this.state.sessionDeletion = {
                sessionName,
                busy: false,
                error: getErrorMessage(error),
            };
        } finally {
            if (this.state.sessionDeletion) this.state.sessionDeletion.busy = false;
            this.updateState();
        }
    }

    // -----------------------------------------------------------------------
    // Output
    // -----------------------------------------------------------------------

    private async saveCapture(): Promise<void> {
        const events = this._buffer.events;
        if (events.length === 0) {
            return;
        }

        const target = await vscode.window.showSaveDialog({
            filters: { "Profiler capture": ["json"] },
            saveLabel: "Save capture",
            defaultUri: vscode.Uri.file(`${this.state.sessionName ?? "capture"}.json`),
        });
        if (!target) {
            return;
        }

        const capture = buildCapture(
            {
                sessionName: this.state.sessionName ?? this.state.sourceName ?? "capture",
                serverName: this._profiler.capabilities?.serverName ?? "",
                database: this._profiler.capabilities?.database ?? "",
                platform: this._profiler.capabilities?.platform ?? "unknown",
                // The window is bounded, so a capture is a recent slice unless nothing evicted.
                windowed: this._buffer.evictedCount > 0,
            },
            events,
            this._buffer.gaps,
        );

        await vscode.workspace.fs.writeFile(target, Buffer.from(serializeCapture(capture), "utf8"));
        vscode.window.showInformationMessage(`Capture saved to ${target.fsPath}`);
    }

    private async exportCsv(): Promise<void> {
        const events = this._buffer.events;
        if (events.length === 0) {
            return;
        }
        const document = await vscode.workspace.openTextDocument({
            language: "csv",
            content: eventsToCsv(events),
        });
        await vscode.window.showTextDocument(document, { preview: false });
    }

    /**
     * Opens the execution plan for a captured statement.
     *
     * Plans age out of the cache, so a miss is reported as exactly that rather than as an
     * error, and the user is told where else to look.
     */
    private async showPlan(rowId: number): Promise<void> {
        const event = this._buffer.events.find(
            (e) => (e.eventSequence ?? -1) === rowId || e.values.__localId === String(rowId),
        );
        const queryHash = event?.values.query_hash;

        if (!queryHash) {
            vscode.window.showInformationMessage(
                "This event has no query hash, so its plan cannot be looked up. Add the query_hash action to the session to enable this.",
            );
            return;
        }

        const runner = this._profiler.runner;
        if (!runner) {
            vscode.window.showInformationMessage(
                "Execution plans are read from the server, so they are not available when viewing a file.",
            );
            return;
        }

        try {
            const result = await runner.query(
                `SELECT TOP (1) CONVERT(nvarchar(max), qp.query_plan) AS query_plan
                 FROM sys.dm_exec_query_stats AS qs
                 CROSS APPLY sys.dm_exec_query_plan(qs.plan_handle) AS qp
                 WHERE qs.query_hash = ${sanitizeBinaryLiteral(queryHash)}
                 ORDER BY qs.last_execution_time DESC`,
                // Showplan XML for a complex query runs to megabytes; the default bound would
                // clip it into invalid XML and the viewer would fail with nothing useful to say.
                { tag: "profiler.showPlan", maxCellBytes: 16 * 1024 * 1024 },
            );

            const xml = result.rows[0]?.query_plan;
            if (!xml) {
                vscode.window.showInformationMessage(
                    "That plan is no longer in the plan cache. Query Store keeps plans for longer, if it is enabled.",
                );
                return;
            }
            if (result.truncated) {
                vscode.window.showWarningMessage(
                    "The execution plan is too large to display in full.",
                );
                return;
            }

            const document = await vscode.workspace.openTextDocument({
                language: "xml",
                content: String(xml),
            });
            await vscode.window.showTextDocument(document, { preview: false });
        } catch (error) {
            vscode.window.showErrorMessage(`Could not fetch the plan: ${getErrorMessage(error)}`);
        }
    }

    // -----------------------------------------------------------------------
    // State
    // -----------------------------------------------------------------------

    private publish(): void {
        // A frozen grid keeps counting so the user can see what they are missing, but the rows
        // they are reading never move under them.
        if (this._paused) {
            this.state.pausedBacklog = this._pausedBacklog;
            this.publishCounts();
            this.updateState();
            return;
        }

        const matching = this.matchingEvents();
        const visible = matching.slice(-RENDERED_ROWS);

        // Columns first: toRow copies exactly the columns the grid will render.
        this.state.columns = this.resolveColumns(visible);
        this.state.rows = visible.map((e) => this.toRow(e));
        this.state.renderedCount = visible.length;
        this.state.retainedCount = matching.length;
        this.state.pausedBacklog = 0;
        this.state.topQueries = this._buffer.aggregator.top(200).map((a) => ({
            key: a.key,
            text: a.text,
            count: a.count,
            totalDurationUs: a.totalDurationUs,
            avgDurationUs: a.avgDurationUs,
            maxDurationUs: a.maxDurationUs,
            totalCpuUs: a.totalCpuUs,
            totalLogicalReads: a.totalLogicalReads,
            lastSeen: a.lastSeen,
        }));
        this.publishCounts();
        this.updateState();
    }

    /** Counts and throughput, which stay truthful whether or not the grid is frozen. */
    private publishCounts(): void {
        this.state.capturedCount = this._captured;
        this.state.lostCount = this._lost;
        this.state.health = {
            eventsPerSecond: this.eventsPerSecond(),
            elapsedMs: this._startedAtMs ? Date.now() - this._startedAtMs : 0,
            queuedCount: this._pending.length,
            discardedCount: this._buffer.evictedCount,
        };
    }

    /**
     * The retained events matching the current filters.
     *
     * Filtering happens here rather than in the webview because the webview only ever holds the
     * rendered slice: a filter applied there would search a few hundred events instead of the
     * whole window, and quietly miss matches.
     */
    private matchingEvents(): readonly ProfilerEvent[] {
        let events = this._buffer.events;

        if (this._queryFilter) {
            events = events.filter((e) => e.values.query_hash === this._queryFilter);
        }

        const filter = parseFilter(this._textFilter);
        if (!filter.isEmpty) {
            events = events.filter((e) => matchesFilter(e, filter));
        }
        return events;
    }

    /** Events per second over a short trailing window, so the figure is steady but current. */
    private eventsPerSecond(): number {
        const now = Date.now();
        this._rateSamples.push({ at: now, count: this._captured });
        while (this._rateSamples.length > 1 && now - this._rateSamples[0].at > RATE_WINDOW_MS) {
            this._rateSamples.shift();
        }
        const oldest = this._rateSamples[0];
        const spanMs = now - oldest.at;
        if (spanMs < 500) {
            return 0;
        }
        return Math.round(((this._captured - oldest.count) * 1000) / spanMs);
    }

    /**
     * Flattens one event to what the grid renders.
     *
     * Only the displayed columns travel. A capture can carry a megabyte of statement text per
     * page, and the details pane fetches the whole field set for the one event a user selects.
     */
    private toRow(event: ProfilerEvent): ProfilerRow {
        const values: Record<string, string> = {};
        for (const column of this.state.columns) {
            const value = event.values[column];
            if (value !== undefined) {
                values[column] = value;
            }
        }
        // Carried because the row uses it to decide whether a plan can be opened.
        if (event.values.query_hash) {
            values.query_hash = event.values.query_hash;
        }
        return {
            id: event.eventSequence ?? --this._localId,
            name: event.name,
            timestamp: event.timestamp,
            values,
        };
    }

    /**
     * A readable name for a session.
     *
     * Sessions this extension creates carry a generated suffix so two panels never collide. The
     * suffix is machine bookkeeping, so the template's own title is shown instead of re-casing
     * the identifier, which would render "tsql" as "Tsql".
     */
    private sessionLabel(name: string): string {
        const generated = /^vscode-mssql-([a-z0-9]+)-[a-z0-9]+$/i.exec(name);
        if (!generated) {
            return name;
        }
        const template = this.state.templates.find((t) => t.id === generated[1]);
        return template ? `${template.title} (this session)` : name;
    }

    /** Every field of one event, for the details pane. */
    private selectRow(rowId?: number): void {
        if (rowId === undefined) {
            this.state.selectedRowId = undefined;
            this.state.selectedEvent = undefined;
            this.updateState();
            return;
        }

        const event = this.findEvent(rowId);
        this.state.selectedRowId = rowId;
        this.state.selectedEvent = event
            ? {
                  id: rowId,
                  name: eventLabel(event.name),
                  timestamp: event.timestamp,
                  fields: Object.entries(event.values).filter(([key]) => !key.startsWith("__")),
              }
            : undefined;
        this.updateState();
    }

    private findEvent(rowId: number): ProfilerEvent | undefined {
        return this._buffer.events.find(
            (e) =>
                (e.eventSequence ?? Number.NaN) === rowId || e.values.__localId === String(rowId),
        );
    }

    private toMarker(gap: EventGap): ProfilerGapMarker {
        return {
            id: ++this._gapId,
            fromSequence: gap.fromSequence,
            toSequence: gap.toSequence,
            count: gap.count,
            reason: gap.reason,
            durationMs: gap.durationMs,
        };
    }

    /**
     * Shows the default columns that this capture has actually produced.
     *
     * Fields accumulate rather than being sampled from the newest events: a session that mixes
     * event types would otherwise add and remove columns as the mix changed, moving the data
     * sideways under someone trying to read it. The set resets when a capture is cleared or a
     * new one starts.
     */
    private resolveColumns(events: readonly ProfilerEvent[]): string[] {
        for (const event of events) {
            for (const key of Object.keys(event.values)) {
                this._seenFields.add(key);
            }
        }
        if (this._seenFields.size === 0) {
            return DEFAULT_COLUMNS;
        }
        const columns = DEFAULT_COLUMNS.filter((c) => this._seenFields.has(c));
        return columns.length > 0 ? columns : [...this._seenFields].slice(0, 8);
    }

    private registerReducers(): void {
        this.registerReducer("start", async (state, payload) => {
            await this.start(payload.sessionName);
            return this.state;
        });

        this.registerReducer("stop", async () => {
            await this.stop();
            this.state.status = "stopped";
            return this.state;
        });

        this.registerReducer("clear", async (state) => {
            this._buffer.clear();
            this._captured = 0;
            this._lost = 0;
            state.rows = [];
            state.gaps = [];
            state.topQueries = [];
            state.capturedCount = 0;
            state.retainedCount = 0;
            state.renderedCount = 0;
            state.lostCount = 0;
            state.pausedBacklog = 0;
            state.selectedRowId = undefined;
            state.selectedEvent = undefined;
            this._pausedBacklog = 0;
            this._startedAtMs = Date.now();
            this._rateSamples = [];
            this._seenFields.clear();
            return state;
        });

        this.registerReducer("setViewMode", async (state, payload) => {
            state.viewMode = payload.mode as ProfilerViewMode;
            return state;
        });

        this.registerReducer("setAutoScroll", async (state, payload) => {
            state.autoScroll = payload.enabled;
            return state;
        });

        this.registerReducer("setPaused", async (state, payload) => {
            this._paused = payload.paused;
            state.isPaused = payload.paused;
            state.pausedByUser = payload.paused ? payload.byUser === true : false;
            if (!payload.paused) {
                // Resuming shows everything that arrived while the grid was frozen.
                this._pausedBacklog = 0;
                this.publish();
            }
            return this.state;
        });

        this.registerReducer("setFilter", async (state, payload) => {
            this._textFilter = payload.text ?? "";
            state.filterText = this._textFilter;
            this.publish();
            return this.state;
        });

        this.registerReducer("selectRow", async (state, payload) => {
            this.selectRow(payload.rowId);
            return this.state;
        });

        this.registerReducer("createSession", async (state, payload) => {
            await this.createSession(payload.templateId);
            return this.state;
        });

        this.registerReducer("refreshSessions", async () => {
            await this.refreshSessions();
            return this.state;
        });

        this.registerReducer("cleanUpOrphans", async () => {
            await this.cleanUpOrphans();
            return this.state;
        });

        this.registerReducer("dropSession", async (state, payload) => {
            await this.dropSession(payload.sessionName);
            return this.state;
        });

        this.registerReducer("saveCapture", async () => {
            await this.saveCapture();
            return this.state;
        });

        this.registerReducer("exportCsv", async () => {
            await this.exportCsv();
            return this.state;
        });

        this.registerReducer("showPlan", async (state, payload) => {
            await this.showPlan(payload.rowId);
            return state;
        });

        this.registerReducer("filterToQuery", async (state, payload) => {
            this._queryFilter = payload.key || undefined;
            state.viewMode = "live";
            state.queryFilterText = this._queryFilter
                ? this._buffer.aggregator.top(200).find((a) => a.key === this._queryFilter)?.text
                : undefined;
            this.publish();
            return this.state;
        });
    }

    public override dispose(): void {
        this.stopFlushing();
        void this._stream?.stop();
        super.dispose();
    }
}

/**
 * Renders a query hash as a binary literal. The value comes from a captured event rather than a
 * user, but it still reaches a statement, so anything that is not a plain hex literal is
 * rejected instead of interpolated.
 */
function sanitizeBinaryLiteral(value: string): string {
    const match = /^0x[0-9a-fA-F]{1,32}$/.exec(value.trim());
    if (!match) {
        throw new Error("Query hash is not a valid binary literal.");
    }
    return match[0];
}
