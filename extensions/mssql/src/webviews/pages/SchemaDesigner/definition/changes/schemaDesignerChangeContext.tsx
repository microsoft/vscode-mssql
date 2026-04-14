/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createContext, useContext } from "react";
import { SchemaDesignerContext } from "../../schemaDesignerStateProvider";
import {
    SchemaDesignerChangeContextProps,
    useSchemaDesignerChangeState,
} from "./useSchemaDesignerChangeState";

const SchemaDesignerChangeContext = createContext<SchemaDesignerChangeContextProps | undefined>(
    undefined,
);

interface SchemaDesignerChangeProviderProps {
    children: React.ReactNode;
}

export const SchemaDesignerChangeProvider: React.FC<SchemaDesignerChangeProviderProps> = ({
    children,
}) => {
    const schemaDesignerContext = useContext(SchemaDesignerContext);
    const value = useSchemaDesignerChangeState(schemaDesignerContext);

    return (
        <SchemaDesignerChangeContext.Provider value={value}>
            {children}
        </SchemaDesignerChangeContext.Provider>
    );
};

export const useSchemaDesignerChangeContext = (): SchemaDesignerChangeContextProps => {
    const context = useContext(SchemaDesignerChangeContext);
    if (!context) {
        throw new Error(
            "useSchemaDesignerChangeContext must be used within a SchemaDesignerChangeProvider",
        );
    }
    return context;
};
