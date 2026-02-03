/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import { ToolBase } from "./toolBase";
import { ProfilerSessionManager } from "../../profiler/profilerSessionManager";
import { EventRow, FilterOperator } from "../../profiler/profilerTypes";
import * as Constants from "../../constants/constants";
import { ProfilerTools as loc } from "../../constants/locConstants";
import {
    EventSummary,
    QueryEventsParams,
    QueryEventsResult,
    QueryMetadata,
    FilterClause,
} from "./profilerToolTypes";
import { truncateText, TEXT_TRUNCATION_LIMITS } from "./profilerToolUtils";

/** Default number of events to return */
const DEFAULT_LIMIT = 50;

/** Maximum number of events that can be returned */
const MAX_LIMIT = 200;

/**
 * Copilot Agent Tool for querying profiler session events with filtering and sorting.
 * Provides event summaries for natural language queries about profiler data.
 */
export class ProfilerQueryEventsTool extends ToolBase<QueryEventsParams> {
    public readonly toolName = Constants.copilotProfilerQueryEventsToolName;

    constructor(private readonly _sessionManager: ProfilerSessionManager) {
        super();
    }

    /**
     * Executes the query events tool.
     * @param options - Tool invocation options with query parameters
     * @param _token - Cancellation token
     * @returns JSON string containing filtered event summaries
     */
    async call(
        options: vscode.LanguageModelToolInvocationOptions<QueryEventsParams>,
        _token: vscode.CancellationToken,
    ): Promise<string> {
        const { sessionId, filters, limit, sortBy, sortOrder } = options.input;

        // Look up the session
        const session = this._sessionManager.getSession(sessionId);
        if (!session) {
            return JSON.stringify({
                success: false,
                message: loc.sessionNotFound(sessionId),
            } as QueryEventsResult);
        }

        // Get all events from the session
        let events = session.events.getAllRows();

        // Apply filters if provided
        if (filters && filters.length > 0) {
            events = this.applyFilters(events, filters);
        }

        const totalMatching = events.length;

        // Sort events
        events = this.sortEvents(events, sortBy, sortOrder);

        // Apply limit
        const effectiveLimit = Math.min(limit ?? DEFAULT_LIMIT, MAX_LIMIT);
        const truncated = events.length > effectiveLimit;
        events = events.slice(0, effectiveLimit);

        // Transform to summaries
        const eventSummaries = events.map((e) => this.mapEventToSummary(e));

        // Build metadata
        const metadata: QueryMetadata = {
            totalMatching,
            returned: eventSummaries.length,
            truncated,
            textTruncationLimit: TEXT_TRUNCATION_LIMITS.SUMMARY,
        };

        const result: QueryEventsResult = {
            success: true,
            events: eventSummaries,
            metadata,
        };

        if (eventSummaries.length === 0) {
            result.message = loc.noEventsMatchFilter;
        }

        return JSON.stringify(result);
    }

    /**
     * Prepares the tool invocation with confirmation messages.
     * @param options - Prepare options with query parameters
     * @param _token - Cancellation token
     */
    async prepareInvocation(
        options: vscode.LanguageModelToolInvocationPrepareOptions<QueryEventsParams>,
        _token: vscode.CancellationToken,
    ) {
        const { sessionId } = options.input;

        // Look up session to get the friendly name
        const session = this._sessionManager.getSession(sessionId);
        const displayName = session ? session.sessionName : sessionId;

        return {
            invocationMessage: loc.queryEventsToolInvocationMessage(displayName),
            confirmationMessages: {
                title: loc.queryEventsToolConfirmationTitle,
                message: new vscode.MarkdownString(
                    loc.queryEventsToolConfirmationMessage(displayName),
                ),
            },
        };
    }

    /**
     * Applies filter clauses to the events array.
     * @param events - Array of events to filter
     * @param filters - Array of filter clauses to apply
     */
    private applyFilters(events: EventRow[], filters: FilterClause[]): EventRow[] {
        return events.filter((event) => {
            return filters.every((filter) => this.matchesFilter(event, filter));
        });
    }

    /**
     * Checks if an event matches a single filter clause.
     * @param event - The event to check
     * @param filter - The filter clause to apply
     */
    private matchesFilter(event: EventRow, filter: FilterClause): boolean {
        const fieldValue = this.getFieldValue(event, filter.field);
        const filterValue = filter.value;

        switch (filter.operator) {
            case FilterOperator.Equals:
                return fieldValue === filterValue;
            case FilterOperator.NotEquals:
                return fieldValue !== filterValue;
            case FilterOperator.Contains:
                return (
                    typeof fieldValue === "string" &&
                    typeof filterValue === "string" &&
                    fieldValue.toLowerCase().includes(filterValue.toLowerCase())
                );
            case FilterOperator.GreaterThan:
                return (
                    typeof fieldValue === "number" &&
                    typeof filterValue === "number" &&
                    fieldValue > filterValue
                );
            case FilterOperator.LessThan:
                return (
                    typeof fieldValue === "number" &&
                    typeof filterValue === "number" &&
                    fieldValue < filterValue
                );
            case FilterOperator.GreaterThanOrEqual:
                return (
                    typeof fieldValue === "number" &&
                    typeof filterValue === "number" &&
                    fieldValue >= filterValue
                );
            case FilterOperator.LessThanOrEqual:
                return (
                    typeof fieldValue === "number" &&
                    typeof filterValue === "number" &&
                    fieldValue <= filterValue
                );
            default:
                return true;
        }
    }

    /**
     * Gets a field value from an event by field name.
     * @param event - The event to read from
     * @param field - The field name
     */
    private getFieldValue(event: EventRow, field: string): unknown {
        switch (field) {
            case "eventClass":
                return event.eventClass;
            case "databaseName":
                return event.databaseName;
            case "textData":
                return event.textData;
            case "duration":
                return event.duration;
            case "cpu":
                return event.cpu;
            case "reads":
                return event.reads;
            case "writes":
                return event.writes;
            case "spid":
                return event.spid;
            case "timestamp":
                return event.timestamp;
            default:
                // Check additional data
                return event.additionalData?.[field];
        }
    }

    /**
     * Sorts events by the specified field and order.
     * @param events - Array of events to sort
     * @param sortBy - Field to sort by (defaults to "duration")
     * @param sortOrder - Sort order (defaults to "desc")
     */
    private sortEvents(
        events: EventRow[],
        sortBy?: "timestamp" | "duration",
        sortOrder?: "asc" | "desc",
    ): EventRow[] {
        const field = sortBy ?? "duration";
        const order = sortOrder ?? "desc";

        return [...events].sort((a, b) => {
            let aValue: number;
            let bValue: number;

            if (field === "timestamp") {
                aValue = new Date(a.timestamp).getTime();
                bValue = new Date(b.timestamp).getTime();
            } else {
                aValue = a.duration ?? 0;
                bValue = b.duration ?? 0;
            }

            return order === "asc" ? aValue - bValue : bValue - aValue;
        });
    }

    /**
     * Maps an EventRow to a truncated EventSummary.
     * @param event - The event to transform
     */
    private mapEventToSummary(event: EventRow): EventSummary {
        return {
            eventId: event.id,
            eventNumber: event.eventNumber,
            timestamp: new Date(event.timestamp).toISOString(),
            eventClass: event.eventClass || "",
            textData: truncateText(event.textData || "", TEXT_TRUNCATION_LIMITS.SUMMARY).text,
            databaseName: event.databaseName || "",
            duration: event.duration,
            cpu: event.cpu,
            reads: event.reads,
            writes: event.writes,
        };
    }
}
