/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { SchemaDesignerContext } from "../schemaDesignerStateProvider";
import { useContext, useEffect } from "react";
import eventBus from "../schemaDesignerEvents";
import { DefinitionPanel, DesignerDefinitionTabs } from "../../../common/definitionPanel";
import { useVscodeWebview } from "../../../common/vscodeWebviewProvider";
import { SchemaDesigner } from "../../../../sharedInterfaces/schemaDesigner";
import { useSchemaDesignerDefinitionPanelContext } from "./schemaDesignerDefinitionPanelContext";

export const SchemaDesignerDefinitionsPanel = () => {
    const context = useContext(SchemaDesignerContext);
    const { themeKind } = useVscodeWebview<
        SchemaDesigner.SchemaDesignerWebviewState,
        SchemaDesigner.SchemaDesignerReducers
    >();
    const { code, setCode, definitionPaneRef } = useSchemaDesignerDefinitionPanelContext();

    useEffect(() => {
        eventBus.on("getScript", () => {
            setTimeout(async () => {
                const script = await context.getDefinition();
                setCode(script);
            }, 0);
        });
        eventBus.on("openCodeDrawer", () => {
            setTimeout(async () => {
                const script = await context.getDefinition();
                setCode(script);
            }, 0);
            if (!definitionPaneRef.current) {
                return;
            }
            if (definitionPaneRef.current.isCollapsed()) {
                definitionPaneRef.current.openPanel(25);
            } else {
                definitionPaneRef.current.closePanel();
            }
        });
    }, []);

    return (
        <DefinitionPanel
            ref={definitionPaneRef}
            scriptTab={{
                value: code,
                language: "sql",
                themeKind,
                openInEditor: context?.openInEditor,
                copyToClipboard: context?.copyToClipboard,
            }}
            activeTab={DesignerDefinitionTabs.Script}
        />
    );
};
