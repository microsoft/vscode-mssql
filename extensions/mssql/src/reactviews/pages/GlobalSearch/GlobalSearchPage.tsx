/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import React from "react";
import { makeStyles, shorthands } from "@fluentui/react-components";
import { useGlobalSearchSelector } from "./globalSearchSelector";

const useStyles = makeStyles({
    root: {
        display: "flex",
        flexDirection: "column",
        height: "100vh",
        width: "100%",
        ...shorthands.overflow("hidden"),
        ...shorthands.padding("20px"),
    },
    heading: {
        ...shorthands.margin(0),
        color: "var(--vscode-foreground)",
    },
});

export const GlobalSearchPage: React.FC = () => {
    const classes = useStyles();
    const serverName = useGlobalSearchSelector((s) => s.serverName);

    return (
        <div className={classes.root}>
            <h1 className={classes.heading}>Global Search</h1>
            <p>Server: {serverName}</p>
        </div>
    );
};
