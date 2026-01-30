/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    ProfilerConfig,
    ProfilerTemplate,
    ViewTemplate,
    ViewRow,
    EventRow,
    EngineType,
    ViewColumn,
    FIELD_TIMESTAMP,
    FIELD_ADDITIONAL_DATA,
    TYPE_NUMBER,
} from "./profilerTypes";
import { defaultProfilerConfig } from "./profilerDefaultConfig";

/**
 * Service for managing profiler templates and view configurations.
 * Maps between views and sessions are computed at runtime from the templates'
 * defaultView property to avoid configuration drift.
 */
export class ProfilerConfigService {
    private static _instance: ProfilerConfigService;
    private _config: ProfilerConfig;
    /** Maps view IDs to compatible session template IDs (computed at runtime) */
    private _viewToSessionMap: Map<string, string[]>;
    /** Maps session template IDs to compatible view IDs (computed at runtime) */
    private _sessionToViewMap: Map<string, string[]>;

    private constructor() {
        // Load the default configuration
        this._config = defaultProfilerConfig;
        // Compute the view-session mappings at runtime
        this._viewToSessionMap = new Map();
        this._sessionToViewMap = new Map();
        this.computeMaps();
    }

    /**
     * Computes the view-to-session and session-to-view maps from the templates' defaultView property.
     * This ensures the maps stay in sync with the actual template definitions.
     */
    private computeMaps(): void {
        // Build maps from templates' defaultView property
        for (const template of this._config.templates) {
            const templateId = template.id;
            const defaultViewId = template.defaultView;

            // Add to sessionToViewMap (each template maps to its default view)
            if (!this._sessionToViewMap.has(templateId)) {
                this._sessionToViewMap.set(templateId, []);
            }
            const sessionViews = this._sessionToViewMap.get(templateId)!;
            if (!sessionViews.includes(defaultViewId)) {
                sessionViews.push(defaultViewId);
            }

            // Add to viewToSessionMap (each view maps to templates that use it as default)
            if (!this._viewToSessionMap.has(defaultViewId)) {
                this._viewToSessionMap.set(defaultViewId, []);
            }
            const viewSessions = this._viewToSessionMap.get(defaultViewId)!;
            if (!viewSessions.includes(templateId)) {
                viewSessions.push(templateId);
            }
        }
    }

    /**
     * Get the singleton instance
     */
    public static get instance(): ProfilerConfigService {
        if (!ProfilerConfigService._instance) {
            ProfilerConfigService._instance = new ProfilerConfigService();
        }
        return ProfilerConfigService._instance;
    }

    /**
     * Get all available templates
     */
    public getTemplates(): ProfilerTemplate[] {
        return this._config.templates;
    }

    /**
     * Get templates filtered by engine type
     */
    public getTemplatesForEngine(engineType: EngineType): ProfilerTemplate[] {
        return this.getTemplates().filter((t) => t.engineType === engineType);
    }

    /**
     * Get a specific template by ID
     */
    public getTemplate(id: string): ProfilerTemplate | undefined {
        return this._config.templates.find((t) => t.id === id);
    }

    /**
     * Get all available views
     */
    public getViews(): ViewTemplate[] {
        return this._config.views;
    }

    /**
     * Get views compatible with a specific session template.
     * Computed at runtime from the template's defaultView property.
     */
    public getViewsForSession(sessionId: string): ViewTemplate[] {
        const viewIds = this._sessionToViewMap.get(sessionId) || [];
        return viewIds
            .map((id) => this.getView(id))
            .filter((v): v is ViewTemplate => v !== undefined);
    }

    /**
     * Get session templates compatible with a specific view.
     * Computed at runtime from templates that use this view as their default.
     */
    public getSessionsForView(viewId: string): ProfilerTemplate[] {
        const sessionIds = this._viewToSessionMap.get(viewId) || [];
        return sessionIds
            .map((id) => this.getTemplate(id))
            .filter((t): t is ProfilerTemplate => t !== undefined);
    }

    /**
     * Get a specific view by ID
     */
    public getView(id: string): ViewTemplate | undefined {
        return this._config.views.find((v) => v.id === id);
    }

    /**
     * Get the default view for a template
     */
    public getDefaultViewForTemplate(templateId: string): ViewTemplate | undefined {
        const template = this.getTemplate(templateId);
        if (!template) {
            return undefined;
        }
        return this.getView(template.defaultView);
    }

    /**
     * Convert an EventRow to a ViewRow based on the view's column configuration.
     * Uses the eventsMapped array to find the first matching field from the event.
     * @param event The event row to convert
     * @param view The view template defining which fields to include
     * @returns A ViewRow with fields populated based on the view columns
     */
    public convertEventToViewRow(event: EventRow, view: ViewTemplate): ViewRow {
        const viewRow: ViewRow = {
            id: event.id, // Use UUID for synchronization
            eventNumber: event.eventNumber, // Include event number for tracking; this is set in xevent from the library
        };

        for (const column of view.columns) {
            const value = this.getColumnValue(event, column);
            viewRow[column.field] = value;
        }

        return viewRow;
    }

    /**
     * Get the value for a column from an event row.
     * Iterates through eventsMapped array and returns the first matching value.
     */
    private getColumnValue(event: EventRow, column: ViewColumn): string | number | undefined {
        // Try each mapped event field until we find a value
        for (const mappedField of column.eventsMapped) {
            const value = this.getFieldValue(event, mappedField);
            if (value !== null && value !== undefined && value !== "") {
                return value;
            }
        }
        // Fallback to the column field name itself
        return this.getFieldValue(event, column.field);
    }

    /**
     * Convert multiple EventRows to ViewRows
     */
    public convertEventsToViewRows(events: EventRow[], view: ViewTemplate): ViewRow[] {
        return events.map((event) => this.convertEventToViewRow(event, view));
    }

    /**
     * Get a field value from an EventRow, checking both direct properties and additionalData
     */
    private getFieldValue(event: EventRow, field: string): string | number | undefined {
        // Check if it's a direct property of EventRow
        if (field in event && field !== FIELD_ADDITIONAL_DATA) {
            const value = (event as unknown as Record<string, unknown>)[field];
            if (value === undefined || value === null) {
                return undefined;
            }
            // Format specific fields
            if (field === FIELD_TIMESTAMP) {
                return this.formatTimestamp(value as number);
            }
            if (typeof value === TYPE_NUMBER) {
                return value as number;
            }
            return String(value);
        }

        // Check additionalData
        if (event.additionalData && field in event.additionalData) {
            return event.additionalData[field] ?? undefined;
        }

        return undefined;
    }

    /**
     * Format a timestamp for display.
     * Converts timestamp to ISO 8601 format: "YYYY-MM-DD HH:mm:ss.sss"
     * Example output: "2026-01-29 14:30:45.123"
     */
    private formatTimestamp(timestamp: number): string {
        try {
            const date = new Date(timestamp);
            return date.toISOString().replace("T", " ").replace("Z", "");
        } catch {
            return String(timestamp);
        }
    }

    /**
     * Get SlickGrid column definitions from a view template
     */
    public getSlickGridColumns(view: ViewTemplate): SlickGridColumnDef[] {
        return view.columns
            .filter((col) => col.visible !== false)
            .map((col) => ({
                id: col.field,
                name: col.header,
                field: col.field,
                width: col.width,
                sortable: col.sortable ?? true,
                filterable: col.filterable ?? false,
                resizable: true,
                minWidth: 50,
            }));
    }

    /**
     * Generate the CREATE EVENT SESSION statement with the session name
     */
    public generateCreateStatement(template: ProfilerTemplate, sessionName: string): string {
        return template.createStatement.replace(/\{sessionName\}/g, sessionName);
    }
}

/**
 * SlickGrid column definition (simplified)
 */
export interface SlickGridColumnDef {
    id: string;
    name: string;
    field: string;
    width?: number;
    sortable?: boolean;
    filterable?: boolean;
    resizable?: boolean;
    minWidth?: number;
}

/**
 * Helper function to get the config service instance
 */
export function getProfilerConfigService(): ProfilerConfigService {
    return ProfilerConfigService.instance;
}
