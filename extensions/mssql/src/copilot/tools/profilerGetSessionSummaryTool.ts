/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import { ToolBase } from "./toolBase";
import { ProfilerSessionManager } from "../../profiler/profilerSessionManager";
import { ProfilerSession } from "../../profiler/profilerSession";
import { SessionState } from "../../profiler/profilerTypes";
import * as Constants from "../../constants/constants";
import { ProfilerTools as loc } from "../../constants/locConstants";
import {
    SessionSummary,
    SessionStateString,
    GetSessionSummaryParams,
    SessionSummaryResult,
} from "./profilerToolTypes";

/**
 * Copilot Agent Tool for getting a summary of a profiler session.
 * Provides session overview including event counts, time range, and top event types.
 */
export class ProfilerGetSessionSummaryTool extends ToolBase<GetSessionSummaryParams> {
    public readonly toolName = Constants.copilotProfilerGetSessionSummaryToolName;

    constructor(private readonly _sessionManager: ProfilerSessionManager) {
        super();
    }

    /**
     * Executes the get session summary tool.
     * @param options - Tool invocation options with sessionId parameter
     * @param _token - Cancellation token
     * @returns JSON string containing the session summary
     */
    async call(
        options: vscode.LanguageModelToolInvocationOptions<GetSessionSummaryParams>,
        _token: vscode.CancellationToken,
    ): Promise<string> {
        const { sessionId } = options.input;

        // Look up the session
        const session = this._sessionManager.getSession(sessionId);
        if (!session) {
            return JSON.stringify({
                success: false,
                error: loc.sessionNotFound(sessionId),
            } as SessionSummaryResult);
        }

        // Build the summary
        const summary = this.buildSessionSummary(session);

        return JSON.stringify({
            success: true,
            summary,
        } as SessionSummaryResult);
    }

    /**
     * Prepares the tool invocation with confirmation messages.
     * @param options - Prepare options with sessionId
     * @param _token - Cancellation token
     */
    async prepareInvocation(
        options: vscode.LanguageModelToolInvocationPrepareOptions<GetSessionSummaryParams>,
        _token: vscode.CancellationToken,
    ) {
        const { sessionId } = options.input;

        // Look up session to get the friendly name
        const session = this._sessionManager.getSession(sessionId);
        const displayName = session ? session.sessionName : sessionId;

        return {
            invocationMessage: loc.getSessionSummaryToolInvocationMessage(displayName),
            confirmationMessages: {
                title: loc.getSessionSummaryToolConfirmationTitle,
                message: new vscode.MarkdownString(
                    loc.getSessionSummaryToolConfirmationMessage(displayName),
                ),
            },
        };
    }

    /**
     * Builds a session summary from a ProfilerSession.
     * @param session - The profiler session to summarize
     */
    private buildSessionSummary(session: ProfilerSession): SessionSummary {
        const events = session.events.getAllRows();
        const totalEvents = events.length;

        // Calculate time range if there are events
        let timeRange: { start: string; end: string } | undefined;
        if (totalEvents > 0) {
            const timestamps = events.map((e) => new Date(e.timestamp).getTime());
            const minTime = Math.min(...timestamps);
            const maxTime = Math.max(...timestamps);
            timeRange = {
                start: new Date(minTime).toISOString(),
                end: new Date(maxTime).toISOString(),
            };
        }

        // Calculate top event types
        const topEventTypes = this.calculateTopItems(
            events,
            (e) => e.eventClass || "unknown",
            5,
        ).map(([eventType, count]) => ({ eventType, count }));

        // Calculate top databases
        const topDatabases = this.calculateTopItems(
            events,
            (e) => e.databaseName || "unknown",
            5,
        ).map(([database, count]) => ({ database, count }));

        // Calculate top applications
        const topApplications = this.calculateTopItems(
            events,
            (e) =>
                (e.additionalData?.["applicationName"] as string) ||
                (e.additionalData?.["application_name"] as string) ||
                (e.additionalData?.["ApplicationName"] as string) ||
                "unknown",
            5,
        ).map(([application, count]) => ({ application, count }));

        // Determine if events may have been lost due to overflow
        const eventsLostToOverflow = session.events.size >= session.events.capacity;

        return {
            sessionId: session.id,
            sessionName: session.sessionName,
            state: this.mapStateToString(session.state),
            totalEvents,
            bufferCapacity: session.events.capacity,
            timeRange,
            topEventTypes,
            topDatabases,
            topApplications,
            eventsLostToOverflow,
        };
    }

    /**
     * Calculates top items by frequency from an array.
     * @param items - Array of items to analyze
     * @param keyFn - Function to extract the key from each item
     * @param limit - Maximum number of items to return
     * @returns Array of [key, count] tuples sorted by count descending
     */
    private calculateTopItems<T>(
        items: T[],
        keyFn: (item: T) => string,
        limit: number,
    ): [string, number][] {
        const counts = new Map<string, number>();

        for (const item of items) {
            const key = keyFn(item);
            counts.set(key, (counts.get(key) || 0) + 1);
        }

        return Array.from(counts.entries())
            .sort((a, b) => b[1] - a[1])
            .slice(0, limit);
    }

    /**
     * Maps SessionState enum to string representation.
     * @param state - The session state enum value
     */
    private mapStateToString(state: SessionState): SessionStateString {
        switch (state) {
            case SessionState.Running:
                return "running";
            case SessionState.Paused:
                return "paused";
            case SessionState.Stopped:
                return "stopped";
            case SessionState.Creating:
                return "creating";
            case SessionState.Failed:
                return "failed";
            case SessionState.NotStarted:
                return "notStarted";
            default:
                return "stopped";
        }
    }
}
