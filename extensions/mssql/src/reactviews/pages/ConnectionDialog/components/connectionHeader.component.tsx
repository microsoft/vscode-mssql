/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ConnectionDialogContext } from "../connectionDialogStateProvider";
import { locConstants } from "../../../common/locConstants";
import { useContext } from "react";
import { DialogHeader } from "../../../common/dialogHeader.component";

const databaseIconLight = require("../../../../../media/database_light.svg");
const databaseIconDark = require("../../../../../media/database_dark.svg");

export const ConnectionHeader = () => {
    const connectionDialogContext = useContext(ConnectionDialogContext);
    return (
        <DialogHeader
            iconLight={databaseIconLight}
            iconDark={databaseIconDark}
            title={locConstants.connectionDialog.connectToDatabase}
            themeKind={connectionDialogContext?.themeKind}
        />
    );
};
