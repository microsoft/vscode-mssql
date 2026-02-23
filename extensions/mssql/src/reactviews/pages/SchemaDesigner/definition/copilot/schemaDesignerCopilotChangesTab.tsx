/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useMemo } from "react";
import { locConstants } from "../../../../common/locConstants";
import { SchemaDesignerDefinitionPanelTab } from "../schemaDesignerDefinitionPanelContext";

export const useSchemaDesignerCopilotChangesCustomTab = () => {
    return useMemo(
        () => ({
            id: SchemaDesignerDefinitionPanelTab.CopilotChanges,
            label: locConstants.schemaDesigner.copilotChangesPanelTitle || "Copilot Changes",
            headerActions: undefined,
            content: <div>{/* Empty for now */}</div>,
        }),
        [],
    );
};
