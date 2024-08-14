/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createContext } from "react";
import { ObjectExplorerFilteringWebViewState, ObjectExplorerProvider } from "./objectExplorerFilteringInterfaces";

interface ObjectExplorerFilteringContextType {
	provider: ObjectExplorerProvider;
	state: ObjectExplorerFilteringWebViewState;
}

const ObjectExplorerFilteringContext = createContext<ObjectExplorerFilteringContextType>({} as ObjectExplorerFilteringContextType);

export default ObjectExplorerFilteringContext;
