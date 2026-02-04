/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import React from "react";
import {
    Toolbar,
    ToolbarButton,
    ToolbarDivider,
    Tooltip,
    ToggleButton,
} from "@fluentui/react-components";
import {
    Play24Regular,
    Pause24Regular,
    Stop24Regular,
    ArrowDown24Regular,
    Next24Regular,
    EraserRegular,
    Add24Regular,
    FilterDismiss24Regular,
    Filter24Regular,
    ArrowExportRegular,
} from "@fluentui/react-icons";
import {
    SessionState,
    ProfilerViewConfig,
    ProfilerTemplateConfig,
} from "../../../sharedInterfaces/profiler";
import { locConstants } from "../../common/locConstants";

export interface ProfilerToolbarProps {
    /** Current session state */
    sessionState: SessionState;
    /** Current view ID */
    currentViewId?: string;
    /** Available views */
    availableViews?: ProfilerViewConfig[];
    /** Available templates for creating sessions */
    availableTemplates?: ProfilerTemplateConfig[];
    /** Available sessions */
    availableSessions?: { id: string; name: string }[];
    /** Selected session ID */
    selectedSessionId?: string;
    /** Whether auto-scroll is enabled */
    autoScroll: boolean;
    /** Whether a session is being created */
    isCreatingSession?: boolean;
    /** Whether this is a read-only file-based session */
    isReadOnly?: boolean;
    /** XEL file name if this is a file-based session */
    xelFileName?: string;
    /** Whether a filter is currently active */
    isFilterActive: boolean;
    /** Total event count (for export button state) */
    totalEventCount?: number;
    /** Callback when new session is requested */
    onNewSession: () => void;
    /** Callback when session is selected */
    onSelectSession: (sessionId: string) => void;
    /** Callback when start is clicked */
    onStart: () => void;
    /** Callback when pause/resume is clicked */
    onPauseResume: () => void;
    /** Callback when stop is clicked */
    onStop: () => void;
    /** Callback when clear is clicked */
    onClear: () => void;
    /** Callback when view is changed */
    onViewChange: (viewId: string) => void;
    /** Callback when auto-scroll is toggled */
    onAutoScrollToggle: () => void;
    /** Callback when filter button is clicked to open filter dialog */
    onFilter: () => void;
    /** Callback when clear filter is clicked */
    onClearFilter: () => void;
    /** Callback when export to CSV is clicked */
    onExportToCsv: () => void;
}

export const ProfilerToolbar: React.FC<ProfilerToolbarProps> = ({
    sessionState,
    currentViewId,
    availableViews,
    availableTemplates,
    availableSessions,
    selectedSessionId,
    autoScroll,
    isCreatingSession,
    isReadOnly,
    xelFileName,
    isFilterActive,
    totalEventCount,
    onNewSession,
    onSelectSession,
    onStart,
    onPauseResume,
    onStop,
    onClear,
    onViewChange,
    onAutoScrollToggle,
    onFilter,
    onClearFilter,
    onExportToCsv,
}) => {
    const isRunning = sessionState === SessionState.Running;
    const isPaused = sessionState === SessionState.Paused;
    const isStopped =
        sessionState === SessionState.Stopped || sessionState === SessionState.NotStarted;
    const isActive = isRunning || isPaused;
    const hasTemplates = availableTemplates && availableTemplates.length > 0;

    // Determine pause/resume button state - use Next icon (line before play) for Resume
    const pauseResumeIcon = isRunning ? <Pause24Regular /> : <Next24Regular />;
    const loc = locConstants.profiler;

    // Build read-only disconnected tooltip
    const readOnlyDisconnectedTooltip = isReadOnly && xelFileName
        ? loc.xelFileReadOnlyDisconnectedTooltip(xelFileName)
        : loc.readOnlyDisabledTooltip;

    return (
        <div className="profiler-toolbar">
            <Toolbar aria-label="Profiler toolbar" size="small">
                {/* Read-only file indicator */}
                {isReadOnly && xelFileName && (
                    <>
                        <span
                            className="profiler-toolbar-label"
                            style={{ fontStyle: "italic", opacity: 0.8 }}>
                            {loc.readOnlyFileLabel}: {xelFileName}
                        </span>
                        <ToolbarDivider />
                    </>
                )}

                {/* New Session button - disabled in read-only disconnected mode */}
                <Tooltip
                    content={
                        isReadOnly
                            ? readOnlyDisconnectedTooltip
                            : isCreatingSession
                              ? loc.creatingSessionTooltip
                              : hasTemplates
                                ? loc.createNewSessionTooltip
                                : loc.noTemplatesAvailableTooltip
                    }
                    relationship="label">
                    <ToolbarButton
                        aria-label={loc.newSession}
                        icon={<Add24Regular />}
                        onClick={onNewSession}
                        disabled={isReadOnly || isActive || isCreatingSession || !hasTemplates}>
                        {isCreatingSession ? loc.creatingSession : loc.newSession}
                    </ToolbarButton>
                </Tooltip>

                <ToolbarDivider />

                {/* Session selection - disabled in read-only disconnected mode */}
                <Tooltip
                    content={
                        isReadOnly
                            ? readOnlyDisconnectedTooltip
                            : isActive
                              ? loc.sessionActiveCannotChangeTooltip
                              : loc.selectSessionLabel
                    }
                    relationship="label">
                    <div className="profiler-toolbar-view-selector">
                        <span className="profiler-toolbar-label">{loc.selectSessionLabel}</span>
                        <select
                            aria-label={loc.selectSessionLabel}
                            value={selectedSessionId ?? ""}
                            onChange={(e) => onSelectSession(e.target.value)}
                            disabled={isReadOnly || isActive}
                            style={{
                                minWidth: "200px",
                                padding: "4px 8px",
                                backgroundColor: "var(--vscode-input-background)",
                                color: "var(--vscode-input-foreground)",
                                border: "1px solid var(--vscode-input-border)",
                                borderRadius: "2px",
                                opacity: isReadOnly || isActive ? 0.6 : 1,
                                cursor: isReadOnly || isActive ? "not-allowed" : "pointer",
                            }}>
                            <option value="">{loc.selectASession}</option>
                            {availableSessions?.map((session) => (
                                <option key={session.id} value={session.id}>
                                    {session.name}
                                </option>
                            ))}
                        </select>
                    </div>
                </Tooltip>

                {/* Start button - disabled in read-only disconnected mode */}
                <Tooltip
                    content={
                        isReadOnly
                            ? readOnlyDisconnectedTooltip
                            : !selectedSessionId && isStopped
                              ? loc.selectSessionFirstTooltip
                              : loc.startSessionTooltip
                    }
                    relationship="label">
                    <ToolbarButton
                        aria-label={loc.start}
                        icon={<Play24Regular />}
                        onClick={onStart}
                        disabled={isReadOnly || isActive || !selectedSessionId}>
                        {loc.start}
                    </ToolbarButton>
                </Tooltip>

                {/* Stop button - disabled for read-only file sessions */}
                <Tooltip
                    content={
                        isReadOnly
                            ? loc.readOnlyDisabledTooltip
                            : isActive
                              ? loc.stopSessionTooltip
                              : loc.sessionNotRunningTooltip
                    }
                    relationship="label">
                    <ToolbarButton
                        aria-label={loc.stop}
                        icon={<Stop24Regular />}
                        onClick={onStop}
                        disabled={isReadOnly || isStopped}>
                        {loc.stop}
                    </ToolbarButton>
                </Tooltip>

                {/* Pause/Resume button - disabled for read-only file sessions */}
                <Tooltip
                    content={
                        isReadOnly
                            ? loc.readOnlyDisabledTooltip
                            : isRunning
                              ? loc.pauseEventCollectionTooltip
                              : isPaused
                                ? loc.pausedClickToResumeTooltip
                                : loc.notRunningTooltip
                    }
                    relationship="label">
                    <ToolbarButton
                        aria-label={isRunning ? loc.pause : loc.resume}
                        icon={pauseResumeIcon}
                        onClick={onPauseResume}
                        disabled={isReadOnly || isStopped}>
                        {isRunning ? loc.pause : loc.resume}
                    </ToolbarButton>
                </Tooltip>

                <ToolbarDivider />

                {/* Data controls - Clear disabled for read-only */}
                <Tooltip
                    content={
                        isReadOnly ? loc.readOnlyDisabledTooltip : loc.clearEventsTooltip
                    }
                    relationship="label">
                    <ToolbarButton
                        aria-label={loc.clear}
                        icon={<EraserRegular />}
                        onClick={onClear}
                        disabled={isReadOnly}>
                        {loc.clear}
                    </ToolbarButton>
                </Tooltip>

                <ToolbarDivider />

                {/* Filter button - opens filter dialog */}
                <Tooltip content={loc.filterTooltip} relationship="label">
                    <ToolbarButton
                        aria-label={loc.filter}
                        icon={<Filter24Regular />}
                        onClick={onFilter}>
                        {loc.filter}
                    </ToolbarButton>
                </Tooltip>

                {/* Clear Filter button */}
                <Tooltip
                    content={
                        isFilterActive ? loc.clearFilterTooltip : loc.clearFilterDisabledTooltip
                    }
                    relationship="label">
                    <ToolbarButton
                        aria-label={loc.clearFilter}
                        icon={<FilterDismiss24Regular />}
                        onClick={onClearFilter}
                        disabled={!isFilterActive}>
                        {loc.clearFilter}
                    </ToolbarButton>
                </Tooltip>

                <ToolbarDivider />

                {/* Export to CSV button */}
                <Tooltip
                    content={
                        totalEventCount && totalEventCount > 0
                            ? loc.exportTooltip
                            : loc.noEventsToExport
                    }
                    relationship="label">
                    <ToolbarButton
                        aria-label={loc.exportToCsv}
                        icon={<ArrowExportRegular />}
                        onClick={onExportToCsv}
                        disabled={!totalEventCount || totalEventCount === 0}>
                        {loc.exportToCsv}
                    </ToolbarButton>
                </Tooltip>

                <ToolbarDivider />

                {/* View selector */}
                <div className="profiler-toolbar-view-selector">
                    <span className="profiler-toolbar-label">{loc.viewLabel}</span>
                    <select
                        aria-label={loc.viewLabel}
                        value={currentViewId ?? ""}
                        onChange={(e) => onViewChange(e.target.value)}
                        style={{
                            minWidth: "150px",
                            padding: "4px 8px",
                            backgroundColor: "var(--vscode-input-background)",
                            color: "var(--vscode-input-foreground)",
                            border: "1px solid var(--vscode-input-border)",
                            borderRadius: "2px",
                        }}>
                        {availableViews?.map((view) => (
                            <option key={view.id} value={view.id}>
                                {view.name}
                            </option>
                        ))}
                    </select>
                </div>

                <ToolbarDivider />

                {/* Auto-scroll toggle - disabled for read-only file sessions */}
                <Tooltip
                    content={
                        isReadOnly
                            ? loc.readOnlyDisabledTooltip
                            : autoScroll
                              ? loc.autoScrollEnabledTooltip
                              : loc.autoScrollDisabledTooltip
                    }
                    relationship="label">
                    <ToggleButton
                        aria-label={loc.autoScroll}
                        icon={<ArrowDown24Regular />}
                        checked={autoScroll}
                        onClick={onAutoScrollToggle}
                        disabled={isReadOnly}
                        size="small">
                        {loc.autoScroll}
                    </ToggleButton>
                </Tooltip>
            </Toolbar>
        </div>
    );
};
