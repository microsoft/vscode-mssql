/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ReactNode, createContext } from 'react';
import * as designer from '../../../sharedInterfaces/tableDesigner';
import { useVscodeWebview } from '../../common/vscodeWebviewProvider';
import { Theme } from '@fluentui/react-components';

export interface TableDesignerState {
	provider: designer.TableDesignerReactProvider;
	state: designer.TableDesignerWebviewState;
	theme: Theme;
}

const TableDesignerContext = createContext<TableDesignerState | undefined>(undefined);

interface TableDesignerContextProps {
	children: ReactNode;
}

const TableDesignerStateProvider: React.FC<TableDesignerContextProps> = ({ children }) => {
	const webviewState = useVscodeWebview<designer.TableDesignerWebviewState, designer.TableDesignerReducers>();
	const tableState = webviewState?.state;
	return <TableDesignerContext.Provider value={
		{
			provider: {
				processTableEdit: function (tableChangeInfo: designer.DesignerEdit): void {
					webviewState?.extensionRpc.action('processTableEdit', {
						table: tableState.tableInfo!,
						tableChangeInfo: tableChangeInfo,
					});
				},
				publishChanges: function (): void {
					webviewState?.extensionRpc.action('publishChanges', { table: tableState.tableInfo! });
				},
				generateScript: function (): void {
					webviewState?.extensionRpc.action('generateScript', { table: tableState.tableInfo! });
				},
				generatePreviewReport: function (): void {
					webviewState?.extensionRpc.action('generatePreviewReport', { table: tableState.tableInfo! });
				},
				initializeTableDesigner: function (): void {
					webviewState?.extensionRpc.action('initializeTableDesigner', { table: tableState.tableInfo! });
				},
				scriptAsCreate: function (): void {
					webviewState?.extensionRpc.action('scriptAsCreate', {});
				},
				setTab: function (tabId: designer.DesignerMainPaneTabs): void {
					webviewState?.extensionRpc.action('setTab', { tabId: tabId });
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
					webviewState?.extensionRpc.action('setPropertiesComponents', { components: components! });
				},
				setResultTab: function (tabId: designer.DesignerResultPaneTabs): void {
					webviewState?.extensionRpc.action('setResultTab', { tabId: tabId });
				},
				closeDesigner: function (): void {
					webviewState?.extensionRpc.action('closeDesigner', {});
				},
				continueEditing: function (): void {
					webviewState?.extensionRpc.action('continueEditing', {});
				}
			},
			state: webviewState?.state as designer.TableDesignerWebviewState,
			theme: webviewState?.theme
		}
	}>{children}</TableDesignerContext.Provider>;
};

export { TableDesignerContext, TableDesignerStateProvider }