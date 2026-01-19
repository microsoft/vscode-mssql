/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useContext } from "react";
import {
    makeStyles,
    Button,
    Tab,
    TabList,
    tokens,
    Text,
} from "@fluentui/react-components";
import {
    Dismiss24Regular,
    ArrowMaximize24Regular,
    ArrowMinimize24Regular,
    Copy24Regular,
    DocumentText24Regular,
} from "@fluentui/react-icons";
import { ProfilerContext } from "./profilerStateProvider";
import { useProfilerSelector } from "./profilerSelector";
import { ProfilerState } from "../../../sharedInterfaces/profiler";

const useStyles = makeStyles({
    detailsPanel: {
        display: "flex",
        flexDirection: "column",
        borderTop: `1px solid ${tokens.colorNeutralStroke1}`,
        backgroundColor: tokens.colorNeutralBackground1,
        height: "300px",
        transition: "height 0.2s ease",
    },
    detailsPanelMaximized: {
        height: "70vh",
    },
    detailsPanelHidden: {
        display: "none",
    },
    headerRow: {
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "8px 12px",
        borderBottom: `1px solid ${tokens.colorNeutralStroke1}`,
        minHeight: "40px",
    },
    tabList: {
        flex: 1,
    },
    actions: {
        display: "flex",
        gap: "4px",
    },
    content: {
        flex: 1,
        overflow: "auto",
        padding: "12px",
    },
    textEditor: {
        width: "100%",
        height: "100%",
        fontFamily: "Consolas, 'Courier New', monospace",
        fontSize: "13px",
        lineHeight: "19px",
        border: `1px solid ${tokens.colorNeutralStroke1}`,
        borderRadius: "4px",
        padding: "8px",
        backgroundColor: tokens.colorNeutralBackground1,
        color: tokens.colorNeutralForeground1,
        overflow: "auto",
        whiteSpace: "pre",
        tabSize: 4,
    },
    detailsTable: {
        width: "100%",
        borderCollapse: "collapse",
    },
    detailsRow: {
        borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
    },
    detailsLabel: {
        padding: "8px 12px",
        fontWeight: 600,
        width: "200px",
        verticalAlign: "top",
        color: tokens.colorNeutralForeground2,
    },
    detailsValue: {
        padding: "8px 12px",
        wordBreak: "break-word",
        color: tokens.colorNeutralForeground1,
    },
    emptyState: {
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        height: "100%",
        color: tokens.colorNeutralForeground3,
    },
});

export const DetailsPanel = () => {
    const classes = useStyles();
    const context = useContext(ProfilerContext);
    const profilerState = useProfilerSelector<ProfilerState>((s) => s.profilerState);

    if (!profilerState.detailsPanelVisible) {
        return null;
    }

    const selectedEvent = profilerState.selectedEvent;
    const activeTab = profilerState.activeTab;
    const isMaximized = profilerState.detailsPanelMaximized;

    const handleClose = () => {
        context?.closeDetailsPanel();
    };

    const handleMaximize = () => {
        context?.toggleMaximize();
    };

    const handleCopy = () => {
        const textData = selectedEvent?.textData || "";
        context?.copyTextData(textData);
    };

    const handleOpenInEditor = () => {
        const textData = selectedEvent?.textData || "";
        context?.openInEditor(textData, "sql");
    };

    const handleTabSelect = (_: any, data: any) => {
        context?.switchTab(data.value as "text" | "details");
    };

    const renderTextTab = () => {
        const textData = selectedEvent?.textData;
        if (!textData) {
            return (
                <div className={classes.emptyState}>
                    <Text>No text data available</Text>
                </div>
            );
        }

        return (
            <div className={classes.textEditor} role="textbox" aria-readonly="true" aria-label="SQL text data">
                {textData}
            </div>
        );
    };

    const renderDetailsTab = () => {
        if (!selectedEvent) {
            return (
                <div className={classes.emptyState}>
                    <Text>No event selected</Text>
                </div>
            );
        }

        const properties = Object.entries(selectedEvent).filter(
            ([key]) => key !== "textData",
        );

        return (
            <table className={classes.detailsTable} role="table" aria-label="Event properties">
                <tbody>
                    {properties.map(([key, value]) => (
                        <tr key={key} className={classes.detailsRow}>
                            <td className={classes.detailsLabel}>{key}</td>
                            <td className={classes.detailsValue}>
                                {value !== null && value !== undefined ? String(value) : ""}
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
        );
    };

    const panelClassName = `${classes.detailsPanel} ${
        isMaximized ? classes.detailsPanelMaximized : ""
    }`;

    return (
        <div className={panelClassName} role="region" aria-label="Event details panel">
            <div className={classes.headerRow}>
                <div className={classes.tabList}>
                    <TabList
                        selectedValue={activeTab}
                        onTabSelect={handleTabSelect}
                        aria-label="Details panel tabs"
                    >
                        <Tab value="text" aria-label="Text tab">
                            Text
                        </Tab>
                        <Tab value="details" aria-label="Details tab">
                            Details
                        </Tab>
                    </TabList>
                </div>
                <div className={classes.actions}>
                    {activeTab === "text" && (
                        <>
                            <Button
                                appearance="subtle"
                                icon={<DocumentText24Regular />}
                                onClick={handleOpenInEditor}
                                aria-label="Open in editor"
                                title="Open in editor"
                            />
                            <Button
                                appearance="subtle"
                                icon={<Copy24Regular />}
                                onClick={handleCopy}
                                aria-label="Copy"
                                title="Copy"
                            />
                        </>
                    )}
                    <Button
                        appearance="subtle"
                        icon={
                            isMaximized ? (
                                <ArrowMinimize24Regular />
                            ) : (
                                <ArrowMaximize24Regular />
                            )
                        }
                        onClick={handleMaximize}
                        aria-label={isMaximized ? "Restore" : "Maximize"}
                        title={isMaximized ? "Restore" : "Maximize"}
                    />
                    <Button
                        appearance="subtle"
                        icon={<Dismiss24Regular />}
                        onClick={handleClose}
                        aria-label="Close"
                        title="Close"
                    />
                </div>
            </div>
            <div className={classes.content}>
                {activeTab === "text" ? renderTextTab() : renderDetailsTab()}
            </div>
        </div>
    );
};
