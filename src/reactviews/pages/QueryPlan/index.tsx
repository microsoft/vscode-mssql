/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import ReactDOM from 'react-dom/client'
import '../../index.css'
import { VscodeWebViewProvider } from '../../common/vscodeWebViewProvider'
import { QueryPlan } from './queryPlanPage'

ReactDOM.createRoot(document.getElementById('root')!).render(
	<VscodeWebViewProvider>
		<QueryPlan></QueryPlan>
	</VscodeWebViewProvider>
)