/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ChangePasswordDialog } from "./changePasswordDialog";
import { useContext } from "react";
import { ChangePasswordContext } from "./changePasswordStateProvider";
import {
    CancelChangePasswordWebviewNotification,
    ChangePasswordWebviewRequest,
} from "../../../sharedInterfaces/changePassword";
import { useChangePasswordSelector } from "./changePasswordSelector";

/**
 * Component for adding a firewall rule to an Azure SQL server
 */
export const ChangePasswordPage = () => {
    const context = useContext(ChangePasswordContext);
    const serverName = useChangePasswordSelector((state) => state.server);
    const userName = useChangePasswordSelector((state) => state.userName);

    return (
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
    );
};
