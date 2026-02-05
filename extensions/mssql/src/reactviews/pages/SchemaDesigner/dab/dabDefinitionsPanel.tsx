/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { forwardRef, useContext, useEffect, useImperativeHandle, useRef } from "react";
import { SchemaDesignerContext } from "../schemaDesignerStateProvider";
import {
    DesignerDefinitionPane,
    DesignerDefinitionPaneRef,
    DesignerDefinitionTabs,
} from "../../../common/designerDefinitionPane";

export interface DabDefinitionsPanelRef {
    togglePanel: () => void;
}

export const DabDefinitionsPanel = forwardRef<DabDefinitionsPanelRef, {}>((_, ref) => {
    const context = useContext(SchemaDesignerContext);
    const definitionPaneRef = useRef<DesignerDefinitionPaneRef>(null);

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
        <DesignerDefinitionPane
            ref={definitionPaneRef}
            script={context.dabConfigContent}
            language="json"
            themeKind={context.themeKind}
            openInEditor={context.openDabConfigInEditor}
            copyToClipboard={context.copyToClipboard}
            activeTab={DesignerDefinitionTabs.Script}
        />
    );
});
