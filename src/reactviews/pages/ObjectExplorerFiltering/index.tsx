/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import ReactDOM from 'react-dom/client'
import '../../index.css'
import { ObjectExplorerFiltering } from './objectExplorerFilteringPage'
import { VscodeWebViewProvider } from '../../common/vscodeWebViewProvider'
import { ObjectExplorerFilteringProvider } from './objectExplorerFilteringProvider'

ReactDOM.createRoot(document.getElementById('root')!).render(
	<VscodeWebViewProvider>
		<ObjectExplorerFilteringProvider>
			<ObjectExplorerFiltering />
		</ObjectExplorerFilteringProvider>
	</VscodeWebViewProvider>
)
