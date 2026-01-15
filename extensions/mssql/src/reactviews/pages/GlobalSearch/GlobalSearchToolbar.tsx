/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import React, { useEffect, useRef } from "react";
import {
    makeStyles,
    shorthands,
    SearchBox,
    Button,
    Tooltip,
} from "@fluentui/react-components";
import { ArrowSyncRegular, DismissRegular } from "@fluentui/react-icons";
import { useGlobalSearchContext } from "./GlobalSearchStateProvider";

const useStyles = makeStyles({
    toolbar: {
        display: "flex",
        alignItems: "center",
        ...shorthands.gap("8px"),
    },
    searchContainer: {
        display: "flex",
        alignItems: "center",
        flexGrow: 1,
        maxWidth: "500px",
        ...shorthands.gap("4px"),
    },
    searchBox: {
        flexGrow: 1,
    },
});

interface GlobalSearchToolbarProps {
    searchValue: string;
    onSearchChange: (value: string) => void;
}

export const GlobalSearchToolbar: React.FC<GlobalSearchToolbarProps> = ({
    searchValue,
    onSearchChange,
}) => {
    const classes = useStyles();
    const context = useGlobalSearchContext();
    const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    // Debounce search - trigger backend search after 300ms of no typing
    useEffect(() => {
        if (debounceTimerRef.current) {
            clearTimeout(debounceTimerRef.current);
        }

        debounceTimerRef.current = setTimeout(() => {
            context.search(searchValue);
        }, 300);

        return () => {
            if (debounceTimerRef.current) {
                clearTimeout(debounceTimerRef.current);
            }
        };
    }, [searchValue, context]);

    const handleSearchChange = (_event: unknown, data: { value: string }) => {
        onSearchChange(data.value);
    };

    const handleClear = () => {
        onSearchChange("");
        context.clearSearch();
    };

    const handleRefresh = () => {
        context.refreshResults();
    };

    return (
        <div className={classes.toolbar}>
            <div className={classes.searchContainer}>
                <SearchBox
                    className={classes.searchBox}
                    placeholder="Search database objects..."
                    value={searchValue}
                    onChange={handleSearchChange}
                    size="medium"
                />
                {searchValue && (
                    <Tooltip content="Clear search" relationship="label">
                        <Button
                            appearance="subtle"
                            icon={<DismissRegular />}
                            onClick={handleClear}
                            size="small"
                            aria-label="Clear search"
                        />
                    </Tooltip>
                )}
            </div>
            <Tooltip content="Refresh results" relationship="label">
                <Button
                    appearance="subtle"
                    icon={<ArrowSyncRegular />}
                    onClick={handleRefresh}
                    aria-label="Refresh results"
                />
            </Tooltip>
        </div>
    );
};
