/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createContext, useCallback, useContext, useRef, useState } from "react";
import { DefinitionPanelController } from "../../../common/definitionPanel";

export enum SchemaDesignerDefinitionPanelTab {
    Script = "script",
    Changes = "changes",
    CopilotChanges = "copilotChanges",
}

export enum SchemaDesignerChangesViewMode {
    SchemaChanges = "schemaChanges",
    SchemaDiff = "schemaDiff",
}

interface SchemaDesignerDefinitionPanelContextProps {
    code: string;
    setCode: React.Dispatch<React.SetStateAction<string>>;
    baselineDefinition: string;
    initializeBaselineDefinition: (value: string) => void;
    changesViewMode: SchemaDesignerChangesViewMode;
    setChangesViewMode: React.Dispatch<React.SetStateAction<SchemaDesignerChangesViewMode>>;
    activeTab: SchemaDesignerDefinitionPanelTab;
    setActiveTab: React.Dispatch<React.SetStateAction<SchemaDesignerDefinitionPanelTab>>;
    isChangesPanelVisible: boolean;
    setIsChangesPanelVisible: React.Dispatch<React.SetStateAction<boolean>>;
    /**
     * Toggles the definition panel for a target tab.
     *
     * - If the panel is open on the same tab, it closes.
     * - If the panel is open on a different tab, it stays open and switches to the target tab.
     * - If the panel is closed, it opens on the target tab.
     */
    toggleDefinitionPanel: (tab: SchemaDesignerDefinitionPanelTab) => void;
    definitionPaneRef: React.MutableRefObject<DefinitionPanelController | null>;
}

const SchemaDesignerDefinitionPanelContext = createContext<
    SchemaDesignerDefinitionPanelContextProps | undefined
>(undefined);

interface SchemaDesignerDefinitionPanelProviderProps {
    children: React.ReactNode;
}

export const SchemaDesignerDefinitionPanelProvider: React.FC<
    SchemaDesignerDefinitionPanelProviderProps
> = ({ children }) => {
    const [code, setCode] = useState<string>("");
    const [baselineDefinition, setBaselineDefinition] = useState<string>("");
    const [changesViewMode, setChangesViewMode] = useState<SchemaDesignerChangesViewMode>(
        SchemaDesignerChangesViewMode.SchemaChanges,
    );
    const [activeTab, setActiveTab] = useState<SchemaDesignerDefinitionPanelTab>(
        SchemaDesignerDefinitionPanelTab.Script,
    );
    const [isChangesPanelVisible, setIsChangesPanelVisible] = useState<boolean>(false);
    const definitionPaneRef = useRef<DefinitionPanelController | null>(null);

    const toggleDefinitionPanel = useCallback(
        (tab: SchemaDesignerDefinitionPanelTab) => {
            const panel = definitionPaneRef.current;

            if (!panel) {
                setActiveTab(tab);
                return;
            }

            const isCollapsed = panel.isCollapsed();
            const isSameTab = activeTab === tab;

            if (isCollapsed) {
                setActiveTab(tab);
                panel.openPanel(25);
                return;
            }

            if (isSameTab) {
                panel.closePanel();
                return;
            }

            setActiveTab(tab);
        },
        [activeTab],
    );

    const initializeBaselineDefinition = useCallback((value: string) => {
        setBaselineDefinition(value);
    }, []);

    return (
        <SchemaDesignerDefinitionPanelContext.Provider
            value={{
                code,
                setCode,
                baselineDefinition,
                initializeBaselineDefinition,
                changesViewMode,
                setChangesViewMode,
                activeTab,
                setActiveTab,
                isChangesPanelVisible,
                setIsChangesPanelVisible,
                toggleDefinitionPanel,
                definitionPaneRef,
            }}>
            {children}
        </SchemaDesignerDefinitionPanelContext.Provider>
    );
};

export const useSchemaDesignerDefinitionPanelContext =
    (): SchemaDesignerDefinitionPanelContextProps => {
        const context = useContext(SchemaDesignerDefinitionPanelContext);

        if (!context) {
            throw new Error(
                "useSchemaDesignerDefinitionPanelContext must be used within SchemaDesignerDefinitionPanelProvider",
            );
        }

        return context;
    };
