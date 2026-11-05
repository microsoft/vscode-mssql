/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { sendActionEvent } from "extension-toolkit/vscode";
import { ExecutionPlanGraph } from "../sharedInterfaces/executionPlan";
import { TelemetryActions, TelemetryViews } from "../sharedInterfaces/telemetry";
import { bucketizeQueryDuration } from "./utils";

/** Why live query statistics stopped for a run. */
export enum LiveQueryStatisticsEndReason {
    Completed = "completed",
    QueryError = "queryError",
    Canceled = "canceled",
    /** A read failed while the query kept running. */
    MonitorError = "monitorError",
    /** The query's server session couldn't be identified, so monitoring never started. */
    SessionUnavailable = "sessionUnavailable",
    /** The editor or its results closed. */
    Closed = "closed",
    PreviewDisabled = "previewDisabled",
    /** Another run started before this one reported an end. */
    Superseded = "superseded",
}

/**
 * Summarizes one live run and reports it once when the run ends, since reads are too frequent to
 * report individually. It outlives monitors, which a changed SPID or a saved editor replaces during
 * a run. Only counters and fixed values are sent, never query text, plan XML, or error messages.
 */
export class LiveQueryStatisticsRunTelemetry {
    private readonly _startTime = Date.now();
    private _firstPlanTime: number | undefined;
    private _planReadCount = 0;
    private _emptyReadCount = 0;
    private _readsWithProgress = 0;
    private _progress: number | undefined;
    private _progressChangedTime: number | undefined;
    private _longestStallMs = 0;
    private _elapsedMsAt50Progress: number | undefined;
    private _statement: string | undefined;
    private _isSingleStatement = true;

    public recordEmptyRead(): void {
        this._emptyReadCount++;
    }

    public recordPlans(graphs: ExecutionPlanGraph[]): void {
        const now = Date.now();
        this._firstPlanTime ??= now;
        this._planReadCount++;

        const statement = graphs
            .map((graph) => `${graph.graphFile?.planIndexInFile}:${graph.query}`)
            .join();
        this._isSingleStatement &&=
            graphs.length === 1 && (this._statement === undefined || this._statement === statement);
        this._statement = statement;

        const estimatedProgress = graphs
            .map((graph) => graph.liveQueryStatistics?.estimatedProgress)
            .filter((progress) => progress !== undefined)
            .at(-1);
        if (estimatedProgress === undefined) {
            return;
        }
        this._readsWithProgress++;

        // Compare at the displayed precision, so a stall means the number on screen stopped moving.
        const progress = Math.round(estimatedProgress * 10) / 10;
        if (progress !== this._progress) {
            // The monitor keeps a statement's progress monotonic, so a drop is a new statement.
            this._isSingleStatement &&= this._progress === undefined || progress > this._progress;
            this._longestStallMs = this.getLongestStallMs(now);
            this._progress = progress;
            this._progressChangedTime = now;
        }
        if (progress >= 50) {
            this._elapsedMsAt50Progress ??= now - this._startTime;
        }
    }

    public send(endReason: LiveQueryStatisticsEndReason, isPlanTabActive: boolean): void {
        const now = Date.now();
        const elapsedMs = now - this._startTime;
        const measurements: { [key: string]: number } = {
            elapsedMs,
            planReadCount: this._planReadCount,
            emptyReadCount: this._emptyReadCount,
        };
        if (this._firstPlanTime !== undefined) {
            measurements.firstPlanMs = this._firstPlanTime - this._startTime;
            measurements.readsWithProgressPct = Math.round(
                (100 * this._readsWithProgress) / this._planReadCount,
            );
        }
        if (this._progress !== undefined) {
            measurements.progressAtEnd = this._progress;
            measurements.longestStallMs = this.getLongestStallMs(now);
        }
        // Only a finished run has a true duration, and progress is tracked per statement, so other
        // runs have nothing to compare the estimate against.
        if (
            endReason === LiveQueryStatisticsEndReason.Completed &&
            this._isSingleStatement &&
            this._elapsedMsAt50Progress !== undefined &&
            elapsedMs > 0
        ) {
            measurements.elapsedPctAt50Progress = Math.round(
                (100 * this._elapsedMsAt50Progress) / elapsedMs,
            );
        }

        sendActionEvent(TelemetryViews.ExecutionPlan, TelemetryActions.LiveQueryStatisticsRun, {
            additionalProps: {
                endReason,
                durationBucket: bucketizeQueryDuration(elapsedMs),
                planTabActiveAtEnd: isPlanTabActive ? "true" : "false",
            },
            additionalMeasurements: measurements,
        });
    }

    private getLongestStallMs(now: number): number {
        return this._progressChangedTime === undefined
            ? this._longestStallMs
            : Math.max(this._longestStallMs, now - this._progressChangedTime);
    }
}
