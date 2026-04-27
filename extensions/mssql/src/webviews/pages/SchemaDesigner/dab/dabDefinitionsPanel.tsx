/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { forwardRef, useImperativeHandle, useRef, useState } from "react";
import {
    DefinitionPanel,
    DefinitionPanelController,
    DesignerDefinitionTabs,
} from "../../../common/definitionPanel";
import { useVscodeWebview } from "../../../common/vscodeWebviewProvider";
import { SchemaDesigner } from "../../../../sharedInterfaces/schemaDesigner";
import { Dab } from "../../../../sharedInterfaces/dab";
import { useDabContext } from "./dabContext";
import { locConstants } from "../../../common/locConstants";
import { DabApiDiagram } from "./dabApiDiagram";
import {
    DAB_API_DIAGRAM_TAB_ID,
    DabDefinitionPanelTab,
    openDabDefinitionsPanel,
} from "./dabDefinitionsPanelUtils";

export interface DabDefinitionsPanelRef {
    openPanel: () => void;
}

export const DabDefinitionsPanel = forwardRef<DabDefinitionsPanelRef, {}>((_, ref) => {
    const context = useDabContext();
    const { themeKind } = useVscodeWebview<
        SchemaDesigner.SchemaDesignerWebviewState,
        SchemaDesigner.SchemaDesignerReducers
    >();
    const definitionPaneRef = useRef<DefinitionPanelController>(null);
    const [activeTab, setActiveTab] = useState<DabDefinitionPanelTab>(
        DesignerDefinitionTabs.Script,
    );

    useImperativeHandle(
        ref,
        () => ({
            openPanel: () => {
                openDabDefinitionsPanel(definitionPaneRef.current, setActiveTab);
            },
        }),
        [],
    );

    return (
        <DefinitionPanel
            ref={definitionPaneRef}
            scriptTab={{
                label: locConstants.schemaDesigner.dabConfigTab,
                value: context.dabConfigTextFileContent,
                language: "json",
                themeKind,
                openInEditor: context.openDabConfigInEditor,
                copyToClipboard: (text: string) =>
                    context.copyToClipboard(text, Dab.CopyTextType.Config),
            }}
            customTabs={[
                {
                    id: DAB_API_DIAGRAM_TAB_ID,
                    label: locConstants.schemaDesigner.apiDiagramTab,
                    content: <DabApiDiagram />,
                },
            ]}
            activeTab={activeTab}
            setActiveTab={(tab) => {
                setActiveTab(tab as DabDefinitionPanelTab);
            }}
        />
    );
});
