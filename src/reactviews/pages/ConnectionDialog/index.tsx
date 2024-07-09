/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import ReactDOM from 'react-dom/client'
import '../../index.css'
import { VscodeWebViewProvider } from '../../common/vscodeWebViewProvider'

ReactDOM.createRoot(document.getElementById('root')!).render(
	<VscodeWebViewProvider>
		<div>Hello World This is connection dialog</div>
	</VscodeWebViewProvider>
)