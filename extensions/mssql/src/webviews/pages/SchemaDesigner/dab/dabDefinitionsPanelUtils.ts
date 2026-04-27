/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { DefinitionPanelController, DesignerDefinitionTabs } from "../../../common/definitionPanel";

export const DAB_API_DIAGRAM_TAB_ID = "apiDiagram";

export type DabDefinitionPanelTab =
    | typeof DesignerDefinitionTabs.Script
    | typeof DAB_API_DIAGRAM_TAB_ID;

export function openDabDefinitionsPanel(
    panel: DefinitionPanelController | null,
    setActiveTab: (tab: DabDefinitionPanelTab) => void,
): void {
    setActiveTab(DesignerDefinitionTabs.Script);
    panel?.openPanel();
}
