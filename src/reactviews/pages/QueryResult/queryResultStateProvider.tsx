/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ReactNode, createContext, useContext } from 'react';
import * as qr from '../../../sharedInterfaces/queryResult';
import { useVscodeWebview } from '../../common/vscodeWebViewProvider';

export interface QueryResultState {
	provider: qr.QueryResultProvider;
	state: qr.QueryResultWebViewState;
}

const QueryResultContext = createContext<QueryResultState | undefined>(undefined);

interface QueryResultContextProps {
	children: ReactNode;
}

const QueryResultStateProvider: React.FC<QueryResultContextProps> = ({ children }) => {
	const webViewState = useVscodeWebview<qr.QueryResultWebViewState, qr.QueryResultReducers>();
	// const queryResultState = webViewState?.state as qr.QueryResultWebViewState;
	return <QueryResultContext.Provider value={
		{
			provider: {

			},
			state: webViewState?.state as qr.QueryResultWebViewState
		}
	}>{children}</QueryResultContext.Provider>;
};

export { QueryResultContext, QueryResultStateProvider };