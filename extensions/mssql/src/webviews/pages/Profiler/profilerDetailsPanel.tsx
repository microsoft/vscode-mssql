/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import React, { useMemo, useState, useCallback, useRef } from "react";
import {
    Button,
    Toolbar,
    Tab,
    TabList,
    Tooltip,
    makeStyles,
    shorthands,
    SelectTabEvent,
    SelectTabData,
} from "@fluentui/react-components";
import {
    Open16Regular,
    Copy16Regular,
    Maximize16Regular,
    Dismiss16Regular,
    ChevronDown16Regular,
} from "@fluentui/react-icons";
import { GridOption, SlickgridReactInstance } from "slickgrid-react";
import { ProfilerSelectedEventDetails } from "../../../sharedInterfaces/profiler";
import { ColorThemeKind } from "../../../sharedInterfaces/webview";
import { locConstants } from "../../common/locConstants";
import {
    createFluentSlickGridCopyMenu,
    FLUENT_SLICK_GRID_COPY_COMMAND,
    FluentSlickGrid,
    getFluentSlickGridSelectionText,
} from "../../common/FluentSlickGrid/FluentSlickGrid";
import { VscodeEditor } from "../../common/vscodeMonaco";
import {
    buildProfilerDetailsGridRows,
    getProfilerDetailsGridColumns,
    getProfilerDetailsGridOptions,
    PROFILER_DETAILS_GRID_CONTAINER_ID,
    PROFILER_DETAILS_GRID_ID,
} from "./profilerDetailsGridConfig";

/**
 * Tab identifiers for the details panel
 */
export enum DetailsPanelTab {
    Text = "text",
    Details = "details",
}

type DetailsGridContextMenuCommandHandler = NonNullable<
    NonNullable<GridOption["contextMenu"]>["onCommand"]
>;

export interface ProfilerDetailsPanelProps {
    /** The selected event details to display */
    selectedEvent: ProfilerSelectedEventDetails | undefined;
    /** Current color theme */
    themeKind: ColorThemeKind;
    /** Whether the panel is maximized */
    isMaximized: boolean;
    /** Callback when Open in Editor is clicked */
    onOpenInEditor: (textData: string, eventName?: string) => void;
    /** Callback when Copy is clicked */
    onCopy: (text: string) => void;
    /** Callback when Maximize/Restore is clicked */
    onToggleMaximize: () => void;
    /** Callback when Close is clicked */
    onClose: () => void;
    /** Whether this is rendered in a VS Code Panel view (hides close/maximize buttons) */
    isPanelView?: boolean;
}

const useStyles = makeStyles({
    panelContainer: {
        display: "flex",
        flexDirection: "column",
        width: "100%",
        height: "100%",
        backgroundColor: "var(--vscode-editor-background)",
        ...shorthands.borderTop("1px", "solid", "var(--vscode-panel-border)"),
    },
    header: {
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        ...shorthands.padding("4px", "8px"),
        ...shorthands.borderBottom("1px", "solid", "var(--vscode-panel-border)"),
        flexShrink: 0,
    },
    tabList: {
        display: "flex",
        alignItems: "center",
    },
    toolbar: {
        display: "flex",
        alignItems: "center",
        ...shorthands.gap("4px"),
    },
    tabContent: {
        ...shorthands.flex(1),
        width: "100%",
        minHeight: 0,
        display: "flex",
        ...shorthands.overflow("hidden"),
    },
    editorContainer: {
        width: "100%",
        height: "100%",
        position: "relative",
    },
    propertiesContainer: {
        width: "100%",
        height: "100%",
        minHeight: 0,
        position: "relative",
    },
    detailsGridContainer: {
        width: "100%",
        height: "100%",
        minHeight: 0,
    },
    noEventMessage: {
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        height: "100%",
        color: "var(--vscode-descriptionForeground)",
        fontStyle: "italic",
    },
    noTextDataMessage: {
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        height: "100%",
        color: "var(--vscode-descriptionForeground)",
        fontStyle: "italic",
    },
});

/**
 * Details panel component for displaying selected profiler event information.
 * Contains two tabs: Text (SQL content with syntax highlighting) and Details (property list).
 */
export const ProfilerDetailsPanel: React.FC<ProfilerDetailsPanelProps> = ({
    selectedEvent,
    themeKind,
    isMaximized,
    onOpenInEditor,
    onCopy,
    onToggleMaximize,
    onClose,
    isPanelView = false,
}) => {
    const classes = useStyles();
    const loc = locConstants.profiler.detailsPanel;
    const commonLoc = locConstants.common;
    const [activeTab, setActiveTab] = useState<DetailsPanelTab>(DetailsPanelTab.Text);
    const detailsGridRef = useRef<SlickgridReactInstance | undefined>(undefined);
    const detailsGridRows = useMemo(
        () => buildProfilerDetailsGridRows(selectedEvent?.properties ?? []),
        [selectedEvent],
    );
    const detailsGridColumns = useMemo(
        // slickgrid-react mutates the column array on unmount, so we must recreate
        // it whenever the Details tab is toggled back on.
        () => getProfilerDetailsGridColumns(commonLoc.property, commonLoc.value),
        [activeTab, commonLoc.property, commonLoc.value],
    );
    const detailsGridOptions = useMemo(
        () => ({
            ...getProfilerDetailsGridOptions(themeKind),
            enableContextMenu: true,
            contextMenu: {
                ...createFluentSlickGridCopyMenu(locConstants.slickGrid.copy),
                onCommand: (...callbackArgs: Parameters<DetailsGridContextMenuCommandHandler>) => {
                    const [, args] = callbackArgs;
                    if (args?.command !== FLUENT_SLICK_GRID_COPY_COMMAND) {
                        return;
                    }

                    const text = getFluentSlickGridSelectionText(detailsGridRef.current);
                    if (text) {
                        onCopy(text);
                    }
                },
            },
        }),
        [themeKind, onCopy],
    );

    // Handle tab change
    const handleTabSelect = useCallback((_event: SelectTabEvent, data: SelectTabData) => {
        setActiveTab(data.value as DetailsPanelTab);
    }, []);

    // Handle Open in Editor click
    const handleOpenInEditor = useCallback(() => {
        if (selectedEvent?.textData) {
            onOpenInEditor(selectedEvent.textData, selectedEvent.eventName);
        }
    }, [selectedEvent, onOpenInEditor]);

    // Handle Copy click
    const handleCopy = useCallback(() => {
        if (selectedEvent?.textData) {
            onCopy(selectedEvent.textData);
        }
    }, [selectedEvent, onCopy]);

    const handleDetailsGridCreated = useCallback((reactGrid: SlickgridReactInstance) => {
        detailsGridRef.current = reactGrid;
    }, []);

    // If no event is selected, show placeholder
    if (!selectedEvent) {
        return (
            <div className={classes.panelContainer} role="region" aria-label={loc.noEventSelected}>
                <div className={classes.noEventMessage}>{loc.noEventSelected}</div>
            </div>
        );
    }

    const hasTextData = !!selectedEvent.textData?.trim().length;

    return (
        <div
            className={classes.panelContainer}
            role="region"
            aria-label={loc.eventDetailsAriaLabel(selectedEvent.eventName)}>
            {/* Header with tabs and action buttons */}
            <div className={classes.header}>
                <TabList
                    className={classes.tabList}
                    selectedValue={activeTab}
                    onTabSelect={handleTabSelect}
                    size="small"
                    aria-label={loc.detailsPanelTabsAriaLabel}>
                    <Tab
                        value={DetailsPanelTab.Text}
                        aria-label={loc.textTabAriaLabel}
                        aria-selected={activeTab === DetailsPanelTab.Text}>
                        {loc.textTab}
                    </Tab>
                    <Tab
                        value={DetailsPanelTab.Details}
                        aria-label={loc.detailsTabAriaLabel}
                        aria-selected={activeTab === DetailsPanelTab.Details}>
                        {loc.detailsTab}
                    </Tab>
                </TabList>

                <Toolbar className={classes.toolbar} aria-label={loc.detailsPanelActionsAriaLabel}>
                    {/* Text tab specific actions */}
                    {activeTab === DetailsPanelTab.Text && (
                        <>
                            <Tooltip content={loc.openInEditorTooltip} relationship="label">
                                <Button
                                    size="small"
                                    appearance="subtle"
                                    icon={<Open16Regular />}
                                    onClick={handleOpenInEditor}
                                    disabled={!hasTextData}
                                    aria-label={loc.openInEditor}>
                                    {loc.openInEditor}
                                </Button>
                            </Tooltip>
                            <Tooltip content={loc.copyTooltip} relationship="label">
                                <Button
                                    size="small"
                                    appearance="subtle"
                                    icon={<Copy16Regular />}
                                    onClick={handleCopy}
                                    disabled={!hasTextData}
                                    aria-label={commonLoc.copy}
                                />
                            </Tooltip>
                        </>
                    )}

                    {/* Common actions - hidden in panel view mode (VS Code manages these) */}
                    {!isPanelView && (
                        <>
                            <Tooltip
                                content={isMaximized ? loc.restoreTooltip : loc.maximizeTooltip}
                                relationship="label">
                                <Button
                                    size="small"
                                    appearance="subtle"
                                    icon={
                                        isMaximized ? (
                                            <ChevronDown16Regular />
                                        ) : (
                                            <Maximize16Regular />
                                        )
                                    }
                                    onClick={onToggleMaximize}
                                    aria-label={isMaximized ? loc.restore : loc.maximize}
                                />
                            </Tooltip>
                            <Tooltip content={loc.closeTooltip} relationship="label">
                                <Button
                                    size="small"
                                    appearance="subtle"
                                    icon={<Dismiss16Regular />}
                                    onClick={onClose}
                                    aria-label={commonLoc.close}
                                />
                            </Tooltip>
                        </>
                    )}
                </Toolbar>
            </div>

            {/* Tab content */}
            <div className={classes.tabContent}>
                {activeTab === DetailsPanelTab.Text && (
                    <div
                        className={classes.editorContainer}
                        role="region"
                        aria-label={loc.editorAriaLabel}>
                        {hasTextData ? (
                            <VscodeEditor
                                height="100%"
                                width="100%"
                                language="sql"
                                themeKind={themeKind}
                                value={selectedEvent.textData}
                                options={{
                                    readOnly: true,
                                    lineNumbers: "on",
                                    minimap: { enabled: false },
                                    scrollBeyondLastLine: false,
                                    wordWrap: "on",
                                    automaticLayout: true,
                                    folding: true,
                                    renderLineHighlight: "line",
                                    selectOnLineNumbers: true,
                                    ariaLabel: loc.editorAriaLabel,
                                }}
                            />
                        ) : (
                            <div className={classes.noTextDataMessage}>{loc.noTextData}</div>
                        )}
                    </div>
                )}

                {activeTab === DetailsPanelTab.Details && (
                    <div
                        className={classes.propertiesContainer}
                        role="group"
                        aria-label={loc.propertiesListAriaLabel}>
                        <div
                            id={PROFILER_DETAILS_GRID_CONTAINER_ID}
                            className={classes.detailsGridContainer}>
                            <FluentSlickGrid
                                gridId={PROFILER_DETAILS_GRID_ID}
                                columns={detailsGridColumns}
                                options={detailsGridOptions}
                                dataset={detailsGridRows}
                                onReactGridCreated={($event) =>
                                    handleDetailsGridCreated($event.detail)
                                }
                            />
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

export default ProfilerDetailsPanel;
