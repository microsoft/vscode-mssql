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
} from "@fluentui/react-components";
import { useSearchDatabaseSelector } from "./searchDatabaseSelector";
import { useSearchDatabaseContext } from "./SearchDatabaseStateProvider";
import { SearchDatabaseToolbar } from "./SearchDatabaseToolbar";
import { SearchDatabaseFilters } from "./SearchDatabaseFilters";
import { SearchDatabaseResultsTable } from "./SearchDatabaseResultsTable";
import { ErrorDialog } from "../../common/errorDialog";
import { ApiStatus } from "../../../sharedInterfaces/webview";
import { locConstants as loc } from "../../common/locConstants";

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
        display: "block",
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
        justifyContent: "center",
        alignItems: "center",
        height: "100%",
        width: "100%",
        flexDirection: "column",
    },
});

export const SearchDatabasePage: React.FC = () => {
    const classes = useStyles();
    const context = useSearchDatabaseContext();

    // State selectors
    const serverName = useSearchDatabaseSelector((s) => s.serverName);
    const selectedDatabase = useSearchDatabaseSelector((s) => s.selectedDatabase);
    const loadStatus = useSearchDatabaseSelector((s) => s.loadStatus);
    const errorMessage = useSearchDatabaseSelector((s) => s.errorMessage);
    const searchResults = useSearchDatabaseSelector((s) => s.searchResults);
    const totalResultCount = useSearchDatabaseSelector((s) => s.totalResultCount);
    const isSearching = useSearchDatabaseSelector((s) => s.isSearching);

    const isErrorState = loadStatus === ApiStatus.Error;

    return (
        <div className={classes.root}>
            {loadStatus === ApiStatus.Loading && (
                <div className={classes.loadingContainer}>
                    <Spinner
                        label={loc.searchDatabase.loading}
                        labelPosition="below"
                    />
                </div>
            )}
            {isErrorState && (
                <ErrorDialog
                    open={isErrorState}
                    title={loc.searchDatabase.errorLoadingSearchDatabase}
                    message={errorMessage || loc.searchDatabase.defaultError}
                    retryLabel={loc.searchDatabase.retry}
                    onRetry={() => context.retry()}
                />
            )}
            {loadStatus === ApiStatus.Loaded && (
                <>
                    {/* Header with title and search */}
                    <div className={classes.header}>
                        <div className={classes.titleRow}>
                            <div>
                                <Title3 className={classes.title}>
                                    {loc.searchDatabase.title}
                                </Title3>
                                <span className={classes.serverInfo}>
                                    {serverName} / {selectedDatabase}
                                </span>
                            </div>
                        </div>
                        <SearchDatabaseToolbar />
                    </div>

                    {/* Main content area */}
                    <div className={classes.content}>
                        {/* Filter panel */}
                        <div className={classes.filterPanel}>
                            <SearchDatabaseFilters />
                        </div>

                        {/* Results panel */}
                        <div className={classes.resultsPanel}>
                            <div className={classes.resultsHeader}>
                                <span className={classes.resultsCount}>
                                    {isSearching
                                        ? loc.searchDatabase.searching
                                        : loc.searchDatabase.objectsFound(totalResultCount)}
                                </span>
                            </div>
                            <div className={classes.resultsTable}>
                                <SearchDatabaseResultsTable results={searchResults} />
                            </div>
                        </div>
                    </div>
                </>
            )}
        </div>
    );
};
