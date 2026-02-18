/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { SchemaDesignerContext } from "../schemaDesignerStateProvider";
import { useContext, useEffect, useState } from "react";
import { DefinitionPanel } from "../../../common/definitionPanel";
import {
    SchemaDesignerDefinitionPanelTab,
    useSchemaDesignerDefinitionPanelContext,
} from "./schemaDesignerDefinitionPanelContext";
import { useSchemaDesignerChangesCustomTab } from "./changes/schemaDesignerChangesTab";
import { useSchemaDesignerScriptTab } from "./schemaDesignerScriptTab";
import { useSchemaDesignerSelector } from "../schemaDesignerSelector";
import { useSchemaDesignerChangeContext } from "./changes/schemaDesignerChangeContext";

export const SchemaDesignerDefinitionsPanel = () => {
    const context = useContext(SchemaDesignerContext);
    const changeContext = useSchemaDesignerChangeContext();
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
        if (!context.isInitialized) {
            return;
        }

        const rafId = requestAnimationFrame(() => {
            void (async () => {
                const [script, baselineScript] = await Promise.all([
                    context.getDefinition(),
                    context.getBaselineDefinition(),
                ]);
                initializeBaselineDefinition(baselineScript);
                setCode(script);
            })();
        });

        return () => {
            cancelAnimationFrame(rafId);
        };
    }, [
        context,
        context.baselineRevision,
        context.isInitialized,
        context.schemaRevision,
        initializeBaselineDefinition,
        setCode,
    ]);

    useEffect(() => {
        return () => {
            setIsChangesPanelVisible(false);
        };
    }, [setIsChangesPanelVisible]);

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
            changeContext.setShowChangesHighlight(false);
            return;
        }

        changeContext.setShowChangesHighlight(true);
    }, [
        activeTab,
        changeContext,
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
                    changeContext.setShowChangesHighlight(false);
                }
            }}
        />
    );
};
