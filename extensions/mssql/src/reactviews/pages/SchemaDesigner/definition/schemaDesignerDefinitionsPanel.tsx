/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { SchemaDesignerContext } from "../schemaDesignerStateProvider";
import { useContext, useEffect, useMemo, useState } from "react";
import eventBus from "../schemaDesignerEvents";
import { DefinitionPanel } from "../../../common/definitionPanel";
import { useVscodeWebview } from "../../../common/vscodeWebviewProvider";
import { SchemaDesigner } from "../../../../sharedInterfaces/schemaDesigner";
import {
    SchemaDesignerDefinitionPanelTab,
    useSchemaDesignerDefinitionPanelContext,
} from "./schemaDesignerDefinitionPanelContext";
import { SchemaDesignerChangesTab } from "./changes/schemaDesignerChangesTab";
import { locConstants } from "../../../common/locConstants";
import { useSchemaDesignerSelector } from "../schemaDesignerSelector";

export const SchemaDesignerDefinitionsPanel = () => {
    const context = useContext(SchemaDesignerContext);
    const enableDAB = useSchemaDesignerSelector((s) => s?.enableDAB);
    const { themeKind } = useVscodeWebview<
        SchemaDesigner.SchemaDesignerWebviewState,
        SchemaDesigner.SchemaDesignerReducers
    >();
    const { code, setCode, definitionPaneRef, setIsChangesPanelVisible, activeTab, setActiveTab } =
        useSchemaDesignerDefinitionPanelContext();
    const [isDefinitionPanelVisible, setIsDefinitionPanelVisible] = useState<boolean>(true);
    const isDabEnabled = enableDAB ?? false;

    const customTabs = useMemo(() => {
        if (!isDabEnabled) {
            return [];
        }

        return [
            {
                id: SchemaDesignerDefinitionPanelTab.Changes,
                label: locConstants.schemaDesigner.changesPanelTitle(context.schemaChangesCount),
                content: <SchemaDesignerChangesTab />,
            },
        ];
    }, [context.schemaChangesCount, isDabEnabled]);

    useEffect(() => {
        const isChangesTabActive = activeTab === SchemaDesignerDefinitionPanelTab.Changes;
        setIsChangesPanelVisible(isDefinitionPanelVisible && isChangesTabActive);
    }, [activeTab, isDefinitionPanelVisible, setIsChangesPanelVisible]);

    useEffect(() => {
        const refreshScript = async () => {
            const script = await context.getDefinition();
            setCode(script);
        };

        const handleGetScript = () => {
            setTimeout(async () => {
                await refreshScript();
            }, 0);
        };

        eventBus.on("getScript", handleGetScript);

        return () => {
            eventBus.off("getScript", handleGetScript);
            setIsChangesPanelVisible(false);
        };
    }, [context, setCode, setIsChangesPanelVisible]);

    useEffect(() => {
        const panel = definitionPaneRef.current;
        const isPanelVisible = panel ? !panel.isCollapsed() : isDefinitionPanelVisible;

        if (activeTab === SchemaDesignerDefinitionPanelTab.Script && isPanelVisible) {
            setTimeout(async () => {
                const script = await context.getDefinition();
                setCode(script);
            }, 0);
        }

        if (!isPanelVisible || activeTab !== SchemaDesignerDefinitionPanelTab.Changes) {
            context.setShowChangesHighlight(false);
            return;
        }

        context.setShowChangesHighlight(true);
    }, [activeTab, context, definitionPaneRef, isDefinitionPanelVisible, setCode]);

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
            customTabs={customTabs}
            activeTab={activeTab}
            setActiveTab={(tab) => {
                setActiveTab(tab as SchemaDesignerDefinitionPanelTab);
            }}
            onPanelVisibilityChange={(isVisible) => {
                setIsDefinitionPanelVisible(isVisible);
                if (!isVisible && activeTab === SchemaDesignerDefinitionPanelTab.Changes) {
                    context.setShowChangesHighlight(false);
                }
            }}
        />
    );
};
