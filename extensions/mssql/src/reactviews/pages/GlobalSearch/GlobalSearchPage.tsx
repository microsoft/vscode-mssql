/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import React from "react";
import {
    makeStyles,
    shorthands,
    Spinner,
    tokens,
    Title3,
    Body1,
    MessageBar,
    MessageBarBody,
} from "@fluentui/react-components";
import { useGlobalSearchSelector } from "./globalSearchSelector";
import { GlobalSearchToolbar } from "./GlobalSearchToolbar";
import { GlobalSearchFilters } from "./GlobalSearchFilters";
import { GlobalSearchResultsTable } from "./GlobalSearchResultsTable";
import { ApiStatus } from "../../../sharedInterfaces/webview";

const useStyles = makeStyles({
    root: {
        display: "flex",
        flexDirection: "column",
        height: "100vh",
        width: "100%",
        ...shorthands.overflow("hidden"),
        backgroundColor: "var(--vscode-editor-background)",
    },
    header: {
        display: "flex",
        flexDirection: "column",
        ...shorthands.padding("16px"),
        ...shorthands.gap("12px"),
        ...shorthands.borderBottom("1px", "solid", "var(--vscode-panel-border)"),
    },
    titleRow: {
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
    },
    title: {
        color: "var(--vscode-foreground)",
        ...shorthands.margin(0),
    },
    serverInfo: {
        color: "var(--vscode-descriptionForeground)",
        fontSize: tokens.fontSizeBase200,
    },
    content: {
        display: "flex",
        flexDirection: "row",
        flexGrow: 1,
        ...shorthands.overflow("hidden"),
    },
    filterPanel: {
        width: "240px",
        minWidth: "200px",
        ...shorthands.borderRight("1px", "solid", "var(--vscode-panel-border)"),
        ...shorthands.padding("16px"),
        ...shorthands.overflow("auto"),
    },
    resultsPanel: {
        flexGrow: 1,
        display: "flex",
        flexDirection: "column",
        ...shorthands.overflow("hidden"),
    },
    resultsHeader: {
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        ...shorthands.padding("12px", "16px"),
        ...shorthands.borderBottom("1px", "solid", "var(--vscode-panel-border)"),
    },
    resultsCount: {
        color: "var(--vscode-descriptionForeground)",
        fontSize: tokens.fontSizeBase200,
    },
    resultsTable: {
        flexGrow: 1,
        ...shorthands.overflow("auto"),
    },
    loadingContainer: {
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        height: "100%",
        ...shorthands.gap("16px"),
    },
    errorContainer: {
        ...shorthands.padding("16px"),
    },
});

export const GlobalSearchPage: React.FC = () => {
    const classes = useStyles();

    // State selectors
    const serverName = useGlobalSearchSelector((s) => s.serverName);
    const selectedDatabase = useGlobalSearchSelector((s) => s.selectedDatabase);
    const loadStatus = useGlobalSearchSelector((s) => s.loadStatus);
    const errorMessage = useGlobalSearchSelector((s) => s.errorMessage);
    const searchResults = useGlobalSearchSelector((s) => s.searchResults);
    const totalResultCount = useGlobalSearchSelector((s) => s.totalResultCount);
    const isSearching = useGlobalSearchSelector((s) => s.isSearching);

    // Loading state
    if (loadStatus === ApiStatus.Loading) {
        return (
            <div className={classes.root}>
                <div className={classes.loadingContainer}>
                    <Spinner size="large" label="Loading..." />
                    <Body1>Connecting to {serverName}...</Body1>
                </div>
            </div>
        );
    }

    // Error state
    if (loadStatus === ApiStatus.Error) {
        return (
            <div className={classes.root}>
                <div className={classes.header}>
                    <div className={classes.titleRow}>
                        <Title3 className={classes.title}>Global Search</Title3>
                    </div>
                </div>
                <div className={classes.errorContainer}>
                    <MessageBar intent="error">
                        <MessageBarBody>
                            {errorMessage || "An error occurred while loading data."}
                        </MessageBarBody>
                    </MessageBar>
                </div>
            </div>
        );
    }

    return (
        <div className={classes.root}>
            {/* Header with title and search */}
            <div className={classes.header}>
                <div className={classes.titleRow}>
                    <div>
                        <Title3 className={classes.title}>Global Search</Title3>
                        <span className={classes.serverInfo}>
                            {serverName} / {selectedDatabase}
                        </span>
                    </div>
                </div>
                <GlobalSearchToolbar />
            </div>

            {/* Main content area */}
            <div className={classes.content}>
                {/* Filter panel */}
                <div className={classes.filterPanel}>
                    <GlobalSearchFilters />
                </div>

                {/* Results panel */}
                <div className={classes.resultsPanel}>
                    <div className={classes.resultsHeader}>
                        <span className={classes.resultsCount}>
                            {isSearching
                                ? "Searching..."
                                : `${totalResultCount} object${totalResultCount !== 1 ? "s" : ""} found`}
                        </span>
                    </div>
                    <div className={classes.resultsTable}>
                        <GlobalSearchResultsTable results={searchResults} />
                    </div>
                </div>
            </div>
        </div>
    );
};
