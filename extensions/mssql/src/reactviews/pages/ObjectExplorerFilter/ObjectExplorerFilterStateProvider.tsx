/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    ObjectExplorerFilterContextProps,
    ObjectExplorerFilterState,
    ObjectExplorerReducers,
} from "../../../sharedInterfaces/objectExplorerFilter";

import { createContext, useMemo } from "react";
import { useVscodeWebview2 } from "../../common/vscodeWebviewProvider2";
import { getCoreRPCs2 } from "../../common/utils";

const ObjectExplorerFilterContext = createContext<ObjectExplorerFilterContextProps | undefined>(
    undefined,
);

interface ObjectExplorerFilterStateProviderProps {
    children: React.ReactNode;
}

const ObjectExplorerFilterStateProvider: React.FC<ObjectExplorerFilterStateProviderProps> = ({
    children,
}) => {
    const { extensionRpc } = useVscodeWebview2<ObjectExplorerFilterState, ObjectExplorerReducers>();

    const commands = useMemo<ObjectExplorerFilterContextProps>(
        () => ({
            ...getCoreRPCs2(extensionRpc),
            submit: function (filters): void {
                extensionRpc.action("submit", {
                    filters: filters,
                });
            },
            clearAllFilters: function (): void {},
            cancel: function (): void {
                extensionRpc.action("cancel", {});
            },
        }),
        [extensionRpc],
    );

    return (
        <ObjectExplorerFilterContext.Provider value={commands}>
            {children}
        </ObjectExplorerFilterContext.Provider>
    );
};

export { ObjectExplorerFilterContext, ObjectExplorerFilterStateProvider };
