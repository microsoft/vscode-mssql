/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ToolbarButton, Tooltip } from "@fluentui/react-components";
import * as FluentIcons from "@fluentui/react-icons";
import { locConstants } from "../../../common/locConstants";
import {
    SchemaDesignerDefinitionPanelTab,
    useSchemaDesignerDefinitionPanelContext,
} from "../definition/schemaDesignerDefinitionPanelContext";

export function ViewDefinitionsButton() {
    const { toggleDefinitionPanel } = useSchemaDesignerDefinitionPanelContext();

    return (
        <Tooltip content={locConstants.schemaDesigner.definition} relationship="label">
            <ToolbarButton
                appearance="subtle"
                icon={<FluentIcons.Code20Filled />}
                onClick={() => {
                    toggleDefinitionPanel(SchemaDesignerDefinitionPanelTab.Script);
                }}
            />
        </Tooltip>
    );
}
