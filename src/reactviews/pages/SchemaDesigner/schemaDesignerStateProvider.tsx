/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createContext } from "react";
import {
    ISchema,
    SchemaDesignerWebviewState,
} from "../../../sharedInterfaces/schemaDesigner";
import { useVscodeWebview } from "../../common/vscodeWebviewProvider";

export interface SchemaDesignerState {
    schema: ISchema;
}

const SchemaDesignerContext = createContext<SchemaDesignerState | undefined>(
    undefined,
);

interface SchemaDesignerContextProps {
    children: React.ReactNode;
}

const SchemaDesignerStateProvider: React.FC<SchemaDesignerContextProps> = ({
    children,
}) => {
    const webviewState = useVscodeWebview<SchemaDesignerWebviewState, any>();
    return (
        <SchemaDesignerContext.Provider
            value={{ schema: webviewState.state.schema }}
        >
            {children}
        </SchemaDesignerContext.Provider>
    );
};

export { SchemaDesignerContext, SchemaDesignerStateProvider };
