/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { SchemaDesignerContext } from "../schemaDesignerStateProvider";
import { useContext, useEffect } from "react";
import { DefinitionPanel } from "../../../common/definitionPanel";
import {
    SchemaDesignerDefinitionPanelTab,
    useSchemaDesignerDefinitionPanelContext,
} from "./schemaDesignerDefinitionPanelContext";
import { useSchemaDesignerChangesCustomTab } from "./changes/schemaDesignerChangesTab";
import { useSchemaDesignerCopilotChangesCustomTab } from "./copilot/schemaDesignerCopilotChangesTab";
import { useSchemaDesignerScriptTab } from "./schemaDesignerScriptTab";
import { useSchemaDesignerChangeContext } from "./changes/schemaDesignerChangeContext";
import { useCopilotChangesContext } from "./copilot/copilotChangesContext";
import { SchemaDesignerDefinitionFormat } from "./schemaDesignerDefinitionFormats";

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
        setCurrentTsqlDefinition,
        initializeBaselineDefinition,
        definitionPaneRef,
        isDefinitionPanelVisible,
        setIsDefinitionPanelVisible,
        setIsChangesPanelVisible,
        activeTab,
        setActiveTab,
        selectedDefinitionFormat,
    } = useSchemaDesignerDefinitionPanelContext();
    const scriptTab = useSchemaDesignerScriptTab();
    const changesCustomTab = useSchemaDesignerChangesCustomTab();
    const copilotChangesCustomTab = useSchemaDesignerCopilotChangesCustomTab();
    const customTabs = [changesCustomTab, copilotChangesCustomTab];

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
                setCurrentTsqlDefinition(script);
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
        setCurrentTsqlDefinition,
    ]);

    useEffect(() => {
        return () => {
            setIsChangesPanelVisible(false);
        };
    }, [setIsChangesPanelVisible]);

    useEffect(() => {
        const panel = definitionPaneRef.current;
        const isPanelVisible = panel ? !panel.isCollapsed() : isDefinitionPanelVisible;
        let refreshHandle: number | undefined;

        if (
            activeTab === SchemaDesignerDefinitionPanelTab.Script &&
            isPanelVisible &&
            selectedDefinitionFormat === SchemaDesignerDefinitionFormat.TSql
        ) {
            refreshHandle = requestAnimationFrame(() => {
                void (async () => {
                    const script = await getDefinition();
                    setCurrentTsqlDefinition(script);
                })();
            });
        }

        if (!isPanelVisible) {
            setShowChangesHighlight(false);
            setHighlightOverride(null);
        } else if (activeTab === SchemaDesignerDefinitionPanelTab.Changes) {
            setHighlightOverride(null);
            setShowChangesHighlight(true);
        } else if (activeTab === SchemaDesignerDefinitionPanelTab.CopilotChanges) {
            setHighlightOverride(copilotHighlightOverride);
            setShowChangesHighlight(true);
        } else {
            setShowChangesHighlight(false);
            setHighlightOverride(null);
        }

        return () => {
            if (refreshHandle !== undefined) {
                cancelAnimationFrame(refreshHandle);
            }
        };
    }, [
        activeTab,
        copilotHighlightOverride,
        definitionPaneRef,
        getDefinition,
        isDefinitionPanelVisible,
        setCurrentTsqlDefinition,
        setHighlightOverride,
        setShowChangesHighlight,
        selectedDefinitionFormat,
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
