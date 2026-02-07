/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import React, { useState, useCallback, useMemo } from "react";
import {
    Button,
    Toolbar,
    Tab,
    TabList,
    Tooltip,
    makeStyles,
    shorthands,
    tokens,
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
import { Editor } from "@monaco-editor/react";
import { ProfilerSelectedEventDetails, ProfilerEventProperty } from "../../../sharedInterfaces/profiler";
import { ColorThemeKind } from "../../../sharedInterfaces/webview";
import { resolveVscodeThemeType } from "../../common/utils";
import { locConstants } from "../../common/locConstants";

/**
 * Tab identifiers for the details panel
 */
export enum DetailsPanelTab {
    Text = "text",
    Details = "details",
}

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
        ...shorthands.overflow("auto"),
        ...shorthands.padding("8px"),
    },
    propertyRow: {
        display: "grid",
        gridTemplateColumns: "200px 1fr",
        ...shorthands.padding("4px", "8px"),
        ...shorthands.borderBottom("1px", "solid", "var(--vscode-editorWidget-border)"),
        "&:hover": {
            backgroundColor: "var(--vscode-list-hoverBackground)",
        },
    },
    propertyLabel: {
        fontWeight: tokens.fontWeightSemibold,
        color: "var(--vscode-foreground)",
        ...shorthands.overflow("hidden"),
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
    },
    propertyValue: {
        color: "var(--vscode-foreground)",
        ...shorthands.overflow("hidden"),
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
        fontFamily: "var(--vscode-editor-font-family)",
        fontSize: "var(--vscode-editor-font-size)",
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
    const [activeTab, setActiveTab] = useState<DetailsPanelTab>(DetailsPanelTab.Text);

    // Memoize the theme for Monaco editor
    const monacoTheme = useMemo(() => resolveVscodeThemeType(themeKind), [themeKind]);

    // Handle tab change
    const handleTabSelect = useCallback(
        (_event: SelectTabEvent, data: SelectTabData) => {
            setActiveTab(data.value as DetailsPanelTab);
        },
        [],
    );

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

    // Handle keyboard navigation for property list
    const handlePropertyKeyDown = useCallback(
        (event: React.KeyboardEvent<HTMLDivElement>, index: number, totalItems: number) => {
            if (event.key === "ArrowDown" && index < totalItems - 1) {
                event.preventDefault();
                const nextElement = document.querySelector(
                    `[data-property-index="${index + 1}"]`,
                ) as HTMLElement;
                nextElement?.focus();
            } else if (event.key === "ArrowUp" && index > 0) {
                event.preventDefault();
                const prevElement = document.querySelector(
                    `[data-property-index="${index - 1}"]`,
                ) as HTMLElement;
                prevElement?.focus();
            }
        },
        [],
    );

    // If no event is selected, show placeholder
    if (!selectedEvent) {
        return (
            <div className={classes.panelContainer} role="region" aria-label={loc.noEventSelected}>
                <div className={classes.noEventMessage}>{loc.noEventSelected}</div>
            </div>
        );
    }

    const hasTextData = selectedEvent.textData && selectedEvent.textData.trim() !== "";

    return (
        <div
            className={classes.panelContainer}
            role="region"
            aria-label={`Event details for ${selectedEvent.eventName}`}>
            {/* Header with tabs and action buttons */}
            <div className={classes.header}>
                <TabList
                    className={classes.tabList}
                    selectedValue={activeTab}
                    onTabSelect={handleTabSelect}
                    size="small"
                    aria-label="Details panel tabs">
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

                <Toolbar className={classes.toolbar} aria-label="Details panel actions">
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
                                    aria-label={loc.copy}
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
                                    icon={isMaximized ? <ChevronDown16Regular /> : <Maximize16Regular />}
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
                                    aria-label={loc.close}
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
                            <Editor
                                height="100%"
                                width="100%"
                                language="sql"
                                theme={monacoTheme}
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
                        {selectedEvent.properties.map((property, index) => (
                            <PropertyRow
                                key={`${property.label}-${index}`}
                                property={property}
                                index={index}
                                totalItems={selectedEvent.properties.length}
                                classes={classes}
                                onKeyDown={handlePropertyKeyDown}
                            />
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
};

/**
 * Individual property row component for the Details tab
 */
interface PropertyRowProps {
    property: ProfilerEventProperty;
    index: number;
    totalItems: number;
    classes: ReturnType<typeof useStyles>;
    onKeyDown: (event: React.KeyboardEvent<HTMLDivElement>, index: number, totalItems: number) => void;
}

const PropertyRow: React.FC<PropertyRowProps> = ({
    property,
    index,
    totalItems,
    classes,
    onKeyDown,
}) => {
    return (
        <div
            className={classes.propertyRow}
            tabIndex={0}
            data-property-index={index}
            onKeyDown={(e) => onKeyDown(e, index, totalItems)}
            aria-label={`${property.label}: ${property.value}`}>
            <span className={classes.propertyLabel} title={property.label}>
                {property.label}
            </span>
            <span className={classes.propertyValue} title={property.value}>
                {property.value}
            </span>
        </div>
    );
};

export default ProfilerDetailsPanel;
