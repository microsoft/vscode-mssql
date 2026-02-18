/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { SchemaDesignerContext } from "../schemaDesignerStateProvider";
import { useContext, useEffect, useMemo, useState } from "react";
import eventBus from "../schemaDesignerEvents";
import {
    DefinitionPanel,
    DefinitionTabIdentifier,
    DesignerDefinitionTabs,
} from "../../../common/definitionPanel";
import { useVscodeWebview } from "../../../common/vscodeWebviewProvider";
import { SchemaDesigner } from "../../../../sharedInterfaces/schemaDesigner";
import {
    SchemaDesignerDefinitionPanelTab,
    useSchemaDesignerDefinitionPanelContext,
} from "./schemaDesignerDefinitionPanelContext";
import { SchemaDesignerChangesTab } from "../changes/schemaDesignerChangesTab";
import { locConstants } from "../../../common/locConstants";
import { useSchemaDesignerSelector } from "../schemaDesignerSelector";

type SchemaDesignerDefinitionCustomTabId = SchemaDesignerDefinitionPanelTab;

export const SchemaDesignerDefinitionsPanel = () => {
    const context = useContext(SchemaDesignerContext);
    const enableDAB = useSchemaDesignerSelector((s) => s?.enableDAB);
    const { themeKind } = useVscodeWebview<
        SchemaDesigner.SchemaDesignerWebviewState,
        SchemaDesigner.SchemaDesignerReducers
    >();
    const {
        code,
        setCode,
        definitionPaneRef,
        setIsChangesPanelVisible,
        registerToggleDefinitionPanelHandler,
    } = useSchemaDesignerDefinitionPanelContext();
    const [isDefinitionPanelVisible, setIsDefinitionPanelVisible] = useState<boolean>(true);
    const [activeTab, setActiveTab] = useState<
        DefinitionTabIdentifier<SchemaDesignerDefinitionCustomTabId>
    >(DesignerDefinitionTabs.Script);
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

        const handleToggleDefinitionPanel = (tab: SchemaDesignerDefinitionPanelTab) => {
            if (!definitionPaneRef.current) {
                return;
            }

            if (tab === SchemaDesignerDefinitionPanelTab.Script) {
                setTimeout(async () => {
                    await refreshScript();
                }, 0);
            }

            const isCollapsed = definitionPaneRef.current.isCollapsed();
            const isSameTab = activeTab === tab;

            if (isCollapsed) {
                setActiveTab(tab);
                definitionPaneRef.current.openPanel(25);
                if (tab === SchemaDesignerDefinitionPanelTab.Changes) {
                    context.setShowChangesHighlight(true);
                }
                return;
            }

            if (isSameTab) {
                definitionPaneRef.current.closePanel();
                if (tab === SchemaDesignerDefinitionPanelTab.Changes) {
                    context.setShowChangesHighlight(false);
                }
                return;
            }

            setActiveTab(tab);
            if (tab === SchemaDesignerDefinitionPanelTab.Changes) {
                context.setShowChangesHighlight(true);
            }
        };

        eventBus.on("getScript", handleGetScript);
        const disposeToggleDefinitionHandler = registerToggleDefinitionPanelHandler(
            handleToggleDefinitionPanel,
        );

        return () => {
            eventBus.off("getScript", handleGetScript);
            disposeToggleDefinitionHandler();
            setIsChangesPanelVisible(false);
        };
    }, [
        activeTab,
        context,
        definitionPaneRef,
        registerToggleDefinitionPanelHandler,
        setCode,
        setIsChangesPanelVisible,
    ]);

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
                setActiveTab(tab);
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
