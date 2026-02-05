/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ToolbarButton, Tooltip } from "@fluentui/react-components";
import * as FluentIcons from "@fluentui/react-icons";
import { locConstants } from "../../../common/locConstants";
import eventBus from "../schemaDesignerEvents";

export function ViewDefinitionsButton() {
    return (
        <Tooltip content={locConstants.schemaDesigner.definition} relationship="label">
            <ToolbarButton
                appearance="subtle"
                icon={<FluentIcons.Code20Filled />}
                onClick={() => {
                    eventBus.emit("openCodeDrawer");
                }}
            />
        </Tooltip>
    );
}
