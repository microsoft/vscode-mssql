/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ToolbarButton } from "@fluentui/react-components";
import * as FluentIcons from "@fluentui/react-icons";
import { locConstants } from "../../../common/locConstants";
import eventBus from "../schemaDesignerEvents";

export function ViewCodeDialogButton() {
    return (
        <ToolbarButton
            icon={<FluentIcons.Code16Filled />}
            title={locConstants.schemaDesigner.viewCode}
            appearance="subtle"
            onClick={() => {
                eventBus.emit("openCodeDrawer");
            }}>
            {locConstants.schemaDesigner.viewCode}
        </ToolbarButton>
    );
}
