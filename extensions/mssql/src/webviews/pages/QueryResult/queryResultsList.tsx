/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Spinner, Tab, TabList, Tooltip, makeStyles, tokens } from "@fluentui/react-components";
import {
    CheckmarkCircle16Regular,
    ErrorCircle16Regular,
    Open16Regular,
} from "@fluentui/react-icons";
import { useState } from "react";
import * as qr from "../../../sharedInterfaces/queryResult";
import { locConstants } from "../../common/locConstants";

const DEFAULT_LIST_WIDTH = 180;
const MIN_LIST_WIDTH = 120;
const MAX_LIST_WIDTH = 400;
const RESIZE_STEP = 20;

const clampListWidth = (width: number): number =>
    Math.max(MIN_LIST_WIDTH, Math.min(MAX_LIST_WIDTH, width));

const useStyles = makeStyles({
    container: {
        display: "flex",
        flexDirection: "row",
        boxSizing: "border-box",
        height: "100%",
        flexShrink: 0,
        borderLeft: `1px solid ${tokens.colorNeutralStroke2}`,
    },
    dragHandle: {
        width: "6px",
        flexShrink: 0,
        cursor: "ew-resize",
        backgroundColor: "transparent",
        transition: "background-color 0.15s",
        "&:hover": {
            backgroundColor: "var(--vscode-sash-hoverBorder, var(--vscode-panel-border))",
        },
        "&:focus-visible": {
            backgroundColor: "var(--vscode-sash-hoverBorder, var(--vscode-panel-border))",
            outlineStyle: "none",
        },
    },
    listContainer: {
        flex: 1,
        minWidth: 0,
        height: "100%",
        overflowY: "auto",
        overflowX: "hidden",
    },
    entry: {
        display: "flex",
        alignItems: "center",
        gap: "6px",
        minWidth: 0,
        width: "100%",
    },
    title: {
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
        flex: 1,
        minWidth: 0,
    },
    success: {
        color: tokens.colorPaletteGreenForeground1,
        flexShrink: 0,
    },
    error: {
        color: tokens.colorPaletteRedForeground1,
        flexShrink: 0,
    },
    activeDot: {
        width: "6px",
        height: "6px",
        borderRadius: "50%",
        backgroundColor: tokens.colorBrandForeground1,
        flexShrink: 0,
    },
    openInTabIcon: {
        color: tokens.colorNeutralForeground2,
        flexShrink: 0,
    },
});

export interface QueryResultsListProps {
    sessions: qr.QueryResultSession[];
    selectedUri?: string;
    onSelect: (uri: string) => void;
}

/**
 * Vertical list of query result sessions, modeled after VS Code's terminal tab list. Each entry
 * represents a SQL document's results; selecting one switches the shown results without changing
 * the active editor. The list is bounded by the number of open editors with results, so it is not
 * virtualized.
 */
export const QueryResultsList = ({ sessions, selectedUri, onSelect }: QueryResultsListProps) => {
    const classes = useStyles();
    const [listWidth, setListWidth] = useState(DEFAULT_LIST_WIDTH);

    const startResize = (startX: number) => {
        const startWidth = listWidth;
        const onMouseMove = (event: MouseEvent) => {
            // The handle sits on the left edge of the right-docked rail, so dragging left widens it.
            const delta = event.clientX - startX;
            setListWidth(clampListWidth(startWidth - delta));
        };
        const onMouseUp = () => {
            document.removeEventListener("mousemove", onMouseMove);
            document.removeEventListener("mouseup", onMouseUp);
        };
        document.addEventListener("mousemove", onMouseMove);
        document.addEventListener("mouseup", onMouseUp);
    };

    const renderStatusIcon = (status: qr.QueryResultSessionStatus) => {
        switch (status) {
            case qr.QueryResultSessionStatus.Executing:
                return (
                    <Spinner
                        size="extra-tiny"
                        aria-label={locConstants.queryResult.sessionExecuting}
                    />
                );
            case qr.QueryResultSessionStatus.Error:
                return (
                    <ErrorCircle16Regular
                        className={classes.error}
                        aria-label={locConstants.queryResult.sessionFailed}
                    />
                );
            default:
                return (
                    <CheckmarkCircle16Regular
                        className={classes.success}
                        aria-label={locConstants.queryResult.sessionSucceeded}
                    />
                );
        }
    };

    return (
        <div className={classes.container} style={{ width: listWidth }}>
            <div
                className={classes.dragHandle}
                role="separator"
                aria-orientation="vertical"
                aria-label={locConstants.queryResult.resizeResultsList}
                aria-valuenow={Math.round(listWidth)}
                aria-valuemin={MIN_LIST_WIDTH}
                aria-valuemax={MAX_LIST_WIDTH}
                tabIndex={0}
                onMouseDown={(event) => {
                    event.preventDefault();
                    startResize(event.clientX);
                }}
                onKeyDown={(event) => {
                    if (event.key === "ArrowLeft") {
                        setListWidth((width) => clampListWidth(width + RESIZE_STEP));
                        event.preventDefault();
                    } else if (event.key === "ArrowRight") {
                        setListWidth((width) => clampListWidth(width - RESIZE_STEP));
                        event.preventDefault();
                    }
                }}
            />
            <div className={classes.listContainer}>
                <TabList
                    vertical
                    size="small"
                    selectedValue={selectedUri}
                    onTabSelect={(_event, data) => onSelect(data.value as string)}
                    aria-label={locConstants.queryResult.resultsList}>
                    {sessions.map((session) => (
                        <Tab key={session.uri} value={session.uri}>
                            <div className={classes.entry}>
                                {renderStatusIcon(session.status)}
                                <Tooltip content={session.title} relationship="label" withArrow>
                                    <span className={classes.title}>{session.title}</span>
                                </Tooltip>
                                {session.isOpenInTab && (
                                    <Open16Regular
                                        className={classes.openInTabIcon}
                                        aria-label={locConstants.queryResult.sessionOpenInTab}
                                    />
                                )}
                                {session.isActiveEditor && (
                                    <span
                                        className={classes.activeDot}
                                        role="img"
                                        aria-label={locConstants.queryResult.activeEditorSession}
                                    />
                                )}
                            </div>
                        </Tab>
                    ))}
                </TabList>
            </div>
        </div>
    );
};
