/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Button, Tooltip } from "@fluentui/react-components";
import { locConstants } from "../../../common/locConstants";
import {
    SchemaDesignerDefinitionPanelTab,
    useSchemaDesignerDefinitionPanelContext,
} from "../definition/schemaDesignerDefinitionPanelContext";
import { useIsToolbarCompact } from "./schemaDesignerToolbarContext";
import { CodeDefinitionIcon16Regular } from "../../../common/icons/fluentIcons";

export function ViewDefinitionsButton() {
    const { activeTab, isDefinitionPanelVisible, toggleDefinitionPanel } =
        useSchemaDesignerDefinitionPanelContext();
    const isCompact = useIsToolbarCompact();
    const definitionLabel =
        isDefinitionPanelVisible && activeTab === SchemaDesignerDefinitionPanelTab.Script
            ? locConstants.schemaDesigner.hideDefinition
            : locConstants.schemaDesigner.showDefinition;

    return (
        <Tooltip content={definitionLabel} relationship="label">
            <Button
                appearance="subtle"
                size="small"
                icon={<CodeDefinitionIcon16Regular />}
                onClick={() => {
                    toggleDefinitionPanel(SchemaDesignerDefinitionPanelTab.Script);
                }}>
                {!isCompact && definitionLabel}
            </Button>
        </Tooltip>
    );
}
