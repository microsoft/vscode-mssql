/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import React, { useState, useCallback, useMemo, useEffect } from "react";
import {
    Toolbar,
    Button,
    ToolbarDivider,
    Tooltip,
    ToggleButton,
    Input,
    Dropdown,
    Option,
} from "@fluentui/react-components";
import {
    Play16Regular,
    Pause16Regular,
    Stop16Regular,
    ArrowDown16Regular,
    Next16Regular,
    EraserRegular,
    Add16Regular,
    FilterDismiss16Regular,
    ArrowExport16Regular,
} from "@fluentui/react-icons";
import {
    SessionState,
    ProfilerViewConfig,
    ProfilerTemplateConfig,
} from "../../../sharedInterfaces/profiler";
import debounce from "lodash/debounce";
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
    /** Whether a filter is currently active */
    isFilterActive: boolean;
    /** Current quick filter term */
    quickFilterTerm: string;
    /** Whether this is a read-only file-based session */
    isReadOnly?: boolean;
    /** XEL file name if this is a file-based session */
    xelFileName?: string;
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
    /** Callback when clear filter is clicked */
    onClearFilter: () => void;
    /** Callback when quick filter changes (debounced by consumer) */
    onQuickFilterChange: (term: string) => void;
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
    isFilterActive,
    isReadOnly,
    xelFileName,
    totalEventCount,
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
    onExportToCsv,
}) => {
    const isRunning = sessionState === SessionState.Running;
    const isPaused = sessionState === SessionState.Paused;
    const isStopped =
        sessionState === SessionState.Stopped || sessionState === SessionState.NotStarted;
    const isActive = isRunning || isPaused;
    const hasTemplates = availableTemplates && availableTemplates.length > 0;

    // Quick filter with debounce
    const [localQuickFilter, setLocalQuickFilter] = useState(quickFilterTerm);
    const debouncedQuickFilterChange = useMemo(
        () =>
            debounce((term: string) => {
                onQuickFilterChange(term);
            }, 200),
        [onQuickFilterChange],
    );

    const handleQuickFilterInput = useCallback(
        (value: string) => {
            // Enforce max length
            const trimmed = value.slice(0, 1000);
            setLocalQuickFilter(trimmed);
            debouncedQuickFilterChange(trimmed);
        },
        [debouncedQuickFilterChange],
    );

    // Sync local quick filter when external state clears it
    React.useEffect(() => {
        if (quickFilterTerm === "") {
            setLocalQuickFilter("");
            debouncedQuickFilterChange.cancel();
        }
    }, [quickFilterTerm, debouncedQuickFilterChange]);

    useEffect(() => {
        return () => {
            debouncedQuickFilterChange.cancel();
        };
    }, [debouncedQuickFilterChange]);

    // Determine pause/resume button state - use Next icon (line before play) for Resume
    const pauseResumeIcon = isRunning ? <Pause16Regular /> : <Next16Regular />;
    const loc = locConstants.profiler;
    const selectedSessionName = useMemo(
        () => availableSessions?.find((session) => session.id === selectedSessionId)?.name ?? "",
        [availableSessions, selectedSessionId],
    );
    const selectedViewName = useMemo(
        () => availableViews?.find((view) => view.id === currentViewId)?.name ?? "",
        [availableViews, currentViewId],
    );

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
                    <Button
                        appearance="primary"
                        size="small"
                        aria-label={loc.newSession}
                        icon={<Add16Regular />}
                        onClick={onNewSession}
                        disabled={isReadOnly || isActive || isCreatingSession || !hasTemplates}>
                        {isCreatingSession ? loc.creatingSession : loc.newSession}
                    </Button>
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
                        <span className="profiler-toolbar-label">{loc.sessionLabel}</span>
                        <Dropdown
                            aria-label={loc.selectSessionAriaLabel}
                            value={selectedSessionName || loc.selectASession}
                            selectedOptions={selectedSessionId ? [selectedSessionId] : []}
                            multiselect={false}
                            clearable={false}
                            onOptionSelect={(_event, data) => {
                                if (typeof data.optionValue === "string") {
                                    onSelectSession(data.optionValue);
                                }
                            }}
                            disabled={isReadOnly || isActive}
                            className="profiler-toolbar-select"
                            style={{ minWidth: "auto" }}
                            size="small">
                            {availableSessions?.map((session) => (
                                <Option key={session.id} value={session.id} text={session.name}>
                                    {session.name}
                                </Option>
                            ))}
                        </Dropdown>
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
                    <Button
                        appearance="subtle"
                        size="small"
                        aria-label={loc.start}
                        icon={<Play16Regular />}
                        onClick={onStart}
                        disabled={isReadOnly || isActive || !selectedSessionId}>
                        {loc.start}
                    </Button>
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
                    <Button
                        appearance="subtle"
                        size="small"
                        aria-label={loc.stop}
                        icon={<Stop16Regular />}
                        onClick={onStop}
                        disabled={isReadOnly || isStopped}>
                        {loc.stop}
                    </Button>
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
                    <Button
                        appearance="subtle"
                        size="small"
                        aria-label={isRunning ? loc.pause : loc.resume}
                        icon={pauseResumeIcon}
                        onClick={onPauseResume}
                        disabled={isReadOnly || isStopped}>
                        {isRunning ? loc.pause : loc.resume}
                    </Button>
                </Tooltip>

                <ToolbarDivider />

                {/* Data controls - Clear disabled for read-only */}
                <Tooltip
                    content={isReadOnly ? loc.readOnlyDisabledTooltip : loc.clearEventsTooltip}
                    relationship="label">
                    <Button
                        appearance="subtle"
                        size="small"
                        aria-label={loc.clear}
                        icon={<EraserRegular />}
                        onClick={onClear}
                        disabled={isReadOnly}>
                        {loc.clear}
                    </Button>
                </Tooltip>

                <ToolbarDivider />

                {/* Clear All Filters button */}
                <Tooltip
                    content={
                        isFilterActive ? loc.clearAllFiltersTooltip : loc.clearFilterDisabledTooltip
                    }
                    relationship="label">
                    <Button
                        appearance="subtle"
                        size="small"
                        aria-label={loc.clearAllFilters}
                        icon={<FilterDismiss16Regular />}
                        onClick={onClearFilter}
                        disabled={!isFilterActive}>
                        {loc.clearAllFilters}
                    </Button>
                </Tooltip>

                {/* Quick filter input */}
                <Input
                    placeholder={loc.quickFilterPlaceholder}
                    value={localQuickFilter}
                    onChange={(_e, data) => handleQuickFilterInput(data.value ?? "")}
                    aria-label={loc.quickFilterPlaceholder}
                    size="small"
                />

                {/* Export to CSV button */}
                <Tooltip
                    content={
                        totalEventCount && totalEventCount > 0
                            ? loc.exportTooltip
                            : loc.noEventsToExport
                    }
                    relationship="label">
                    <Button
                        appearance="subtle"
                        size="small"
                        aria-label={loc.exportToCsv}
                        icon={<ArrowExport16Regular />}
                        onClick={onExportToCsv}
                        disabled={!totalEventCount || totalEventCount === 0}>
                        {loc.exportToCsv}
                    </Button>
                </Tooltip>

                <ToolbarDivider />

                {/* View selector */}
                <div className="profiler-toolbar-view-selector">
                    <span className="profiler-toolbar-label">{loc.viewLabel}</span>
                    <Dropdown
                        aria-label={loc.viewLabel}
                        value={selectedViewName}
                        selectedOptions={currentViewId ? [currentViewId] : []}
                        multiselect={false}
                        clearable={false}
                        onOptionSelect={(_event, data) => {
                            if (typeof data.optionValue === "string") {
                                onViewChange(data.optionValue);
                            }
                        }}
                        className="profiler-toolbar-select"
                        style={{ minWidth: "auto" }}
                        size="small">
                        {availableViews?.map((view) => (
                            <Option key={view.id} value={view.id} text={view.name}>
                                {view.name}
                            </Option>
                        ))}
                    </Dropdown>
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
                        icon={<ArrowDown16Regular />}
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
