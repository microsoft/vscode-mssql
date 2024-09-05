/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createContext } from "react";
import { useVscodeWebview } from "../../common/vscodeWebViewProvider";
import { ObjectExplorerFilterContextProps, ObjectExplorerFilterState, ObjectExplorerReducers } from "../../../sharedInterfaces/objectExplorerFilter";

const ObjectExplorerFilterContext = createContext<ObjectExplorerFilterContextProps | undefined>(undefined);

interface ObjectExplorerFilterStateProviderProps {
	children: React.ReactNode;
}

const ObjectExplorerFilterStateProvider: React.FC<ObjectExplorerFilterStateProviderProps> = ({ children }) => {
	const webViewState = useVscodeWebview<ObjectExplorerFilterState, ObjectExplorerReducers>();
	const objectExplorerFilterState = webViewState?.state;

	return <ObjectExplorerFilterContext.Provider value={
		{
			state: objectExplorerFilterState,
			theme: webViewState?.theme,
			submit: function (filters): void {
				webViewState?.extensionRpc.action('submit', {
					filters: filters
				});
			},
			clearAllFilters: function (): void {
			},
			cancel: function (): void {
				webViewState?.extensionRpc.action('cancel', {});
			}
		}
	}>{children}</ObjectExplorerFilterContext.Provider>;
};

export { ObjectExplorerFilterContext, ObjectExplorerFilterStateProvider };