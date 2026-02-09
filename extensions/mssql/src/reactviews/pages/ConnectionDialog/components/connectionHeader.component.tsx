/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { locConstants } from "../../../common/locConstants";
import { DialogHeader } from "../../../common/dialogHeader.component";
import { useVscodeWebview } from "../../../common/vscodeWebviewProvider2";
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
    return (
        <DialogHeader
            iconLight={databaseIconLight}
            iconDark={databaseIconDark}
            title={locConstants.connectionDialog.connectToDatabase}
            themeKind={themeKind}
        />
    );
};
