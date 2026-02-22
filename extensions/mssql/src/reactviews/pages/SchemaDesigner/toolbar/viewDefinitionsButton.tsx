/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Button, Tooltip } from "@fluentui/react-components";
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
            <Button
                appearance="subtle"
                size="small"
                icon={<FluentIcons.Code16Filled />}
                onClick={() => {
                    toggleDefinitionPanel(SchemaDesignerDefinitionPanelTab.Script);
                }}>
                {locConstants.schemaDesigner.definition}
            </Button>
        </Tooltip>
    );
}
