/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { makeStyles } from "@fluentui/react-components";
import { useContext } from "react";
import { ConnectionGroupContext } from "./connectionGroupStateProvider";
import { ConnectionGroupDialog } from "./connectionGroup.component";

const useStyles = makeStyles({
    root: {
        display: "flex",
        flexDirection: "column",
        width: "600px",
        maxWidth: "calc(100% - 20px)",
        "> *": {
            marginBottom: "15px",
        },
        padding: "10px",
    },
});

/**
 * Component for managing connection groups
 */
export const ConnectionGroupPage = () => {
    const classes = useStyles();
    const context = useContext(ConnectionGroupContext);

    // If context isn't available yet, don't render
    if (!context?.state) {
        return undefined;
    }

    return (
        <div className={classes.root}>
            <ConnectionGroupDialog
                state={context.state}
                saveConnectionGroup={context.saveConnectionGroup}
                closeDialog={context.closeDialog}
            />
        </div>
    );
};
