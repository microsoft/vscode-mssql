/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Button } from "@fluentui/react-components";
import * as FluentIcons from "@fluentui/react-icons";
import { locConstants } from "../../../common/locConstants";
import eventBus from "../schemaDesignerEvents";

export function ViewDefinitionsButton() {
    return (
        <Button
            size="small"
            appearance="subtle"
            icon={<FluentIcons.Code16Filled />}
            title={locConstants.schemaDesigner.definition}
            onClick={() => {
                eventBus.emit("openCodeDrawer");
            }}>
            {locConstants.schemaDesigner.definition}
        </Button>
    );
}
