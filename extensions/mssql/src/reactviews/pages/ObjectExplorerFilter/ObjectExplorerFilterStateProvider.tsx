/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
  ObjectExplorerFilterContextProps,
  ObjectExplorerFilterState,
  ObjectExplorerReducers,
} from "../../../sharedInterfaces/objectExplorerFilter";

import { createContext } from "react";
import { useVscodeWebview } from "../../common/vscodeWebviewProvider";
import { getCoreRPCs } from "../../common/utils";

const ObjectExplorerFilterContext = createContext<
  ObjectExplorerFilterContextProps | undefined
>(undefined);

interface ObjectExplorerFilterStateProviderProps {
  children: React.ReactNode;
}

const ObjectExplorerFilterStateProvider: React.FC<
  ObjectExplorerFilterStateProviderProps
> = ({ children }) => {
  const webviewState = useVscodeWebview<
    ObjectExplorerFilterState,
    ObjectExplorerReducers
  >();
  const objectExplorerFilterState = webviewState?.state;

  return (
    <ObjectExplorerFilterContext.Provider
      value={{
        ...getCoreRPCs(webviewState),
        //isLocalizationLoaded: webviewState?.localization,
        state: objectExplorerFilterState,
        themeKind: webviewState?.themeKind,
        keyBindings: webviewState?.keyBindings,
        submit: function (filters): void {
          webviewState?.extensionRpc.action("submit", {
            filters: filters,
          });
        },
        clearAllFilters: function (): void {},
        cancel: function (): void {
          webviewState?.extensionRpc.action("cancel", {});
        },
      }}
    >
      {children}
    </ObjectExplorerFilterContext.Provider>
  );
};

export { ObjectExplorerFilterContext, ObjectExplorerFilterStateProvider };
