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
import { ProfilerSessionInfo, SessionStateString, ListSessionsResult } from "./profilerToolTypes";

/**
 * Copilot Agent Tool for listing all available profiler sessions.
 * Provides session metadata for natural language queries about active profiler sessions.
 */
export class ProfilerListSessionsTool extends ToolBase<Record<string, never>> {
    public readonly toolName = Constants.copilotProfilerListSessionsToolName;

    constructor(private readonly _sessionManager: ProfilerSessionManager) {
        super();
    }

    /**
     * Executes the list sessions tool.
     * @param _options - Tool invocation options (no input parameters required)
     * @param _token - Cancellation token
     * @returns JSON string containing the list of sessions
     */
    async call(
        _options: vscode.LanguageModelToolInvocationOptions<Record<string, never>>,
        _token: vscode.CancellationToken,
    ): Promise<string> {
        const sessions = this._sessionManager.getAllSessions();

        const result: ListSessionsResult = {
            success: true,
            sessions: sessions.map((session) => this.mapSessionToInfo(session)),
        };

        if (sessions.length === 0) {
            result.message = loc.noProfilerSessionsAvailable;
        }

        return JSON.stringify(result);
    }

    /**
     * Prepares the tool invocation with confirmation messages.
     * @param _options - Prepare options
     * @param _token - Cancellation token
     */
    async prepareInvocation(
        _options: vscode.LanguageModelToolInvocationPrepareOptions<Record<string, never>>,
        _token: vscode.CancellationToken,
    ) {
        return {
            invocationMessage: loc.listSessionsToolInvocationMessage,
            confirmationMessages: {
                title: loc.listSessionsToolConfirmationTitle,
                message: new vscode.MarkdownString(loc.listSessionsToolConfirmationMessage),
            },
        };
    }

    /**
     * Maps a ProfilerSession to the serializable ProfilerSessionInfo format.
     * @param session - The profiler session to map
     */
    private mapSessionToInfo(session: ProfilerSession): ProfilerSessionInfo {
        return {
            sessionId: session.id,
            sessionName: session.sessionName,
            state: this.mapStateToString(session.state),
            templateName: session.templateName,
            connectionLabel: this.extractConnectionLabel(session.ownerUri),
            eventCount: session.eventCount,
            bufferCapacity: session.events.capacity,
            createdAt: new Date(session.createdAt).toISOString(),
        };
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

    /**
     * Extracts a user-friendly connection label from the ownerUri.
     * @param ownerUri - The connection URI
     */
    private extractConnectionLabel(ownerUri: string): string {
        // Try to extract server name from URI
        // Format is typically: mssql://server/database or just a connection string
        try {
            if (ownerUri.startsWith("mssql://")) {
                const url = new URL(ownerUri);
                return url.hostname || ownerUri;
            }
            // Return the URI as-is if we can't parse it
            return ownerUri;
        } catch {
            return ownerUri;
        }
    }
}
