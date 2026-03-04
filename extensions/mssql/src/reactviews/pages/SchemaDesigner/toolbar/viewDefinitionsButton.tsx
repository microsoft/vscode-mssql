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
    const { toggleDefinitionPanel } = useSchemaDesignerDefinitionPanelContext();
    const isCompact = useIsToolbarCompact();

    return (
        <Tooltip content={locConstants.schemaDesigner.definition} relationship="label">
            <Button
                appearance="subtle"
                size="small"
                icon={<CodeDefinitionIcon16Regular />}
                onClick={() => {
                    toggleDefinitionPanel(SchemaDesignerDefinitionPanelTab.Script);
                }}>
                {!isCompact && locConstants.schemaDesigner.definition}
            </Button>
        </Tooltip>
    );
}
