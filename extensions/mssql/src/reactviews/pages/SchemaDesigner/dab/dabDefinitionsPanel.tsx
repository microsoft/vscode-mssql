/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import {
    DefinitionPanel,
    DefinitionPanelController,
    DesignerDefinitionTabs,
} from "../../../common/definitionPanel";
import { useVscodeWebview } from "../../../common/vscodeWebviewProvider";
import { SchemaDesigner } from "../../../../sharedInterfaces/schemaDesigner";
import { useDabContext } from "./dabContext";

export interface DabDefinitionsPanelRef {
    togglePanel: () => void;
}

export const DabDefinitionsPanel = forwardRef<DabDefinitionsPanelRef, {}>((_, ref) => {
    const context = useDabContext();
    const { themeKind } = useVscodeWebview<
        SchemaDesigner.SchemaDesignerWebviewState,
        SchemaDesigner.SchemaDesignerReducers
    >();
    const definitionPaneRef = useRef<DefinitionPanelController>(null);

    useImperativeHandle(
        ref,
        () => ({
            togglePanel: () => {
                definitionPaneRef.current?.togglePanel();
            },
        }),
        [],
    );

    // Auto-open the panel when a new config is generated
    useEffect(() => {
        if (context.dabConfigRequestId > 0) {
            definitionPaneRef.current?.openPanel();
        }
    }, [context.dabConfigRequestId]);

    return (
        <DefinitionPanel
            ref={definitionPaneRef}
            scriptTab={{
                value: context.dabConfigContent,
                language: "json",
                themeKind,
                openInEditor: context.openDabConfigInEditor,
                copyToClipboard: context.copyToClipboard,
            }}
            activeTab={DesignerDefinitionTabs.Script}
        />
    );
});
