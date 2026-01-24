/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Button } from "@fluentui/react-components";
import { useContext } from "react";
import eventBus from "../schemaDesignerEvents";
import { SchemaDesignerContext } from "../schemaDesignerStateProvider";
import { locConstants } from "../../../common/locConstants";
import * as FluentIcons from "@fluentui/react-icons";

export function ShowChangesButton() {
    const context = useContext(SchemaDesignerContext);
    const isDabEnabled = context?.state?.enableDAB ?? false;

    if (!isDabEnabled) {
        return null;
    }

    return (
        <Button
            size="small"
            icon={<FluentIcons.BranchCompare16Regular />}
            appearance="subtle"
            onClick={() => {
                eventBus.emit("toggleChangesPanel");
            }}>
            {locConstants.schemaDesigner.showChangesButtonLabel(context.schemaChangesCount)}
        </Button>
    );
}
