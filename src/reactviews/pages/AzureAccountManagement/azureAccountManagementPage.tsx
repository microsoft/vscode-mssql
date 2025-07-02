/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { makeStyles } from "@fluentui/react-components";
import { AzureAccountManagementStateProvider } from "./azureAccountManagementStateProvider";
import { AzureAccountManagementDialog } from "./azureAccountManagementDialog";

const useStyles = makeStyles({
    root: {
        display: "flex",
        flexDirection: "column",
        height: "100%",
        width: "100%",
        maxWidth: "100%",
        maxHeight: "100%",
    },
});

export const AzureAccountManagementPage = () => {
    const classes = useStyles();

    return (
        <div className={classes.root}>
            <AzureAccountManagementStateProvider>
                <AzureAccountManagementDialog />
            </AzureAccountManagementStateProvider>
        </div>
    );
};
