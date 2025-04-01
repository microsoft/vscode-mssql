/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ToolbarButton } from "@fluentui/react-components";
import * as FluentIcons from "@fluentui/react-icons";
import { locConstants } from "../../../common/locConstants";
import { SchemaDesignerContext } from "../schemaDesignerStateProvider";
import { useContext } from "react";

export function DeleteNodesButton() {
    const context = useContext(SchemaDesignerContext);
    return (
        <ToolbarButton
            icon={<FluentIcons.Delete16Filled />}
            title={locConstants.schemaDesigner.delete}
            appearance="subtle"
            onClick={() => context.deleteSelectedNodes()}>
            {locConstants.schemaDesigner.delete}
        </ToolbarButton>
    );
}
