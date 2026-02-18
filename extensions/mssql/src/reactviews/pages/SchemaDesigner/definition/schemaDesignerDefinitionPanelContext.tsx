/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createContext, useContext, useRef, useState } from "react";
import { DefinitionPanelController } from "../../../common/definitionPanel";

interface SchemaDesignerDefinitionPanelContextProps {
    code: string;
    setCode: React.Dispatch<React.SetStateAction<string>>;
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
    const definitionPaneRef = useRef<DefinitionPanelController | null>(
        undefined as unknown as DefinitionPanelController | null,
    );

    return (
        <SchemaDesignerDefinitionPanelContext.Provider value={{ code, setCode, definitionPaneRef }}>
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
