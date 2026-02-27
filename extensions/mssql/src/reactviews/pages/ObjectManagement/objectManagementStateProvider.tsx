/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createContext, ReactNode } from "react";
import { ObjectManagementWebviewState } from "../../../sharedInterfaces/objectManagement";
import { useVscodeWebview } from "../../common/vscodeWebviewProvider";
import { WebviewRpc } from "../../common/rpc";

export interface ObjectManagementReactProvider<TReducers> {
    extensionRpc: WebviewRpc<TReducers>;
}

export const ObjectManagementContext = createContext<
    ObjectManagementReactProvider<unknown> | undefined
>(undefined);

interface ObjectManagementProviderProps {
    children: ReactNode;
}

const ObjectManagementStateProvider = <TFormState = unknown, TReducers = unknown>({
    children,
}: ObjectManagementProviderProps) => {
    const { extensionRpc } = useVscodeWebview<
        ObjectManagementWebviewState<TFormState>,
        TReducers
    >();
    return (
        <ObjectManagementContext.Provider value={{ extensionRpc }}>
            {children}
        </ObjectManagementContext.Provider>
    );
};

export { ObjectManagementStateProvider };
