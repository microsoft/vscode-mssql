/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import ConnectionManager from "../controllers/connectionManager";
import { randomUUID } from "crypto";
import { ReactWebViewPanelController } from "../controllers/reactWebviewController";
import * as designer from '../sharedInterfaces/tableDesigner';
import UntitledSqlDocumentService from '../controllers/untitledSqlDocumentService';
import { getDesignerView } from './tableDesignerTabDefinition';
import { TreeNodeInfo } from '../objectExplorer/treeNodeInfo';

export class TableDesignerWebViewController extends ReactWebViewPanelController<designer.TableDesignerWebViewState, designer.TableDesignerReducers> {
	private _isEdit: boolean = false;

	constructor(context: vscode.ExtensionContext,
		private _tableDesignerService: designer.ITableDesignerService,
		private _connectionManager: ConnectionManager,
		private _untitledSqlDocumentService: UntitledSqlDocumentService,
		private _targetNode?: TreeNodeInfo
	) {
		super(context, 'Table Designer', 'tableDesigner', {
			apiState: {
				editState: designer.LoadState.NotStarted,
				generateScriptState: designer.LoadState.NotStarted,
				previewState: designer.LoadState.NotStarted,
				publishState: designer.LoadState.NotStarted,
				initializeState: designer.LoadState.Loading
			}
		}, vscode.ViewColumn.Active, {
			dark: vscode.Uri.joinPath(context.extensionUri, 'media', 'tableDesignerEditor_inverse.svg'),
			light: vscode.Uri.joinPath(context.extensionUri, 'media', 'tableDesignerEditor.svg')
		});
		this.initialize();
	}

	private async initialize() {
		if (!this._targetNode) {
			await vscode.window.showErrorMessage('Unable to find object explorer node');
			return;
		}

		this._isEdit = this._targetNode.nodeType === 'Table' || this._targetNode.nodeType === 'View' ? true : false;

		const targetDatabase = this.getDatabaseNameForNode(this._targetNode);
		// get database name from connection string
		const databaseName = targetDatabase ? targetDatabase : 'master';


		const connectionInfo = this._targetNode.connectionInfo;
		connectionInfo.database = databaseName;

		const connectionDetails = await this._connectionManager.createConnectionDetails(connectionInfo);
		const connectionString = await this._connectionManager.getConnectionString(connectionDetails, true, true);

		if (!connectionString || connectionString === '') {
			await vscode.window.showErrorMessage('Unable to find connection string for the connection');
			return;
		}

		try {
			let tableInfo: designer.TableInfo;
			if (this._isEdit) {
				tableInfo = {
					id: randomUUID(),
					isNewTable: false,
					title: this._targetNode.label as string,
					tooltip: `${connectionInfo.server} - ${databaseName} - ${this._targetNode.label}`,
					server: connectionInfo.server,
					database: databaseName,
					connectionString: connectionString,
					schema: this._targetNode.metadata.schema,
					name: this._targetNode.metadata.name
				};
			} else {
				tableInfo = {
					id: randomUUID(),
					isNewTable: true,
					title: 'New Table',
					tooltip: `${connectionInfo.server} - ${databaseName} - New Table`,
					server: connectionInfo.server,
					database: databaseName,
					connectionString: connectionString
				};
			}
			this.panel.title = tableInfo.title;
			const intializeData = await this._tableDesignerService.initializeTableDesigner(tableInfo);
			intializeData.tableInfo.database = databaseName ?? 'master';
			this.state = {
				tableInfo: tableInfo,
				view: getDesignerView(intializeData.view),
				model: intializeData.viewModel,
				issues: intializeData.issues,
				isValid: true,
				tabStates: {
					mainPaneTab: designer.DesignerMainPaneTabs.AboutTable,
					resultPaneTab: designer.DesignerResultPaneTabs.Script
				},
				apiState: {
					...this.state.apiState,
					initializeState: designer.LoadState.Loaded
				}
			};

		} catch (e) {
			await vscode.window.showErrorMessage('Error initializing table designer: ' + e);
			this.state.apiState.initializeState = designer.LoadState.Error;
			this.state = this.state;
		}

		this.registerRpcHandlers();
	}

	private getDatabaseNameForNode(node: TreeNodeInfo): string {
		if (node.metadata?.metadataTypeName === 'Database') {
			return node.metadata.name;
		} else {
			if (node.parentNode) {
				return this.getDatabaseNameForNode(node.parentNode);
			}
		}
		return '';
	}

	private registerRpcHandlers() {
		this.registerReducer('processTableEdit', async (state, payload) => {
			const editResponse = await this._tableDesignerService.processTableEdit(payload.table, payload.tableChangeInfo);
			const afterEditState = {
				...this.state,
				view: editResponse.view ? getDesignerView(editResponse.view) : this.state.view,
				model: editResponse.viewModel,
				issues: editResponse.issues,
				isValid: editResponse.isValid,
				apiState: {
					...this.state.apiState,
					editState: designer.LoadState.Loaded
				}
			};
			return afterEditState;
		});

		this.registerReducer('publishChanges', async (state, payload) => {
			this.state = {
				...this.state,
				apiState: {
					...this.state.apiState,
					publishState: designer.LoadState.Loading
				}
			};
			const publishResponse = await this._tableDesignerService.publishChanges(payload.table);
			state = {
				...state,
				tableInfo: publishResponse.newTableInfo,
				view: getDesignerView(publishResponse.view),
				model: publishResponse.viewModel,
				apiState: {
					...state.apiState,
					publishState: designer.LoadState.Loaded,
					previewState: designer.LoadState.NotStarted
				},
			};
			this.panel.title = state.tableInfo.title;
			return state;
		});

		this.registerReducer('generateScript', async (state, payload) => {
			this.state = {
				...this.state,
				apiState: {
					...this.state.apiState,
					generateScriptState: designer.LoadState.Loading
				}
			}
			const script = await this._tableDesignerService.generateScript(payload.table);
			state = {
				...state,
				apiState: {
					...state.apiState,
					generateScriptState: designer.LoadState.Loaded,
				}
			};
			await this._untitledSqlDocumentService.newQuery(script);
			return state;
		});

		this.registerReducer('generatePreviewReport', async (state, payload) => {
			this.state = {
				...this.state,
				apiState: {
					...this.state.apiState,
					previewState: designer.LoadState.Loading
				}
			}
			const previewReport = await this._tableDesignerService.generatePreviewReport(payload.table);
			state = {
				...state,
				apiState: {
					...state.apiState,
					previewState: designer.LoadState.Loaded
				},
				generatePreviewReportResult: previewReport
			};
			return state;
		});

		this.registerReducer('initializeTableDesigner', async (state) => {
			await this.initialize();
			return state;
		});

		this.registerReducer('scriptAsCreate', async (state) => {
			await this._untitledSqlDocumentService.newQuery(
				(state.model['script'] as designer.InputBoxProperties).value ?? ''
			);
			return state;
		});

		this.registerReducer('setTab', async (state, payload) => {
			state.tabStates.mainPaneTab = payload.tabId;
			return state;
		});

		this.registerReducer('setPropertiesComponents', async (state, payload) => {
			state.propertiesPaneData = payload.components;
			return state;
		});

		this.registerReducer('setResultTab', async (state, payload) => {
			state.tabStates.resultPaneTab = payload.tabId;
			return state;
		});

		this.registerReducer('closeDesigner', async (state) => {
			this.panel.dispose();
			return state;
		});

		this.registerReducer('continueEditing', async (state) => {
			this.state.apiState.publishState = designer.LoadState.NotStarted;
			return state;
		});
	}
}