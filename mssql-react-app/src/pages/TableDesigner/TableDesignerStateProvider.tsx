/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ReactNode, createContext, useContext } from 'react';
import * as td from './tableDesignerInterfaces';
import { VscodeWebviewContext } from '../../common/vscodeWebViewProvider';

export interface TableDesignerState {
	provider: td.TableDesignerProvider;
	state: td.TableDesignerWebViewState;
}

const TableDesignerContext = createContext<TableDesignerState | undefined>(undefined);

interface TableDesignerContextProps {
	children: ReactNode;
}

const TableDesignerStateProvider: React.FC<TableDesignerContextProps> = ({ children }) => {
	const webViewState = useContext(VscodeWebviewContext);
	const tableState = webViewState?.state as td.TableDesignerWebViewState;
	return <TableDesignerContext.Provider value={
		{
			provider: {

				processTableEdit: function (tableChangeInfo: td.DesignerEdit): void {
					webViewState?.extensionRpc.action('processTableEdit', {
						table: tableState.tableInfo,
						tableChangeInfo: tableChangeInfo
					});
				},
				publishChanges: function (): void {
					webViewState?.extensionRpc.action('publishChanges', { table: tableState.tableInfo });
				},
				generateScript: function (): void {
					webViewState?.extensionRpc.action('generateScript', { table: tableState.tableInfo });
				},
				generatePreviewReport: function (): void {
					webViewState?.extensionRpc.action('generatePreviewReport', { table: tableState.tableInfo });
				},
				initializeTableDesigner: function (): void {
					webViewState?.extensionRpc.action('initializeTableDesigner', {});
				},
				scriptAsCreate: function (): void {
					webViewState?.extensionRpc.action('scriptAsCreate', {});
				},
				setTab: function (tabId: string): void {
					webViewState?.extensionRpc.action('setTab', { tabId: tabId });
				},
				getComponentId: function (componentPath: (string | number)[]): string {
					return `${tableState.tableInfo?.id}_${componentPath.join('_')}`;
				},
				getErrorMessage: function (componentPath: (string | number)[]): string | undefined {
					const componentPathStr = componentPath.join('.');
					const result = [];
					for (const issue of tableState.issues ?? []) {
						if (issue.propertyPath) {
							if (issue.propertyPath?.join('.') === componentPathStr) {
								result.push(issue.description);
							}
						}

					}
					if (result.length === 0) {
						return undefined;
					}
					return result.join('\n') ?? '';
				},
				setPropertiesComponents: function (components: td.PropertiesPaneData | undefined): void {
					webViewState?.extensionRpc.action('setPropertiesComponents', { components: components });
				},
				setResultTab: function (tabId: string): void {
					webViewState?.extensionRpc.action('setResultTab', { tabId: tabId });
				}
			},
			state: webViewState?.state as td.TableDesignerWebViewState
		}
	}>{children}</TableDesignerContext.Provider>;
};

export { TableDesignerContext, TableDesignerStateProvider }