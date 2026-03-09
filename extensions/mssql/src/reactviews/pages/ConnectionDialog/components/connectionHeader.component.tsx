/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { locConstants } from "../../../common/locConstants";
import { DialogHeader } from "../../../common/dialogHeader.component";
import { useWebviewStore } from "../../../common/vscodeWebviewProvider";

const databaseIconLight = require("../../../../../media/database_light.svg");
const databaseIconDark = require("../../../../../media/database_dark.svg");

export const ConnectionHeader = () => {
    const themeKind = useWebviewStore((s) => s.themeKind);
    return (
        <DialogHeader
            iconLight={databaseIconLight}
            iconDark={databaseIconDark}
            title={locConstants.connectionDialog.connectToDatabase}
            themeKind={themeKind}
        />
    );
};
