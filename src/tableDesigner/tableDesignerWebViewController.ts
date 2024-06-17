
import * as vscode from 'vscode';
import ConnectionManager from "../controllers/connectionManager";
import { ObjectExplorerProvider } from "../objectExplorer/objectExplorerProvider";
import { randomUUID } from "crypto";
import { ReactWebViewPanelController } from "../controllers/reactWebviewController";
import * as designer from './tableDesignerInterfaces';
import UntitledSqlDocumentService from '../controllers/untitledSqlDocumentService';
import { getDesignerView } from './tableDesignerTabDefinition';

export class TableDesignerWebViewController extends ReactWebViewPanelController<designer.TableDesignerWebViewState> {
	constructor(context: vscode.ExtensionContext,
		private _tableDesignerService: designer.TableDesignerProvider,
		private _connectionManager: ConnectionManager,
		private _objectExplorerProvider: ObjectExplorerProvider,
		private _untitledSqlDocumentService: UntitledSqlDocumentService
	) {
		super(context, 'Table Designer', 'tableDesigner.js', 'tableDesigner.css', vscode.ViewColumn.Active, {
			apiState: {
				editState: designer.LoadState.NotStarted,
				generateScriptState: designer.LoadState.NotStarted,
				previewState: designer.LoadState.NotStarted,
				publishState: designer.LoadState.NotStarted,
				initializeState: designer.LoadState.Loading
			}
		});
		this.initialize();
	}

	private async initialize() {
		const connectionUri = this._connectionManager.getUriForConnection(this._objectExplorerProvider.currentNode.connectionInfo);
		if (!connectionUri) {
			vscode.window.showErrorMessage('Unable to find connection');
			return;
		}

		const connectionString = await this._connectionManager.getConnectionString(connectionUri, true);
		if (!connectionString || connectionString === '') {
			vscode.window.showErrorMessage('Unable to find connection string for the connection');
			return;
		}
		// get database name from connection string
		const databaseName  = this._objectExplorerProvider.currentNode.connectionInfo.database ? this._objectExplorerProvider.currentNode.connectionInfo.database : 'master';

		try {
			const tableInfo = {
				id: randomUUID(),
				isNewTable: true,
				title: 'New Table',
				tooltip: `${this._objectExplorerProvider.currentNode.connectionInfo.server} - ${databaseName} - New Table`,
				server: this._objectExplorerProvider.currentNode.connectionInfo.server,
				database: databaseName,
				connectionString: connectionString
			};
			this.panel.title = tableInfo.title;
			const intializeData = await this._tableDesignerService.initializeTableDesigner(tableInfo);
			intializeData.tableInfo.database = this._objectExplorerProvider.currentNode.connectionInfo.database ?? 'master';
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
			vscode.window.showErrorMessage('Error initializing table designer: ' + e);
			this.state.apiState.initializeState = designer.LoadState.Error;
			this.state = this.state;
		}

		this.registerRpcHandlers();
	}

	private registerRpcHandlers() {
		this.registerReducers({
			'processTableEdit': async (state, payload: {
				table: designer.TableInfo,
				tableChangeInfo: designer.DesignerEdit
			}) => {
				console.log('state before edit', this.state, payload.tableChangeInfo);
				const editResponse = await this._tableDesignerService.processTableEdit(payload.table, payload.tableChangeInfo);
				console.log('edit response', editResponse);
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
				console.log('state after edit', afterEditState);
				return afterEditState;
			},
			'publishChanges': async (state, payload: {
				table: designer.TableInfo
			}) => {
				this.state = {
					...this.state,
					apiState: {
						...this.state.apiState,
						publishState: designer.LoadState.Loading
					}
				}
				const publishResponse = await this._tableDesignerService.publishChanges(payload.table);
				state = {
					...state,
					tableInfo: publishResponse.newTableInfo,
					view: getDesignerView(publishResponse.view),
					model: publishResponse.viewModel,
					apiState: {
						...state.apiState,
						publishState: designer.LoadState.Loaded
					},
				}
				this.panel.title = state.tableInfo.title;
				return state;
			},
			'generateScript': async (state, payload: {
				table: designer.TableInfo
			}) => {
				this.state = {
					...this.state,
					apiState: {
						...this.state.apiState,
						generateScriptState: designer.LoadState.Loading
					}
				}
				payload.table.database = this._objectExplorerProvider.currentNode.connectionInfo.database ?? 'master';
				const script = await this._tableDesignerService.generateScript(payload.table);
				state = {
					...state,
					apiState: {
						...state.apiState,
						generateScriptState: designer.LoadState.Loaded,
					}
				}
				this._untitledSqlDocumentService.newQuery(script);
				return state;
			},
			'generatePreviewReport': async (state, payload: {
				table: designer.TableInfo
			}) => {
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
				}
				return state;
			},
			'initializeTableDesigner': async (state, payload: {}) => {
				await this.initialize();
				return state;
			},
			'scriptAsCreate': async (state, payload: {}) => {
				this._untitledSqlDocumentService.newQuery(
					(state.model['script'] as designer.InputBoxProperties).value ?? ''
				)
				return state;
			},
			'setTab': async (state, payload: { tabId: designer.DesignerMainPaneTabs }) => {
				state.tabStates.mainPaneTab = payload.tabId;
				return state;
			},
			'setPropertiesComponents': async (state, payload: { components: designer.PropertiesPaneData }) => {
				state.propertiesPaneData = payload.components;
				return state;
			},
			'setResultTab': async (state, payload: { tabId: designer.DesignerResultPaneTabs }) => {
				state.tabStates.resultPaneTab = payload.tabId;
				return state;
			}
		})
	}
}