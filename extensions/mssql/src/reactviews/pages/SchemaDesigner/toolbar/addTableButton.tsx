/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Button, Tooltip } from "@fluentui/react-components";
import { useContext } from "react";
import { SchemaDesignerContext } from "../schemaDesignerStateProvider";
import { locConstants } from "../../../common/locConstants";
import eventBus from "../schemaDesignerEvents";
import { useIsToolbarCompact } from "./schemaDesignerToolbarContext";
import { AddTableIcon16Regular } from "../../../common/icons/addTable";

export function AddTableButton() {
    const context = useContext(SchemaDesignerContext);
    const isCompact = useIsToolbarCompact();
    if (!context) {
        return undefined;
    }

    return (
        <Tooltip content={locConstants.schemaDesigner.addTable} relationship="label">
            <Button
                appearance="subtle"
                size="small"
                icon={<AddTableIcon16Regular />}
                onClick={() => {
                    eventBus.emit("newTable", context.extractSchema());
                }}>
                {!isCompact && locConstants.schemaDesigner.addTable}
            </Button>
        </Tooltip>
    );
}
