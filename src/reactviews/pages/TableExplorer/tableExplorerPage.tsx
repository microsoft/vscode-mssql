/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { makeStyles } from "@fluentui/react-components";
import { useContext } from "react";
import { TableExplorerContext } from "./tableExplorerStateProvider";
import { TableExplorerCommandBar } from "./tableExplorerCommandBar";

const useStyles = makeStyles({
    root: {
        display: "flex",
        flexDirection: "column",
        height: "100%",
        width: "100%",
    },
});

export const TableExplorer = () => {
    const classes = useStyles();
    const context = useContext(TableExplorerContext);
    const tableExporerState = context?.state;
    if (!tableExporerState) {
        return null;
    }

    return (
        <div className={classes.root}>
            <TableExplorerCommandBar />
            {/* <ResultGrid /> */}

            {
                //TODO: Add tabs when we add Table Diagram
            }
            <h1>Table Explorer grid here</h1>
        </div>
    );
};
