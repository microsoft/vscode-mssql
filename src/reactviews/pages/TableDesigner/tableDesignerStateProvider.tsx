/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ReactNode, createContext } from 'react';
import * as designer from '../../../sharedInterfaces/tableDesigner';
import { useVscodeWebview } from '../../common/vscodeWebViewProvider';
import { Theme } from '@fluentui/react-components';

export interface TableDesignerState {
	provider: designer.TableDesignerReactProvider;
	state: designer.TableDesignerWebViewState;
	theme: Theme;
}

const TableDesignerContext = createContext<TableDesignerState | undefined>(undefined);

interface TableDesignerContextProps {
	children: ReactNode;
}

const TableDesignerStateProvider: React.FC<TableDesignerContextProps> = ({ children }) => {
	const webViewState = useVscodeWebview<designer.TableDesignerWebViewState, designer.TableDesignerReducers>();
	const tableState = webViewState?.state;
	return <TableDesignerContext.Provider value={
		{
			provider: {
				processTableEdit: function (tableChangeInfo: designer.DesignerEdit): void {
					webViewState?.extensionRpc.action('processTableEdit', {
						table: tableState.tableInfo!,
						tableChangeInfo: tableChangeInfo,
					});
				},
				publishChanges: function (): void {
					webViewState?.extensionRpc.action('publishChanges', { table: tableState.tableInfo! });
				},
				generateScript: function (): void {
					webViewState?.extensionRpc.action('generateScript', { table: tableState.tableInfo! });
				},
				generatePreviewReport: function (): void {
					webViewState?.extensionRpc.action('generatePreviewReport', { table: tableState.tableInfo! });
				},
				initializeTableDesigner: function (): void {
					webViewState?.extensionRpc.action('initializeTableDesigner', { table: tableState.tableInfo! });
				},
				scriptAsCreate: function (): void {
					webViewState?.extensionRpc.action('scriptAsCreate', {});
				},
				setTab: function (tabId: designer.DesignerMainPaneTabs): void {
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
				setPropertiesComponents: function (components: designer.PropertiesPaneData | undefined): void {
					webViewState?.extensionRpc.action('setPropertiesComponents', { components: components! });
				},
				setResultTab: function (tabId: designer.DesignerResultPaneTabs): void {
					webViewState?.extensionRpc.action('setResultTab', { tabId: tabId });
				},
				closeDesigner: function (): void {
					webViewState?.extensionRpc.action('closeDesigner', {});
				},
				continueEditing: function (): void {
					webViewState?.extensionRpc.action('continueEditing', {});
				}
			},
			state: webViewState?.state as designer.TableDesignerWebViewState,
			theme: webViewState?.theme
		}
	}>{children}</TableDesignerContext.Provider>;
};

export { TableDesignerContext, TableDesignerStateProvider }