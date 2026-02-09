/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { SchemaDesignerContext } from "./schemaDesignerStateProvider";
import { useContext, useEffect, useRef, useState } from "react";
import eventBus from "./schemaDesignerEvents";
import {
    DesignerDefinitionPane,
    DesignerDefinitionPaneRef,
    DesignerDefinitionTabs,
} from "../../common/designerDefinitionPane";
import { useVscodeWebview } from "../../common/vscodeWebviewProvider2";
import { SchemaDesigner } from "../../../sharedInterfaces/schemaDesigner";

export const SchemaDesignerDefinitionsPanel = () => {
    const context = useContext(SchemaDesignerContext);
    const { themeKind } = useVscodeWebview<
        SchemaDesigner.SchemaDesignerWebviewState,
        SchemaDesigner.SchemaDesignerReducers
    >();
    const [code, setCode] = useState<string>("");
    const definitionPaneRef = useRef<DesignerDefinitionPaneRef | null>(
        undefined as unknown as DesignerDefinitionPaneRef | null,
    );

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
        <DesignerDefinitionPane
            ref={definitionPaneRef}
            script={code}
            themeKind={themeKind}
            openInEditor={context?.openInEditor}
            copyToClipboard={context?.copyToClipboard}
            activeTab={DesignerDefinitionTabs.Script}
        />
    );
};
