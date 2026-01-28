/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import React, { useState, useEffect, useRef, useCallback } from "react";
import {
    makeStyles,
    shorthands,
    SearchBox,
    Button,
    Tooltip,
} from "@fluentui/react-components";
import { ArrowSyncRegular } from "@fluentui/react-icons";
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

export const GlobalSearchToolbar: React.FC = () => {
    const classes = useStyles();
    const context = useGlobalSearchContext();

    // Keep search input state local to this component to avoid parent re-renders
    const [localSearchValue, setLocalSearchValue] = useState("");
    const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    // Store context.search in a ref so we don't need it in useEffect dependencies
    const searchFnRef = useRef(context.search);
    searchFnRef.current = context.search;

    // Debounce search - trigger backend search after 300ms of no typing
    useEffect(() => {
        if (debounceTimerRef.current) {
            clearTimeout(debounceTimerRef.current);
        }

        debounceTimerRef.current = setTimeout(() => {
            searchFnRef.current(localSearchValue);
        }, 300);

        return () => {
            if (debounceTimerRef.current) {
                clearTimeout(debounceTimerRef.current);
            }
        };
    }, [localSearchValue]);

    const handleSearchChange = useCallback((_event: unknown, data: { value: string }) => {
        setLocalSearchValue(data.value);
    }, []);

    const handleRefresh = useCallback(() => {
        context.refreshResults();
    }, [context]);

    return (
        <div className={classes.toolbar}>
            <div className={classes.searchContainer}>
                <SearchBox
                    className={classes.searchBox}
                    placeholder="Search database objects..."
                    value={localSearchValue}
                    onChange={handleSearchChange}
                    size="medium"
                />
            </div>
            <Button
                appearance="subtle"
                icon={<ArrowSyncRegular />}
                onClick={handleRefresh}
            >
                Refresh
            </Button>
        </div>
    );
};
