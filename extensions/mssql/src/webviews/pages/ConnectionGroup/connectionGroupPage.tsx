/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useContext } from "react";
import { ConnectionGroupContext } from "./connectionGroupStateProvider";
import { ConnectionGroupDialog } from "./connectionGroup.component";
import { useConnectionGroupSelector } from "./connectionGroupSelector";

/**
 * Component for managing connection groups
 */
export const ConnectionGroupPage = () => {
    const context = useContext(ConnectionGroupContext);
    const existingGroupName = useConnectionGroupSelector((s) => s?.existingGroupName);
    const description = useConnectionGroupSelector((s) => s?.description);
    const color = useConnectionGroupSelector((s) => s?.color);
    const message = useConnectionGroupSelector((s) => s?.message);

    // If context isn't available yet, don't render
    if (!context) {
        return undefined;
    }

    return (
        <ConnectionGroupDialog
            state={{ existingGroupName, description, color, message, name: "" }}
            saveConnectionGroup={context.saveConnectionGroup}
            closeDialog={context.closeDialog}
        />
    );
};
