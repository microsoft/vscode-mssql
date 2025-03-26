/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Button } from "@fluentui/react-components";
import * as FluentIcons from "@fluentui/react-icons";
import { locConstants } from "../../../common/locConstants";
import eventBus from "../schemaDesignerUtils";

export function ViewCodeDialogButton() {
    return (
        <Button
            size="small"
            icon={<FluentIcons.Code16Filled />}
            title={locConstants.schemaDesigner.viewCode}
            appearance="subtle"
            onClick={() => {
                eventBus.emit("openCodeDrawer");
            }}
        >
            {locConstants.schemaDesigner.viewCode}
        </Button>
    );
}
