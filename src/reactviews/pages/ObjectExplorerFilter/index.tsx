/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import ReactDOM from 'react-dom/client';
import '../../index.css';
import { VscodeWebViewProvider } from '../../common/vscodeWebViewProvider';
import { ObjectExplorerFilterStateProvider } from './ObjectExplorerFilterStateProvider';
import { ObjectExplorerFilterPage } from './ObjectExplorerFilterPage';

ReactDOM.createRoot(document.getElementById('root')!).render(
	<VscodeWebViewProvider>
		<ObjectExplorerFilterStateProvider>
			<ObjectExplorerFilterPage />
		</ObjectExplorerFilterStateProvider>
	</VscodeWebViewProvider>
);