/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Button, Tooltip } from "@fluentui/react-components";
import { locConstants } from "../../../common/locConstants";
import { DeleteIcon16Regular } from "../../../common/icons/fluentIcons";
import { SchemaDesignerContext } from "../schemaDesignerStateProvider";
import { useContext } from "react";
import { useIsToolbarCompact } from "./schemaDesignerToolbarContext";

export function DeleteNodesButton() {
    const context = useContext(SchemaDesignerContext);
    const isCompact = useIsToolbarCompact();
    return (
        <Tooltip content={locConstants.schemaDesigner.delete} relationship="label">
            <Button
                appearance="subtle"
                size="small"
                icon={<DeleteIcon16Regular />}
                onClick={() => context.deleteSelectedNodes()}>
                {!isCompact && locConstants.schemaDesigner.delete}
            </Button>
        </Tooltip>
    );
}
