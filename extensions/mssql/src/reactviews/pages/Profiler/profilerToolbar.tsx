/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import React, { useState, useCallback, useRef } from "react";
import {
    Toolbar,
    ToolbarButton,
    ToolbarDivider,
    Tooltip,
    ToggleButton,
    Input,
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
    /** Current quick filter term */
    quickFilterTerm: string;
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
    /** Callback when clear filter is clicked */
    onClearFilter: () => void;
    /** Callback when quick filter changes (debounced by consumer) */
    onQuickFilterChange: (term: string) => void;
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
    onNewSession,
    onSelectSession,
    onStart,
    onPauseResume,
    onStop,
    onClear,
    onViewChange,
    onAutoScrollToggle,
    onClearFilter,
    quickFilterTerm,
    onQuickFilterChange,
}) => {
    const isRunning = sessionState === SessionState.Running;
    const isPaused = sessionState === SessionState.Paused;
    const isStopped =
        sessionState === SessionState.Stopped || sessionState === SessionState.NotStarted;
    const isActive = isRunning || isPaused;
    const hasTemplates = availableTemplates && availableTemplates.length > 0;

    // Quick filter with debounce
    const [localQuickFilter, setLocalQuickFilter] = useState(quickFilterTerm);
    const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

    const handleQuickFilterInput = useCallback(
        (value: string) => {
            // Enforce max length
            const trimmed = value.slice(0, 1000);
            setLocalQuickFilter(trimmed);
            if (debounceRef.current) {
                clearTimeout(debounceRef.current);
            }
            debounceRef.current = setTimeout(() => {
                onQuickFilterChange(trimmed);
            }, 200);
        },
        [onQuickFilterChange],
    );

    // Sync local quick filter when external state clears it
    React.useEffect(() => {
        if (quickFilterTerm === "" && localQuickFilter !== "") {
            setLocalQuickFilter("");
        }
    }, [quickFilterTerm]); // intentionally only react to external quickFilterTerm changes

    // Determine pause/resume button state - use Next icon (line before play) for Resume
    const pauseResumeIcon = isRunning ? <Pause24Regular /> : <Next24Regular />;
    const loc = locConstants.profiler;

    // Build read-only disconnected tooltip
    const readOnlyDisconnectedTooltip =
        isReadOnly && xelFileName
            ? loc.xelFileReadOnlyDisconnectedTooltip(xelFileName)
            : loc.readOnlyDisabledTooltip;

    return (
        <div className="profiler-toolbar">
            <Toolbar aria-label="Profiler toolbar" size="small">
                {/* Read-only file indicator */}
                {isReadOnly && xelFileName && (
                    <>
                        <span className="profiler-toolbar-label profiler-toolbar-readonly-label">
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
                            className="profiler-toolbar-select profiler-toolbar-select-session">
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
                    content={isReadOnly ? loc.readOnlyDisabledTooltip : loc.clearEventsTooltip}
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

                {/* Clear All Filters button */}
                <Tooltip
                    content={
                        isFilterActive ? loc.clearAllFiltersTooltip : loc.clearFilterDisabledTooltip
                    }
                    relationship="label">
                    <ToolbarButton
                        aria-label={loc.clearAllFilters}
                        icon={<FilterDismiss24Regular />}
                        onClick={onClearFilter}
                        disabled={!isFilterActive}>
                        {loc.clearAllFilters}
                    </ToolbarButton>
                </Tooltip>

                {/* Quick filter input */}
                <Input
                    placeholder={loc.quickFilterPlaceholder}
                    value={localQuickFilter}
                    onChange={(_e, data) => handleQuickFilterInput(data.value ?? "")}
                    aria-label={loc.quickFilterPlaceholder}
                    className="profiler-toolbar-quick-filter"
                    size="small"
                />

                <ToolbarDivider />

                {/* View selector */}
                <div className="profiler-toolbar-view-selector">
                    <span className="profiler-toolbar-label">{loc.viewLabel}</span>
                    <select
                        aria-label={loc.viewLabel}
                        value={currentViewId ?? ""}
                        onChange={(e) => onViewChange(e.target.value)}
                        className="profiler-toolbar-select">
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
