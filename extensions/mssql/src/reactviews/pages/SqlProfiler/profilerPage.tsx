/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useContext } from "react";
import { ProfilerContext } from "./profilerStateProvider";
import { makeStyles, Spinner, Text } from "@fluentui/react-components";
import { ErrorCircleRegular } from "@fluentui/react-icons";
import { ApiStatus } from "../../../sharedInterfaces/webview";
import { useProfilerSelector } from "./profilerSelector";
import { ProfilerState, ProfilerEvent } from "../../../sharedInterfaces/profiler";
import { DetailsPanel } from "./detailsPanel";

const useStyles = makeStyles({
    container: {
        height: "100%",
        width: "100%",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
    },
    gridContainer: {
        flex: 1,
        overflow: "auto",
        position: "relative",
    },
    spinnerDiv: {
        height: "100%",
        width: "100%",
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        flexDirection: "column",
        padding: "20px",
    },
    errorIcon: {
        fontSize: "100px",
        opacity: 0.5,
    },
    eventsTable: {
        width: "100%",
        borderCollapse: "collapse",
        fontSize: "13px",
    },
    tableHeader: {
        position: "sticky",
        top: 0,
        backgroundColor: "var(--vscode-editor-background)",
        zIndex: 1,
    },
    tableHeaderCell: {
        padding: "8px 12px",
        textAlign: "left",
        borderBottom: "1px solid var(--vscode-editorWidget-border)",
        fontWeight: 600,
        whiteSpace: "nowrap",
    },
    tableRow: {
        cursor: "pointer",
        "&:hover": {
            backgroundColor: "var(--vscode-list-hoverBackground)",
        },
    },
    tableRowSelected: {
        backgroundColor: "var(--vscode-list-activeSelectionBackground)",
        color: "var(--vscode-list-activeSelectionForeground)",
    },
    tableCell: {
        padding: "6px 12px",
        borderBottom: "1px solid var(--vscode-editorWidget-border)",
        whiteSpace: "nowrap",
        overflow: "hidden",
        textOverflow: "ellipsis",
        maxWidth: "300px",
    },
});

export const ProfilerPage = () => {
    const classes = useStyles();
    const context = useContext(ProfilerContext);
    const profilerState = useProfilerSelector<ProfilerState>((s) => s.profilerState);
    const loadState = profilerState?.loadState ?? ApiStatus.Loading;

    const handleRowClick = (event: ProfilerEvent) => {
        context?.selectEvent(event);
    };

    const handleKeyDown = (e: React.KeyboardEvent, event: ProfilerEvent) => {
        if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            context?.selectEvent(event);
        }
    };

    const renderMainContent = () => {
        switch (loadState) {
            case ApiStatus.Loading:
                return (
                    <div className={classes.spinnerDiv}>
                        <Spinner label="Loading profiler events..." labelPosition="below" />
                    </div>
                );
            case ApiStatus.Loaded:
                const events = profilerState?.events ?? [];
                const selectedEvent = profilerState?.selectedEvent;

                if (events.length === 0) {
                    return (
                        <div className={classes.spinnerDiv}>
                            <Text>No events to display</Text>
                        </div>
                    );
                }

                // Get column headers from the first event
                const columns = events.length > 0 ? Object.keys(events[0]) : [];

                return (
                    <table className={classes.eventsTable} role="grid" aria-label="Profiler events">
                        <thead className={classes.tableHeader}>
                            <tr role="row">
                                {columns.map((col) => (
                                    <th
                                        key={col}
                                        className={classes.tableHeaderCell}
                                        role="columnheader"
                                    >
                                        {col}
                                    </th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {events.map((event, index) => {
                                const isSelected = selectedEvent === event;
                                const rowClass = isSelected
                                    ? `${classes.tableRow} ${classes.tableRowSelected}`
                                    : classes.tableRow;
                                return (
                                    <tr
                                        key={index}
                                        className={rowClass}
                                        onClick={() => handleRowClick(event)}
                                        onKeyDown={(e) => handleKeyDown(e, event)}
                                        tabIndex={0}
                                        role="row"
                                        aria-selected={isSelected}
                                    >
                                        {columns.map((col) => (
                                            <td
                                                key={col}
                                                className={classes.tableCell}
                                                role="gridcell"
                                                title={String(event[col] ?? "")}
                                            >
                                                {event[col] !== null && event[col] !== undefined
                                                    ? String(event[col])
                                                    : ""}
                                            </td>
                                        ))}
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                );
            case ApiStatus.Error:
                return (
                    <div className={classes.spinnerDiv}>
                        <ErrorCircleRegular className={classes.errorIcon} />
                        <Text size={400}>{profilerState?.errorMessage ?? "An error occurred"}</Text>
                    </div>
                );
        }
    };

    return (
        <div className={classes.container}>
            <div className={classes.gridContainer}>{renderMainContent()}</div>
            <DetailsPanel />
        </div>
    );
};
