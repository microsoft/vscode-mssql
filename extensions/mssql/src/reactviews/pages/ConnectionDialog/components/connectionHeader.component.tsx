/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { locConstants } from "../../../common/locConstants";
import { DialogHeader } from "../../../common/dialogHeader.component";
import { useConnectionDialogSelector } from "../connectionDialogSelector";
import { useVscodeWebview } from "../../../common/vscodeWebviewProvider";
import {
    ConnectionDialogReducers,
    ConnectionDialogWebviewState,
} from "../../../../sharedInterfaces/connectionDialog";

const databaseIconLight = require("../../../../../media/database_light.svg");
const databaseIconDark = require("../../../../../media/database_dark.svg");

export const ConnectionHeader = () => {
    const { themeKind } = useVscodeWebview<
        ConnectionDialogWebviewState,
        ConnectionDialogReducers
    >();
    const isEditingConnection = useConnectionDialogSelector((s) => s.isEditingConnection);
    const editingConnectionDisplayName = useConnectionDialogSelector(
        (s) => s.editingConnectionDisplayName,
    );

    const title =
        isEditingConnection && editingConnectionDisplayName
            ? locConstants.connectionDialog.editDatabaseConnection(editingConnectionDisplayName)
            : locConstants.connectionDialog.connectToDatabase;

    return (
        <DialogHeader
            iconLight={databaseIconLight}
            iconDark={databaseIconDark}
            title={title}
            themeKind={themeKind}
        />
    );
};
