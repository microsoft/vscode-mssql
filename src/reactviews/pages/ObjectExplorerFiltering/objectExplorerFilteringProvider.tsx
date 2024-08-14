/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ReactNode, useContext } from "react"
import { VscodeWebviewContext } from "../../common/vscodeWebViewProvider";
import { ObjectExplorerFilteringWebViewState } from "./objectExplorerFilteringInterfaces";
import ObjectExplorerFilteringContext from "./objectExplorerFilteringContext";

interface Props {
	children: ReactNode;
}

const ObjectExplorerFilteringProvider: React.FC<Props> = ({ children }) => {
	debugger;
	const webViewState = useContext(VscodeWebviewContext);
	const objectExplorerFilteringState = webViewState?.state as ObjectExplorerFilteringWebViewState;

	return (
		<ObjectExplorerFilteringContext.Provider value={
			{
				provider: {},
				state: objectExplorerFilteringState
			}
		}>
			{children}
		</ObjectExplorerFilteringContext.Provider>
	);
};

export { ObjectExplorerFilteringContext, ObjectExplorerFilteringProvider };
