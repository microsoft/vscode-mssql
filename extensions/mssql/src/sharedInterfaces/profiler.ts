/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ApiStatus } from "./webview";

/**
 * State for the SQL Profiler webview
 */
export interface ProfilerWebviewState {
    profilerState: ProfilerState;
}

/**
 * State for the profiler feature
 */
export interface ProfilerState {
    /**
     * Loading state of the profiler
     */
    loadState: ApiStatus;
    /**
     * Events captured by the profiler
     */
    events: ProfilerEvent[];
    /**
     * Currently selected event for the details panel
     */
    selectedEvent?: ProfilerEvent;
    /**
     * Whether the details panel is visible
     */
    detailsPanelVisible: boolean;
    /**
     * Whether the details panel is maximized
     */
    detailsPanelMaximized: boolean;
    /**
     * Active tab in the details panel ('text' or 'details')
     */
    activeTab: "text" | "details";
    /**
     * Error message if any
     */
    errorMessage?: string;
}

/**
 * Represents a single profiler event/row
 */
export interface ProfilerEvent {
    /**
     * Event class name
     */
    eventClass?: string;
    /**
     * SQL text data
     */
    textData?: string;
    /**
     * Application name
     */
    applicationName?: string;
    /**
     * Database name
     */
    databaseName?: string;
    /**
     * Login name
     */
    loginName?: string;
    /**
     * CPU time in milliseconds
     */
    cpu?: number;
    /**
     * Duration in milliseconds
     */
    duration?: number;
    /**
     * Reads performed
     */
    reads?: number;
    /**
     * Writes performed
     */
    writes?: number;
    /**
     * Start time of the event
     */
    startTime?: string;
    /**
     * Session ID
     */
    spid?: number;
    /**
     * All raw properties for the event
     */
    [key: string]: any;
}

/**
 * Reducers for the profiler webview
 */
export interface ProfilerReducers {
    /**
     * Initialize the profiler with events
     */
    initializeProfiler: {
        events: ProfilerEvent[];
    };
    /**
     * Select an event row to show in the details panel
     */
    selectEvent: {
        event: ProfilerEvent;
    };
    /**
     * Close the details panel
     */
    closeDetailsPanel: {};
    /**
     * Toggle maximize state of the details panel
     */
    toggleMaximize: {};
    /**
     * Switch between Text and Details tabs
     */
    switchTab: {
        tab: "text" | "details";
    };
    /**
     * Open the selected event's text data in a new editor
     */
    openInEditor: {
        textData: string;
        language?: string;
    };
    /**
     * Copy text data to clipboard
     */
    copyTextData: {
        textData: string;
    };
    /**
     * Add new profiler events (for streaming updates)
     */
    addEvents: {
        events: ProfilerEvent[];
    };
}

/**
 * Provider interface for profiler actions
 */
export interface ProfilerProvider {
    /**
     * Initialize the profiler with events
     */
    initializeProfiler(events: ProfilerEvent[]): void;

    /**
     * Select an event to show in the details panel
     */
    selectEvent(event: ProfilerEvent): void;

    /**
     * Close the details panel
     */
    closeDetailsPanel(): void;

    /**
     * Toggle maximize state of the details panel
     */
    toggleMaximize(): void;

    /**
     * Switch between Text and Details tabs
     */
    switchTab(tab: "text" | "details"): void;

    /**
     * Open the selected event's text data in a new editor
     */
    openInEditor(textData: string, language?: string): void;

    /**
     * Copy text data to clipboard
     */
    copyTextData(textData: string): void;

    /**
     * Add new profiler events
     */
    addEvents(events: ProfilerEvent[]): void;
}
