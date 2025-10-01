/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { makeStyles } from "@fluentui/react-components";
import { ChangePasswordDialog } from "./changePasswordDialog";
import { useContext } from "react";
import { ChangePasswordContext } from "./changePasswordStateProvider";
import {
    CancelChangePasswordWebviewNotification,
    ChangePasswordWebviewRequest,
} from "../../../sharedInterfaces/changePassword";
import { useChangePasswordSelector } from "./changePasswordSelector";

// Define styles for the component
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
 * Component for adding a firewall rule to an Azure SQL server
 */
export const ChangePasswordPage = () => {
    const classes = useStyles();
    const context = useContext(ChangePasswordContext);
    const serverName = useChangePasswordSelector((state) => state.server);
    const userName = useChangePasswordSelector((state) => state.userName);

    return (
        <div className={classes.root}>
            <ChangePasswordDialog
                serverName={serverName}
                userName={userName}
                onSubmit={async (newPassword) => {
                    const result = await context?.extensionRpc?.sendRequest(
                        ChangePasswordWebviewRequest.type,
                        newPassword,
                    );
                    return result;
                }}
                onClose={async () => {
                    await context?.extensionRpc?.sendNotification(
                        CancelChangePasswordWebviewNotification.type,
                    );
                }}
            />
        </div>
    );
};
