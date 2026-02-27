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
import { useSchemaDesignerCopilotChangesCustomTab } from "./copilot/schemaDesignerCopilotChangesTab";
import { useSchemaDesignerScriptTab } from "./schemaDesignerScriptTab";
import { useSchemaDesignerSelector } from "../schemaDesignerSelector";
import { useSchemaDesignerChangeContext } from "./changes/schemaDesignerChangeContext";
import { useCopilotChangesContext } from "./copilot/copilotChangesContext";

export const SchemaDesignerDefinitionsPanel = () => {
    const {
        isInitialized,
        baselineRevision,
        schemaRevision,
        getDefinition,
        getBaselineDefinition,
    } = useContext(SchemaDesignerContext);
    const { setShowChangesHighlight, setHighlightOverride } = useSchemaDesignerChangeContext();
    const { copilotHighlightOverride } = useCopilotChangesContext();
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
    const copilotChangesCustomTab = useSchemaDesignerCopilotChangesCustomTab();
    const customTabs = isDabEnabled ? [changesCustomTab, copilotChangesCustomTab] : [];

    useEffect(() => {
        const isChangesTabActive = activeTab === SchemaDesignerDefinitionPanelTab.Changes;
        setIsChangesPanelVisible(isDefinitionPanelVisible && isChangesTabActive);
    }, [activeTab, isDefinitionPanelVisible, setIsChangesPanelVisible]);

    useEffect(() => {
        if (!isInitialized) {
            return;
        }

        const rafId = requestAnimationFrame(() => {
            void (async () => {
                const [script, baselineScript] = await Promise.all([
                    getDefinition(),
                    getBaselineDefinition(),
                ]);
                initializeBaselineDefinition(baselineScript);
                setCode(script);
            })();
        });

        return () => {
            cancelAnimationFrame(rafId);
        };
    }, [
        baselineRevision,
        getBaselineDefinition,
        getDefinition,
        initializeBaselineDefinition,
        isInitialized,
        schemaRevision,
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
                const script = await getDefinition();
                setCode(script);
            }, 0);
        }

        if (!isPanelVisible) {
            setShowChangesHighlight(false);
            setHighlightOverride(null);
            return;
        }

        if (activeTab === SchemaDesignerDefinitionPanelTab.Changes) {
            setHighlightOverride(null);
            setShowChangesHighlight(true);
            return;
        }

        if (activeTab === SchemaDesignerDefinitionPanelTab.CopilotChanges) {
            setHighlightOverride(copilotHighlightOverride);
            setShowChangesHighlight(true);
            return;
        }

        setShowChangesHighlight(false);
        setHighlightOverride(null);
    }, [
        activeTab,
        copilotHighlightOverride,
        definitionPaneRef,
        getDefinition,
        isDefinitionPanelVisible,
        setCode,
        setHighlightOverride,
        setShowChangesHighlight,
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
                if (!isVisible) {
                    setShowChangesHighlight(false);
                    setHighlightOverride(null);
                }
            }}
        />
    );
};
