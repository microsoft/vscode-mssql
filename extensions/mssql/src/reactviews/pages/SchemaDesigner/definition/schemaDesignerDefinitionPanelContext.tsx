/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createContext, useCallback, useContext, useRef, useState } from "react";
import { DefinitionPanelController } from "../../../common/definitionPanel";

export enum SchemaDesignerDefinitionPanelTab {
    Script = "script",
    Changes = "changes",
}

interface SchemaDesignerDefinitionPanelContextProps {
    code: string;
    setCode: React.Dispatch<React.SetStateAction<string>>;
    isChangesPanelVisible: boolean;
    setIsChangesPanelVisible: React.Dispatch<React.SetStateAction<boolean>>;
    toggleDefinitionPanel: (tab: SchemaDesignerDefinitionPanelTab) => void;
    registerToggleDefinitionPanelHandler: (
        handler: (tab: SchemaDesignerDefinitionPanelTab) => void,
    ) => () => void;
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
    const [isChangesPanelVisible, setIsChangesPanelVisible] = useState<boolean>(false);
    const toggleDefinitionPanelHandlerRef = useRef<
        ((tab: SchemaDesignerDefinitionPanelTab) => void) | undefined
    >(undefined);
    const definitionPaneRef = useRef<DefinitionPanelController | null>(
        undefined as unknown as DefinitionPanelController | null,
    );

    const toggleDefinitionPanel = useCallback((tab: SchemaDesignerDefinitionPanelTab) => {
        toggleDefinitionPanelHandlerRef.current?.(tab);
    }, []);

    const registerToggleDefinitionPanelHandler = useCallback(
        (handler: (tab: SchemaDesignerDefinitionPanelTab) => void) => {
            toggleDefinitionPanelHandlerRef.current = handler;

            return () => {
                if (toggleDefinitionPanelHandlerRef.current === handler) {
                    toggleDefinitionPanelHandlerRef.current = undefined;
                }
            };
        },
        [],
    );

    return (
        <SchemaDesignerDefinitionPanelContext.Provider
            value={{
                code,
                setCode,
                isChangesPanelVisible,
                setIsChangesPanelVisible,
                toggleDefinitionPanel,
                registerToggleDefinitionPanelHandler,
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
