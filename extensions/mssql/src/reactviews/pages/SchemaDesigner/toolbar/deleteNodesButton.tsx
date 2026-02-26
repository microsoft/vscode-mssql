/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Button, Tooltip } from "@fluentui/react-components";
import * as FluentIcons from "@fluentui/react-icons";
import { locConstants } from "../../../common/locConstants";
import { SchemaDesignerContext } from "../schemaDesignerStateProvider";
import { useContext } from "react";

export function DeleteNodesButton() {
    const context = useContext(SchemaDesignerContext);
    return (
        <Tooltip content={locConstants.schemaDesigner.delete} relationship="label">
            <Button
                appearance="subtle"
                size="small"
                icon={<FluentIcons.Delete16Regular />}
                onClick={() => context.deleteSelectedNodes()}>
                {locConstants.schemaDesigner.delete}
            </Button>
        </Tooltip>
    );
}
