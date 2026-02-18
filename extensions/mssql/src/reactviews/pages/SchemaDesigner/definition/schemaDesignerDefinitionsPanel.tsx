/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { SchemaDesignerContext } from "../schemaDesignerStateProvider";
import { useContext, useEffect, useState } from "react";
import eventBus from "../schemaDesignerEvents";
import { DefinitionPanel } from "../../../common/definitionPanel";
import {
    SchemaDesignerDefinitionPanelTab,
    useSchemaDesignerDefinitionPanelContext,
} from "./schemaDesignerDefinitionPanelContext";
import { useSchemaDesignerChangesCustomTab } from "./changes/schemaDesignerChangesTab";
import { useSchemaDesignerScriptTab } from "./schemaDesignerScriptTab";
import { useSchemaDesignerSelector } from "../schemaDesignerSelector";

export const SchemaDesignerDefinitionsPanel = () => {
    const context = useContext(SchemaDesignerContext);
    const {
        setCode,
        initializeBaselineDefinition,
        definitionPaneRef,
        setIsChangesPanelVisible,
        activeTab,
        setActiveTab,
    } = useSchemaDesignerDefinitionPanelContext();
    const [isDefinitionPanelVisible, setIsDefinitionPanelVisible] = useState<boolean>(true);
    const enableDAB = useSchemaDesignerSelector((state) => state?.enableDAB);
    const isDabEnabled = enableDAB ?? false;
    const scriptTab = useSchemaDesignerScriptTab();
    const changesCustomTab = useSchemaDesignerChangesCustomTab();
    const customTabs = isDabEnabled ? [changesCustomTab] : [];

    useEffect(() => {
        const isChangesTabActive = activeTab === SchemaDesignerDefinitionPanelTab.Changes;
        setIsChangesPanelVisible(isDefinitionPanelVisible && isChangesTabActive);
    }, [activeTab, isDefinitionPanelVisible, setIsChangesPanelVisible]);

    useEffect(() => {
        const refreshScript = async () => {
            const [script, baselineScript] = await Promise.all([
                context.getDefinition(),
                context.getBaselineDefinition(),
            ]);
            initializeBaselineDefinition(baselineScript);
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
    }, [context, initializeBaselineDefinition, setCode, setIsChangesPanelVisible]);

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
    }, [
        activeTab,
        context,
        definitionPaneRef,
        initializeBaselineDefinition,
        isDefinitionPanelVisible,
        setCode,
    ]);

    return (
        <DefinitionPanel
            ref={definitionPaneRef}
            scriptTab={scriptTab}
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
