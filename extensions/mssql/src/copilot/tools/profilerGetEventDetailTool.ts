/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import { ToolBase } from "./toolBase";
import { ProfilerSessionManager } from "../../profiler/profilerSessionManager";
import { EventRow } from "../../profiler/profilerTypes";
import * as Constants from "../../constants/constants";
import { ProfilerTools as loc } from "../../constants/locConstants";
import { EventDetail, GetEventDetailParams, GetEventDetailResult } from "./profilerToolTypes";
import { truncateText, TEXT_TRUNCATION_LIMITS } from "./profilerToolUtils";

/**
 * Copilot Agent Tool for retrieving full details of a single profiler event.
 * Provides complete event information including full SQL text (truncated at 4096 chars).
 */
export class ProfilerGetEventDetailTool extends ToolBase<GetEventDetailParams> {
    public readonly toolName = Constants.copilotProfilerGetEventDetailToolName;

    constructor(private readonly _sessionManager: ProfilerSessionManager) {
        super();
    }

    /**
     * Executes the get event detail tool.
     * @param options - Tool invocation options with session and event IDs
     * @param _token - Cancellation token
     * @returns JSON string containing full event details
     */
    async call(
        options: vscode.LanguageModelToolInvocationOptions<GetEventDetailParams>,
        _token: vscode.CancellationToken,
    ): Promise<string> {
        const { sessionId, eventId } = options.input;

        // Look up the session
        const session = this._sessionManager.getSession(sessionId);
        if (!session) {
            return JSON.stringify({
                success: false,
                message: loc.sessionNotFound(sessionId),
            } as GetEventDetailResult);
        }

        // Get all events and find the one with matching ID
        const events = session.events.getAllRows();
        const event = events.find((e) => e.id === eventId);

        if (!event) {
            return JSON.stringify({
                success: false,
                message: loc.eventNotFound(eventId, sessionId),
            } as GetEventDetailResult);
        }

        // Transform to full event detail
        const eventDetail = this.mapEventToDetail(event);

        const result: GetEventDetailResult = {
            success: true,
            event: eventDetail,
        };

        return JSON.stringify(result);
    }

    /**
     * Prepares the tool invocation with confirmation messages.
     * @param options - Prepare options with session and event IDs
     * @param _token - Cancellation token
     */
    async prepareInvocation(
        options: vscode.LanguageModelToolInvocationPrepareOptions<GetEventDetailParams>,
        _token: vscode.CancellationToken,
    ) {
        const { sessionId, eventId } = options.input;

        // Look up session to get the friendly name
        const session = this._sessionManager.getSession(sessionId);
        const displayName = session ? session.sessionName : sessionId;

        return {
            invocationMessage: loc.getEventDetailToolInvocationMessage(displayName, eventId),
            confirmationMessages: {
                title: loc.getEventDetailToolConfirmationTitle,
                message: new vscode.MarkdownString(
                    loc.getEventDetailToolConfirmationMessage(displayName, eventId),
                ),
            },
        };
    }

    /**
     * Maps an EventRow to a full EventDetail with extended truncation limit.
     * @param event - The event to transform
     */
    private mapEventToDetail(event: EventRow): EventDetail {
        const truncationResult = truncateText(event.textData || "", TEXT_TRUNCATION_LIMITS.DETAIL);

        // Extract applicationName from additionalData if present
        const applicationName =
            event.additionalData?.["applicationName"] ||
            event.additionalData?.["application_name"] ||
            event.additionalData?.["ApplicationName"];

        return {
            eventId: event.id,
            eventNumber: event.eventNumber,
            timestamp: new Date(event.timestamp).toISOString(),
            eventClass: event.eventClass || "",
            textData: truncationResult.text,
            textTruncated: truncationResult.truncated,
            databaseName: event.databaseName || "",
            duration: event.duration,
            cpu: event.cpu,
            reads: event.reads,
            writes: event.writes,
            applicationName: applicationName,
            spid: event.spid,
            additionalData: event.additionalData || {},
        };
    }
}
