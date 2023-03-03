/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as events from 'events';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { IConnectionInfo } from 'vscode-mssql';
import { AzureResourceController } from '../azure/azureResourceController';
import * as Constants from '../constants/constants';
import * as LocalizedConstants from '../constants/localizedConstants';
import SqlToolsServerClient from '../languageservice/serviceclient';
import * as ConnInfo from '../models/connectionInfo';
import { CompletionExtensionParams, CompletionExtLoadRequest, RebuildIntelliSenseNotification } from '../models/contracts/languageService';
import { ScriptOperation } from '../models/contracts/scripting/scriptingRequest';
import { SqlOutputContentProvider } from '../models/sqlOutputContentProvider';
import * as Utils from '../models/utils';
import { AccountSignInTreeNode } from '../objectExplorer/accountSignInTreeNode';
import { ConnectTreeNode } from '../objectExplorer/connectTreeNode';
import { ObjectExplorerProvider } from '../objectExplorer/objectExplorerProvider';
import { ObjectExplorerUtils } from '../objectExplorer/objectExplorerUtils';
import { TreeNodeInfo } from '../objectExplorer/treeNodeInfo';
import CodeAdapter from '../prompts/adapter';
import { IPrompter } from '../prompts/question';
import { Deferred } from '../protocol';
import { QueryHistoryNode } from '../queryHistory/queryHistoryNode';
import { QueryHistoryProvider } from '../queryHistory/queryHistoryProvider';
import { ScriptingService } from '../scripting/scriptingService';
import { AzureAccountService } from '../services/azureAccountService';
import { AzureResourceService } from '../services/azureResourceService';
import { DacFxService } from '../services/dacFxService';
import { SqlProjectsService } from '../services/sqlProjectsService';
import { SchemaCompareService } from '../services/schemaCompareService';
import { SqlTasksService } from '../services/sqlTasksService';
import StatusView from '../views/statusView';
import { IConnectionProfile, ISelectionData } from './../models/interfaces';
import ConnectionManager from './connectionManager';
import UntitledSqlDocumentService from './untitledSqlDocumentService';
import VscodeWrapper from './vscodeWrapper';

/**
 * The main controller class that initializes the extension
 */
export default class MainController implements vscode.Disposable {
	private _context: vscode.ExtensionContext;
	private _event: events.EventEmitter = new events.EventEmitter();
	private _outputContentProvider: SqlOutputContentProvider;
	private _statusview: StatusView;
	private _connectionMgr: ConnectionManager;
	private _prompter: IPrompter;
	private _vscodeWrapper: VscodeWrapper;
	private _initialized: boolean = false;
	private _lastSavedUri: string | undefined;
	private _lastSavedTimer: Utils.Timer | undefined;
	private _lastOpenedUri: string | undefined;
	private _lastOpenedTimer: Utils.Timer | undefined;
	private _untitledSqlDocumentService: UntitledSqlDocumentService;
	private _objectExplorerProvider: ObjectExplorerProvider;
	private _queryHistoryProvider: QueryHistoryProvider;
	private _scriptingService: ScriptingService;
	private _queryHistoryRegistered: boolean = false;
	public sqlTasksService: SqlTasksService;
	public dacFxService: DacFxService;
	public schemaCompareService: SchemaCompareService;
	public sqlProjectsService: SqlProjectsService;
	public azureAccountService: AzureAccountService;
	public azureResourceService: AzureResourceService;

	/**
	 * The main controller constructor
	 * @constructor
	 */
	constructor(context: vscode.ExtensionContext,
		connectionManager?: ConnectionManager,
		vscodeWrapper?: VscodeWrapper) {
		this._context = context;
		if (connectionManager) {
			this._connectionMgr = connectionManager;
		}
		this._vscodeWrapper = vscodeWrapper || new VscodeWrapper();
		this._untitledSqlDocumentService = new UntitledSqlDocumentService(this._vscodeWrapper);
	}

	/**
	 * Helper method to setup command registrations
	 */
	public registerCommand(command: string): void {
		const self = this;
		this._context.subscriptions.push(vscode.commands.registerCommand(command, () => self._event.emit(command)));
	}

	/**
	 * Helper method to setup command registrations with arguments
	 */
	private registerCommandWithArgs(command: string): void {
		const self = this;
		this._context.subscriptions.push(vscode.commands.registerCommand(command, (args: any) => {
			self._event.emit(command, args);
		}));
	}

	/**
	 * Disposes the controller
	 */
	dispose(): void {
		this.deactivate();
	}

	/**
	 * Deactivates the extension
	 */
	public async deactivate(): Promise<void> {
		Utils.logDebug('de-activated.');
		await this.onDisconnect();
		this._statusview.dispose();
	}

	/**
	 * Initializes the extension
	 */
	public async activate(): Promise<boolean> {
		// initialize the language client then register the commands
		const didInitialize = await this.initialize();
		if (didInitialize) {
			// register VS Code commands
			this.registerCommand(Constants.cmdConnect);
			this._event.on(Constants.cmdConnect, () => { this.runAndLogErrors(this.onNewConnection()); });
			this.registerCommand(Constants.cmdDisconnect);
			this._event.on(Constants.cmdDisconnect, () => { this.runAndLogErrors(this.onDisconnect()); });
			this.registerCommand(Constants.cmdRunQuery);
			this._event.on(Constants.cmdRunQuery, () => { this.onRunQuery(); });
			this.registerCommand(Constants.cmdManageConnectionProfiles);
			this._event.on(Constants.cmdRunCurrentStatement, () => { this.onRunCurrentStatement(); });
			this.registerCommand(Constants.cmdRunCurrentStatement);
			this._event.on(Constants.cmdManageConnectionProfiles, async () => { await this.onManageProfiles(); });
			this.registerCommand(Constants.cmdChooseDatabase);
			this._event.on(Constants.cmdChooseDatabase, () => { this.runAndLogErrors(this.onChooseDatabase()); });
			this.registerCommand(Constants.cmdChooseLanguageFlavor);
			this._event.on(Constants.cmdChooseLanguageFlavor, () => { this.runAndLogErrors(this.onChooseLanguageFlavor()); });
			this.registerCommand(Constants.cmdCancelQuery);
			this._event.on(Constants.cmdCancelQuery, () => { this.onCancelQuery(); });
			this.registerCommand(Constants.cmdShowGettingStarted);
			this._event.on(Constants.cmdShowGettingStarted, async () => { await this.launchGettingStartedPage(); });
			this.registerCommand(Constants.cmdNewQuery);
			this._event.on(Constants.cmdNewQuery, () => this.runAndLogErrors(this.onNewQuery()));
			this.registerCommand(Constants.cmdRebuildIntelliSenseCache);
			this._event.on(Constants.cmdRebuildIntelliSenseCache, () => { this.onRebuildIntelliSense(); });
			this.registerCommandWithArgs(Constants.cmdLoadCompletionExtension);
			this._event.on(Constants.cmdLoadCompletionExtension, (params: CompletionExtensionParams) => { this.onLoadCompletionExtension(params); });
			this.registerCommand(Constants.cmdToggleSqlCmd);
			this._event.on(Constants.cmdToggleSqlCmd, async () => { await this.onToggleSqlCmd(); });
			this.registerCommand(Constants.cmdAadRemoveAccount);
			this._event.on(Constants.cmdAadRemoveAccount, () => this.removeAadAccount(this._prompter));
			this.registerCommand(Constants.cmdAadAddAccount);
			this._event.on(Constants.cmdAadAddAccount, () => this.addAddAccount());

			this.initializeObjectExplorer();

			this.registerCommandWithArgs(Constants.cmdConnectObjectExplorerProfile);
			this._event.on(Constants.cmdConnectObjectExplorerProfile, (profile: IConnectionProfile) => {
				this._connectionMgr.connectionUI.saveProfile(profile)
					.then(async () => {
						await this.createObjectExplorerSession(profile);
					})
					.catch(err => {
						this._vscodeWrapper.showErrorMessage(err);
					});
			});

			this.registerCommand(Constants.cmdObjectExplorerEnableGroupBySchemaCommand);
			this._event.on(Constants.cmdObjectExplorerEnableGroupBySchemaCommand, () => {
				vscode.workspace.getConfiguration().update(Constants.cmdObjectExplorerGroupBySchemaFlagName, true, true);
			});
			this.registerCommand(Constants.cmdObjectExplorerDisableGroupBySchemaCommand);
			this._event.on(Constants.cmdObjectExplorerDisableGroupBySchemaCommand, () => {
				vscode.workspace.getConfiguration().update(Constants.cmdObjectExplorerGroupBySchemaFlagName, false, true);
			});

			this.initializeQueryHistory();

			this.sqlTasksService = new SqlTasksService(SqlToolsServerClient.instance, this._untitledSqlDocumentService);
			this.dacFxService = new DacFxService(SqlToolsServerClient.instance);
			this.schemaCompareService = new SchemaCompareService(SqlToolsServerClient.instance);
			const azureResourceController = new AzureResourceController();
			this.azureAccountService = new AzureAccountService(this._connectionMgr.azureController, this._connectionMgr.accountStore);
			this.azureResourceService = new AzureResourceService(this._connectionMgr.azureController, azureResourceController, this._connectionMgr.accountStore);

			// Add handlers for VS Code generated commands
			this._vscodeWrapper.onDidCloseTextDocument(async (params) => await this.onDidCloseTextDocument(params));
			this._vscodeWrapper.onDidOpenTextDocument(params => this.onDidOpenTextDocument(params));
			this._vscodeWrapper.onDidSaveTextDocument(params => this.onDidSaveTextDocument(params));
			this._vscodeWrapper.onDidChangeConfiguration(params => this.onDidChangeConfiguration(params));
			return true;
		}
	}

	/**
	 * Helper to script a node based on the script operation
	 */
	public async scriptNode(node: TreeNodeInfo, operation: ScriptOperation, executeScript: boolean = false): Promise<void> {
		const nodeUri = ObjectExplorerUtils.getNodeUri(node);
		let connectionCreds = Object.assign({}, node.connectionInfo);
		const databaseName = ObjectExplorerUtils.getDatabaseName(node);
		// if not connected or different database
		if (!this.connectionManager.isConnected(nodeUri) ||
			connectionCreds.database !== databaseName) {
			// make a new connection
			connectionCreds.database = databaseName;
			if (!this.connectionManager.isConnecting(nodeUri)) {
				const promise = new Deferred<boolean>();
				await this.connectionManager.connect(nodeUri, connectionCreds, promise);
				await promise;
			}
		}
		const selectStatement = await this._scriptingService.script(node, nodeUri, operation);
		const editor = await this._untitledSqlDocumentService.newQuery(selectStatement);
		let uri = editor.document.uri.toString(true);
		let scriptingObject = this._scriptingService.getObjectFromNode(node);
		let title = `${scriptingObject.schema}.${scriptingObject.name}`;
		const queryUriPromise = new Deferred<boolean>();
		await this.connectionManager.connect(uri, connectionCreds, queryUriPromise);
		await queryUriPromise;
		this._statusview.languageFlavorChanged(uri, Constants.mssqlProviderName);
		this._statusview.sqlCmdModeChanged(uri, false);
		if (executeScript) {
			const queryPromise = new Deferred<boolean>();
			await this._outputContentProvider.runQuery(this._statusview, uri, undefined, title, queryPromise);
			await queryPromise;
			await this.connectionManager.connectionStore.removeRecentlyUsed(<IConnectionProfile>connectionCreds);
		}
	}

	/**
	 * Returns a flag indicating if the extension is initialized
	 */
	public isInitialized(): boolean {
		return this._initialized;
	}

	/**
	 * Initializes the extension
	 */
	public async initialize(): Promise<boolean> {
		// initialize language service client
		await SqlToolsServerClient.instance.initialize(this._context);
		// Init status bar
		this._statusview = new StatusView(this._vscodeWrapper);

		// Init CodeAdapter for use when user response to questions is needed
		this._prompter = new CodeAdapter(this._vscodeWrapper);

		// Init content provider for results pane
		this._outputContentProvider = new SqlOutputContentProvider(this._context, this._statusview, this._vscodeWrapper);

		// Init connection manager and connection MRU
		this._connectionMgr = new ConnectionManager(this._context, this._statusview, this._prompter);

		// Shows first time notifications on extension installation or update
		// This call is intentionally not awaited to avoid blocking extension activation
		this.showFirstLaunchPrompts();

		// Handle case where SQL file is the 1st opened document
		const activeTextEditor = this._vscodeWrapper.activeTextEditor;
		if (activeTextEditor && this._vscodeWrapper.isEditingSqlFile) {
			this.onDidOpenTextDocument(activeTextEditor.document);
		}
		await this.sanitizeConnectionProfiles();
		Utils.logDebug('activated.');
		this._initialized = true;
		return true;
	}

	/**
	 * Sanitize the connection profiles in the settings.
	 */
	public async sanitizeConnectionProfiles(): Promise<void> {
		const sanitize = async (connectionProfiles: IConnectionProfile[], target: vscode.ConfigurationTarget) => {
			let profileChanged = false;
			for (const conn of connectionProfiles) {
				// remove azure account token
				if (conn && conn.authenticationType !== 'AzureMFA' && conn.azureAccountToken !== undefined) {
					conn.azureAccountToken = undefined;
					profileChanged = true;
				}
				// remove password
				if (!Utils.isEmpty(conn.password)) {
					// save the password in the credential store if save password is true
					await this.connectionManager.connectionStore.saveProfilePasswordIfNeeded(conn);
					conn.password = '';
					profileChanged = true;
				}
				// Fixup 'Encrypt' property if needed
				let result = ConnInfo.updateEncrypt(conn);
				if (result.updateStatus) {
					await this.connectionManager.connectionStore.saveProfile(result.connection as IConnectionProfile);
				}
			}
			if (profileChanged) {
				await this._vscodeWrapper.setConfiguration(Constants.extensionName, Constants.connectionsArrayName, connectionProfiles, target);
			}
		};
		const profileMapping = new Map<vscode.ConfigurationTarget, IConnectionProfile[]>();
		const configuration = this._vscodeWrapper.getConfiguration(Constants.extensionName, this._vscodeWrapper.activeTextEditorUri);
		const configValue = configuration.inspect<IConnectionProfile[]>(Constants.connectionsArrayName);
		profileMapping.set(vscode.ConfigurationTarget.Global, configValue.globalValue || []);
		profileMapping.set(vscode.ConfigurationTarget.Workspace, configValue.workspaceValue || []);
		profileMapping.set(vscode.ConfigurationTarget.WorkspaceFolder, configValue.workspaceFolderValue || []);
		for (const target of profileMapping.keys()) {
			// sanitize the connections and save them back to their original target.
			await sanitize(profileMapping.get(target), target);
		}
	}

	/**
	 * Creates a new Object Explorer session
	 * @param connectionCredentials Connection credentials to use for the session
	 * @returns True if the session was created successfully, false otherwise
	 */
	private async createObjectExplorerSession(connectionCredentials?: IConnectionInfo): Promise<boolean> {
		let createSessionPromise = new Deferred<TreeNodeInfo>();
		const sessionId = await this._objectExplorerProvider.createSession(createSessionPromise, connectionCredentials, this._context);
		if (sessionId) {
			const newNode = await createSessionPromise;
			if (newNode) {
				this._objectExplorerProvider.refresh(undefined);
				return true;
			}
		}
		return false;
	}

	/**
	 * Initializes the Object Explorer commands
	 */
	private initializeObjectExplorer(): void {
		const self = this;
		// Register the object explorer tree provider
		this._objectExplorerProvider = new ObjectExplorerProvider(this._connectionMgr);
		const treeView = vscode.window.createTreeView('objectExplorer', {
			treeDataProvider: this._objectExplorerProvider,
			canSelectMany: false
		});
		this._context.subscriptions.push(treeView);

		// Sets the correct current node on any node selection
		this._context.subscriptions.push(treeView.onDidChangeSelection((e: vscode.TreeViewSelectionChangeEvent<TreeNodeInfo>) => {
			if (e.selection?.length > 0) {
				self._objectExplorerProvider.currentNode = e.selection[0];
			}
		}));

		// Add Object Explorer Node
		this.registerCommand(Constants.cmdAddObjectExplorer);
		this._event.on(Constants.cmdAddObjectExplorer, async () => {
			if (!self._objectExplorerProvider.objectExplorerExists) {
				self._objectExplorerProvider.objectExplorerExists = true;
			}
			await self.createObjectExplorerSession();
		});

		// Object Explorer New Query
		this._context.subscriptions.push(
			vscode.commands.registerCommand(
				Constants.cmdObjectExplorerNewQuery, async (treeNodeInfo: TreeNodeInfo) => {
					const connectionCredentials = Object.assign({}, treeNodeInfo.connectionInfo);
					const databaseName = ObjectExplorerUtils.getDatabaseName(treeNodeInfo);
					if (databaseName !== connectionCredentials.database &&
						databaseName !== LocalizedConstants.defaultDatabaseLabel) {
						connectionCredentials.database = databaseName;
					} else if (databaseName === LocalizedConstants.defaultDatabaseLabel) {
						connectionCredentials.database = '';
					}
					treeNodeInfo.connectionInfo = connectionCredentials;
					await self.onNewQuery(treeNodeInfo);
				}));

		// Remove Object Explorer Node
		this._context.subscriptions.push(
			vscode.commands.registerCommand(
				Constants.cmdRemoveObjectExplorerNode, async (treeNodeInfo: TreeNodeInfo) => {
					await this._objectExplorerProvider.removeObjectExplorerNode(treeNodeInfo);
					let profile = <IConnectionProfile>treeNodeInfo.connectionInfo;
					await this._connectionMgr.connectionStore.removeProfile(profile, false);
					return this._objectExplorerProvider.refresh(undefined);
				}));

		// Refresh Object Explorer Node
		this._context.subscriptions.push(
			vscode.commands.registerCommand(
				Constants.cmdRefreshObjectExplorerNode, async (treeNodeInfo: TreeNodeInfo) => {
					await this._objectExplorerProvider.refreshNode(treeNodeInfo);
				}));

		// Sign In into Object Explorer Node
		this._context.subscriptions.push(
			vscode.commands.registerCommand(
				Constants.cmdObjectExplorerNodeSignIn, async (node: AccountSignInTreeNode) => {
					let profile = <IConnectionProfile>node.parentNode.connectionInfo;
					profile = await self.connectionManager.connectionUI.promptForRetryCreateProfile(profile);
					if (profile) {
						node.parentNode.connectionInfo = <IConnectionInfo>profile;
						self._objectExplorerProvider.updateNode(node.parentNode);
						self._objectExplorerProvider.signInNodeServer(node.parentNode);
						return self._objectExplorerProvider.refresh(undefined);
					}
				}));

		// Connect to Object Explorer Node
		this._context.subscriptions.push(
			vscode.commands.registerCommand(
				Constants.cmdConnectObjectExplorerNode, async (node: ConnectTreeNode) => {
					await self.createObjectExplorerSession(node.parentNode.connectionInfo);
				}));

		// Disconnect Object Explorer Node
		this._context.subscriptions.push(
			vscode.commands.registerCommand(
				Constants.cmdDisconnectObjectExplorerNode, async (node: TreeNodeInfo) => {
					await this._objectExplorerProvider.removeObjectExplorerNode(node, true);
					return this._objectExplorerProvider.refresh(undefined);
				}));

		// Initiate the scripting service
		this._scriptingService = new ScriptingService(this._connectionMgr);

		// Script as Select
		this._context.subscriptions.push(
			vscode.commands.registerCommand(
				Constants.cmdScriptSelect, async (node: TreeNodeInfo) => {
					await this.scriptNode(node, ScriptOperation.Select, true);
				}));

		// Script as Create
		this._context.subscriptions.push(
			vscode.commands.registerCommand(
				Constants.cmdScriptCreate, async (node: TreeNodeInfo) =>
				await this.scriptNode(node, ScriptOperation.Create)));

		// Script as Drop
		this._context.subscriptions.push(
			vscode.commands.registerCommand(
				Constants.cmdScriptDelete, async (node: TreeNodeInfo) =>
				await this.scriptNode(node, ScriptOperation.Delete)));

		// Script as Execute
		this._context.subscriptions.push(
			vscode.commands.registerCommand(
				Constants.cmdScriptExecute, async (node: TreeNodeInfo) =>
				await this.scriptNode(node, ScriptOperation.Execute)));

		// Script as Alter
		this._context.subscriptions.push(
			vscode.commands.registerCommand(
				Constants.cmdScriptAlter, async (node: TreeNodeInfo) =>
				await this.scriptNode(node, ScriptOperation.Alter)));

		// Copy object name command
		this._context.subscriptions.push(
			vscode.commands.registerCommand(Constants.cmdCopyObjectName, async () => {
				let node = this._objectExplorerProvider.currentNode;
				// Folder node
				if (node.contextValue === Constants.folderLabel) {
					return;
				} else if (node.contextValue === Constants.serverLabel ||
					node.contextValue === Constants.disconnectedServerLabel) {
					const label = typeof node.label === 'string' ? node.label : node.label.label;
					await this._vscodeWrapper.clipboardWriteText(label);
				} else {
					let scriptingObject = this._scriptingService.getObjectFromNode(node);
					const escapedName = Utils.escapeClosingBrackets(scriptingObject.name);
					if (scriptingObject.schema) {
						let database = ObjectExplorerUtils.getDatabaseName(node);
						const databaseName = Utils.escapeClosingBrackets(database);
						const escapedSchema = Utils.escapeClosingBrackets(scriptingObject.schema);
						await this._vscodeWrapper.clipboardWriteText(`[${databaseName}].${escapedSchema}.[${escapedName}]`);
					} else {
						await this._vscodeWrapper.clipboardWriteText(`[${escapedName}]`);
					}
				}
			}));
	}

	/**
	 * Initializes the Query History commands
	 */
	private initializeQueryHistory(): void {

		let config = this._vscodeWrapper.getConfiguration(Constants.extensionConfigSectionName);
		let queryHistoryFeature = config.get(Constants.configEnableQueryHistoryFeature);
		// If the query history feature is enabled
		if (queryHistoryFeature && !this._queryHistoryRegistered) {
			// Register the query history tree provider
			this._queryHistoryProvider = new QueryHistoryProvider(this._connectionMgr, this._outputContentProvider,
				this._vscodeWrapper, this._untitledSqlDocumentService, this._statusview, this._prompter);

			this._context.subscriptions.push(
				vscode.window.registerTreeDataProvider('queryHistory', this._queryHistoryProvider)
			);

			// Command to refresh Query History
			this._context.subscriptions.push(
				vscode.commands.registerCommand(
					Constants.cmdRefreshQueryHistory, (ownerUri: string, hasError: boolean) => {
						config = this._vscodeWrapper.getConfiguration(Constants.extensionConfigSectionName);
						let queryHistoryFeatureEnabled = config.get(Constants.configEnableQueryHistoryFeature);
						let queryHistoryCaptureEnabled = config.get(Constants.configEnableQueryHistoryCapture);
						if (queryHistoryFeatureEnabled && queryHistoryCaptureEnabled) {
							const timeStamp = new Date();
							this._queryHistoryProvider.refresh(ownerUri, timeStamp, hasError);
						}
					}));

			// Command to enable clear all entries in Query History
			this._context.subscriptions.push(
				vscode.commands.registerCommand(
					Constants.cmdClearAllQueryHistory, () => {
						this._queryHistoryProvider.clearAll();
					}));

			// Command to enable delete an entry in Query History
			this._context.subscriptions.push(
				vscode.commands.registerCommand(
					Constants.cmdDeleteQueryHistory, (node: QueryHistoryNode) => {
						this._queryHistoryProvider.deleteQueryHistoryEntry(node);
					}));

			// Command to enable open a query in Query History
			this._context.subscriptions.push(
				vscode.commands.registerCommand(
					Constants.cmdOpenQueryHistory, async (node: QueryHistoryNode) => {
						await this._queryHistoryProvider.openQueryHistoryEntry(node);
					}));

			// Command to enable run a query in Query History
			this._context.subscriptions.push(
				vscode.commands.registerCommand(
					Constants.cmdRunQueryHistory, async (node: QueryHistoryNode) => {
						await this._queryHistoryProvider.openQueryHistoryEntry(node, true);
					}));

			// Command to start the query history capture
			this._context.subscriptions.push(
				vscode.commands.registerCommand(
					Constants.cmdStartQueryHistory, async (node: QueryHistoryNode) => {
						await this._queryHistoryProvider.startQueryHistoryCapture();
					}));

			// Command to pause the query history capture
			this._context.subscriptions.push(
				vscode.commands.registerCommand(
					Constants.cmdPauseQueryHistory, async (node: QueryHistoryNode) => {
						await this._queryHistoryProvider.pauseQueryHistoryCapture();
					}));

			// Command to open the query history experience in the command palette
			this._context.subscriptions.push(
				vscode.commands.registerCommand(
					Constants.cmdCommandPaletteQueryHistory, async () => {
						await this._queryHistoryProvider.showQueryHistoryCommandPalette();
					}));
			this._queryHistoryRegistered = true;
		}
	}

	/**
	 * Handles the command to toggle SQLCMD mode
	 */
	private async onToggleSqlCmd(): Promise<void> {
		let isSqlCmd: boolean;
		const uri = this._vscodeWrapper.activeTextEditorUri;
		const queryRunner = this._outputContentProvider.getQueryRunner(uri);
		// if a query runner exists, use it
		if (queryRunner) {
			isSqlCmd = queryRunner.isSqlCmd;
		} else {
			// otherwise create a new query runner
			isSqlCmd = false;
			const editor = this._vscodeWrapper.activeTextEditor;
			const title = path.basename(editor.document.fileName);
			this._outputContentProvider.createQueryRunner(this._statusview, uri, title);
		}
		await this._outputContentProvider.toggleSqlCmd(this._vscodeWrapper.activeTextEditorUri);
		await this._connectionMgr.onChooseLanguageFlavor(true, !isSqlCmd);
		this._statusview.sqlCmdModeChanged(this._vscodeWrapper.activeTextEditorUri, !isSqlCmd);
	}

	/**
	 * Handles the command to cancel queries
	 */
	private onCancelQuery(): void {
		if (!this.canRunCommand() || !this.validateTextDocumentHasFocus()) {
			return;
		}
		try {
			let uri = this._vscodeWrapper.activeTextEditorUri;
			this._outputContentProvider.cancelQuery(uri);
		} catch (err) {
			console.warn(`Unexpected error cancelling query : ${err}`);
		}
	}

	/**
	 * Choose a new database from the current server
	 */
	private async onChooseDatabase(): Promise<boolean> {
		if (this.canRunCommand() && this.validateTextDocumentHasFocus()) {
			const success = await this._connectionMgr.onChooseDatabase();
			return success;
		}
		return false;
	}

	/**
	 * Choose a language flavor for the SQL document. Should be either "MSSQL" or "Other"
	 * to indicate that intellisense and other services should not be provided
	 */
	private async onChooseLanguageFlavor(): Promise<boolean> {
		if (this.canRunCommand() && this.validateTextDocumentHasFocus()) {
			const fileUri = this._vscodeWrapper.activeTextEditorUri;
			if (fileUri && this._vscodeWrapper.isEditingSqlFile) {
				this._connectionMgr.onChooseLanguageFlavor();
			} else {
				this._vscodeWrapper.showWarningMessage(LocalizedConstants.msgOpenSqlFile);
			}
		}
		return false;
	}

	/**
	 * Close active connection, if any
	 */
	private async onDisconnect(): Promise<boolean> {
		if (this.canRunCommand() && this.validateTextDocumentHasFocus()) {
			let fileUri = this._vscodeWrapper.activeTextEditorUri;
			let queryRunner = this._outputContentProvider.getQueryRunner(fileUri);
			if (queryRunner && queryRunner.isExecutingQuery) {
				this._outputContentProvider.cancelQuery(fileUri);
			}
			const success = await this._connectionMgr.onDisconnect();
			return success;
		}
		return false;
	}

	/**
	 * Manage connection profiles (create, edit, remove).
	 * Public for testing purposes
	 */
	public async onManageProfiles(): Promise<void> {
		if (this.canRunCommand()) {
			await this._connectionMgr.onManageProfiles();
			return;
		}
	}

	/**
	 * Let users pick from a list of connections
	 */
	public async onNewConnection(): Promise<boolean> {
		if (this.canRunCommand() && this.validateTextDocumentHasFocus()) {
			let credentials = await this._connectionMgr.onNewConnection();
			if (credentials) {
				await this.createObjectExplorerSession(credentials);
				return true;
			}
		}
		return false;
	}

	/**
	 * Makes a connection and save if saveConnection is set to true
	 * @param uri The URI of the connection to list the databases for.
	 * @param connectionInfo The connection info
	 * @param connectionPromise connection promise object
	 * @param saveConnection saves the connection profile if sets to true
	 * @returns if saveConnection is set to true, returns true for successful connection and saving the profile
	 * otherwise returns true for successful connection
	 *
	 */
	public async connect(uri: string, connectionInfo: IConnectionInfo, connectionPromise: Deferred<boolean>, saveConnection?: boolean): Promise<boolean> {
		if (this.canRunCommand() && uri && connectionInfo) {
			const connectedSuccessfully = await this._connectionMgr.connect(uri, connectionInfo, connectionPromise);
			if (connectedSuccessfully) {
				if (saveConnection) {
					await this.createObjectExplorerSession(connectionInfo);
				}
				return true;
			}
		}
		return false;
	}

	/**
	 * Clear and rebuild the IntelliSense cache
	 */
	public onRebuildIntelliSense(): void {
		if (this.canRunCommand() && this.validateTextDocumentHasFocus()) {
			const fileUri = this._vscodeWrapper.activeTextEditorUri;
			if (fileUri && this._vscodeWrapper.isEditingSqlFile) {
				this._statusview.languageServiceStatusChanged(fileUri, LocalizedConstants.updatingIntelliSenseStatus);
				SqlToolsServerClient.instance.sendNotification(RebuildIntelliSenseNotification.type, {
					ownerUri: fileUri
				});
			} else {
				this._vscodeWrapper.showWarningMessage(LocalizedConstants.msgOpenSqlFile);
			}
		}
	}

	/**
	 * Send completion extension load request to language service
	 */
	public onLoadCompletionExtension(params: CompletionExtensionParams): void {
		SqlToolsServerClient.instance.sendRequest(CompletionExtLoadRequest.type, params);
	}

	/**
	 * execute the SQL statement for the current cursor position
	 */
	public async onRunCurrentStatement(callbackThis?: MainController): Promise<void> {
		// the 'this' context is lost in retry callback, so capture it here
		let self: MainController = callbackThis ? callbackThis : this;
		try {
			if (!self.canRunCommand()) {
				return;
			}
			if (!self.canRunV2Command()) {
				// Notify the user that this is not supported on this version
				await this._vscodeWrapper.showErrorMessage(LocalizedConstants.macSierraRequiredErrorMessage);
				return;
			}
			if (!self.validateTextDocumentHasFocus()) {
				return;
			}

			// check if we're connected and editing a SQL file
			if (await self.isRetryRequiredBeforeQuery(self.onRunCurrentStatement)) {
				return;
			}

			let editor = self._vscodeWrapper.activeTextEditor;
			let uri = self._vscodeWrapper.activeTextEditorUri;
			let title = path.basename(editor.document.fileName);

			// return early if the document does contain any text
			if (editor.document.getText(undefined).trim().length === 0) {
				return;
			}

			// only the start line and column are used to determine the current statement
			let querySelection: ISelectionData = {
				startLine: editor.selection.start.line,
				startColumn: editor.selection.start.character,
				endLine: 0,
				endColumn: 0
			};

			await self._outputContentProvider.runCurrentStatement(self._statusview, uri, querySelection, title);
		} catch (err) {
			console.warn(`Unexpected error running current statement : ${err}`);
		}
	}

	/**
	 * get the T-SQL query from the editor, run it and show output
	 */
	public async onRunQuery(callbackThis?: MainController): Promise<void> {
		// the 'this' context is lost in retry callback, so capture it here
		let self: MainController = callbackThis ? callbackThis : this;
		try {
			if (!self.canRunCommand() || !self.validateTextDocumentHasFocus()) {
				return;
			}

			// check if we're connected and editing a SQL file
			if (await self.isRetryRequiredBeforeQuery(self.onRunQuery)) {
				return;
			}

			let editor = self._vscodeWrapper.activeTextEditor;
			let uri = self._vscodeWrapper.activeTextEditorUri;

			// Do not execute when there are multiple selections in the editor until it can be properly handled.
			// Otherwise only the first selection will be executed and cause unexpected issues.
			if (editor.selections?.length > 1) {
				self._vscodeWrapper.showErrorMessage(LocalizedConstants.msgMultipleSelectionModeNotSupported);
				return;
			}

			// create new connection
			if (!self.connectionManager.isConnected(uri)) {
				await self.onNewConnection();
			}
			// check if current connection is still valid / active - if not, refresh azure account token
			await self._connectionMgr.refreshAzureAccountToken(uri);

			let title = path.basename(editor.document.fileName);
			let querySelection: ISelectionData;
			// Calculate the selection if we have a selection, otherwise we'll treat null as
			// the entire document's selection
			if (!editor.selection.isEmpty) {
				let selection = editor.selection;
				querySelection = {
					startLine: selection.start.line,
					startColumn: selection.start.character,
					endLine: selection.end.line,
					endColumn: selection.end.character
				};
			}

			// Trim down the selection. If it is empty after selecting, then we don't execute
			let selectionToTrim = editor.selection.isEmpty ? undefined : editor.selection;
			if (editor.document.getText(selectionToTrim).trim().length === 0) {
				return;
			}
			await self._outputContentProvider.runQuery(self._statusview, uri, querySelection, title);
		} catch (err) {
			console.warn(`Unexpected error running query : ${err}`);
		}
	}

	/**
	 * Check if the state is ready to execute a query and retry
	 * the query execution method if needed
	 */
	public async isRetryRequiredBeforeQuery(retryMethod: any): Promise<boolean> {
		let self = this;
		let result: boolean = undefined;
		try {
			if (!self._vscodeWrapper.isEditingSqlFile) {
				// Prompt the user to change the language mode to SQL before running a query
				result = await self._connectionMgr.connectionUI.promptToChangeLanguageMode();
			} else if (!self._connectionMgr.isConnected(self._vscodeWrapper.activeTextEditorUri)) {
				result = await self.onNewConnection();
			}
			if (result) {
				await retryMethod(self);
				return true;
			} else {
				// we don't need to do anything to configure environment before running query
				return false;
			}
		} catch (err) {
			await self._vscodeWrapper.showErrorMessage(LocalizedConstants.msgError + err);
		}
	}

	/**
	 * Executes a callback and logs any errors raised
	 */
	private runAndLogErrors<T>(promise: Promise<T>): Promise<T> {
		let self = this;
		return promise.catch(err => {
			self._vscodeWrapper.showErrorMessage(LocalizedConstants.msgError + err);
			return undefined;
		});
	}

	/**
	 * Access the connection manager for testing
	 */
	public get connectionManager(): ConnectionManager {
		return this._connectionMgr;
	}

	public set connectionManager(connectionManager: ConnectionManager) {
		this._connectionMgr = connectionManager;
	}

	public set untitledSqlDocumentService(untitledSqlDocumentService: UntitledSqlDocumentService) {
		this._untitledSqlDocumentService = untitledSqlDocumentService;
	}


	/**
	 * Verifies the extension is initilized and if not shows an error message
	 */
	private canRunCommand(): boolean {
		if (this._connectionMgr === undefined) {
			Utils.showErrorMsg(LocalizedConstants.extensionNotInitializedError);
			return false;
		}
		return true;
	}

	/**
	 * Return whether or not some text document currently has focus, and display an error message if not
	 */
	private validateTextDocumentHasFocus(): boolean {
		if (this._vscodeWrapper.activeTextEditorUri === undefined) {
			Utils.showErrorMsg(LocalizedConstants.noActiveEditorMsg);
			return false;
		}
		return true;
	}

	/**
	 * Verifies the tools service version is high enough to support certain commands
	 */
	private canRunV2Command(): boolean {
		let version: number = SqlToolsServerClient.instance.getServiceVersion();
		return version > 1;
	}

	/**
	 * Prompts the user to view release notes and blog post for changes made to the encryption connection property, if this is a new extension install
	 */
	private async showFirstLaunchPrompts(): Promise<void> {
		let self = this;
		if (!this.doesExtensionLaunchedFileExist()) {
			// ask the user to view release notes document
			let confirmText = LocalizedConstants.viewMore;
			let promiseReleaseNotes = this._vscodeWrapper.showInformationMessage(
				LocalizedConstants.releaseNotesPromptDescription, confirmText)
				.then(async (result) => {
					if (result === confirmText) {
						await self.launchReleaseNotesPage();
					}
				});


			// ask the user to view encryption changes document
			let confirmTextEncrypt = LocalizedConstants.moreInformation;
			let promiseEncryption = this._vscodeWrapper.showInformationMessage(
				LocalizedConstants.encryptionChangePromptDescription, confirmTextEncrypt)
				.then(async (result) => {
					if (result === confirmTextEncrypt) {
						await self.launchEncryptionBlogPage();
					}
				});

			await Promise.all([promiseReleaseNotes, promiseEncryption]);
		}
	}

	/**
	 * Shows the release notes page in the preview browser
	 */
	private async launchReleaseNotesPage(): Promise<void> {
		await vscode.env.openExternal(vscode.Uri.parse(Constants.changelogLink));
	}

	/**
	 * Shows the release notes page in the preview browser
	 */
	private async launchEncryptionBlogPage(): Promise<void> {
		await vscode.env.openExternal(vscode.Uri.parse(Constants.encryptionBlogLink));
	}

	/**
	 * Shows the Getting Started page in the preview browser
	 */
	private async launchGettingStartedPage(): Promise<void> {
		await vscode.env.openExternal(vscode.Uri.parse(Constants.gettingStartedGuideLink));
	}

	/**
	 * Opens a new query and creates new connection
	 */
	public async onNewQuery(node?: TreeNodeInfo, content?: string): Promise<boolean> {
		if (this.canRunCommand()) {
			// from the object explorer context menu
			const editor = await this._untitledSqlDocumentService.newQuery(content);
			const uri = editor.document.uri.toString(true);
			if (node) {
				// connect to the node if the command came from the context
				const connectionCreds = node.connectionInfo;
				// if the node isn't connected
				if (!node.sessionId) {
					// connect it first
					await this.createObjectExplorerSession(node.connectionInfo);
				}
				this._statusview.languageFlavorChanged(uri, Constants.mssqlProviderName);
				// connection string based credential
				if (connectionCreds.connectionString) {
					if ((connectionCreds as IConnectionProfile).savePassword) {
						// look up connection string
						let connectionString = await this._connectionMgr.connectionStore.lookupPassword(connectionCreds, true);
						connectionCreds.connectionString = connectionString;
					}
				}
				await this.connectionManager.connect(uri, connectionCreds);
				this._statusview.sqlCmdModeChanged(uri, false);
				await this.connectionManager.connectionStore.removeRecentlyUsed(<IConnectionProfile>connectionCreds);
				return true;
			} else {
				// new query command
				const credentials = await this._connectionMgr.onNewConnection();

				// initiate a new OE with same connection
				if (credentials) {
					await this.createObjectExplorerSession(credentials);
				}
				this._statusview.sqlCmdModeChanged(uri, false);
				return true;
			}
		}
		return false;
	}

	/**
	 * Check if the extension launched file exists.
	 * This is to detect when we are running in a clean install scenario.
	 */
	private doesExtensionLaunchedFileExist(): boolean {
		// check if file already exists on disk
		let filePath = this._context.asAbsolutePath('extensionlaunched.dat');
		try {
			// this will throw if the file does not exist
			fs.statSync(filePath);
			return true;
		} catch (err) {
			try {
				// write out the "first launch" file if it doesn't exist
				fs.writeFile(filePath, 'launched', (err) => {
					return;
				});
			} catch (err) {
				// ignore errors writing first launch file since there isn't really
				// anything we can do to recover in this situation.
			}
			return false;
		}
	}

	/**
	 * Called by VS Code when a text document closes. This will dispatch calls to other
	 * controllers as needed. Determines if this was a normal closed file, a untitled closed file,
	 * or a renamed file
	 * @param doc The document that was closed
	 */
	public async onDidCloseTextDocument(doc: vscode.TextDocument): Promise<void> {
		if (this._connectionMgr === undefined) {
			// Avoid processing events before initialization is complete
			return;
		}
		let closedDocumentUri: string = doc.uri.toString(true);
		let closedDocumentUriScheme: string = doc.uri.scheme;

		// Stop timers if they have been started
		if (this._lastSavedTimer) {
			this._lastSavedTimer.end();
		}

		if (this._lastOpenedTimer) {
			this._lastOpenedTimer.end();
		}

		// Determine which event caused this close event

		// If there was a saveTextDoc event just before this closeTextDoc event and it
		// was untitled then we know it was an untitled save
		if (this._lastSavedUri &&
			closedDocumentUriScheme === LocalizedConstants.untitledScheme &&
			this._lastSavedTimer.getDuration() < Constants.untitledSaveTimeThreshold) {
			// Untitled file was saved and connection will be transfered
			await this._connectionMgr.transferFileConnection(closedDocumentUri, this._lastSavedUri);

			// If there was an openTextDoc event just before this closeTextDoc event then we know it was a rename
		} else if (this._lastOpenedUri &&
			this._lastOpenedTimer.getDuration() < Constants.renamedOpenTimeThreshold) {
			// File was renamed and connection will be transfered
			await this._connectionMgr.transferFileConnection(closedDocumentUri, this._lastOpenedUri);

		} else {
			// Pass along the close event to the other handlers for a normal closed file
			await this._connectionMgr.onDidCloseTextDocument(doc);
			this._outputContentProvider.onDidCloseTextDocument(doc);
		}

		// Reset special case timers and events
		this._lastSavedUri = undefined;
		this._lastSavedTimer = undefined;
		this._lastOpenedTimer = undefined;
		this._lastOpenedUri = undefined;

		// Remove diagnostics for the related file
		let diagnostics = SqlToolsServerClient.instance.diagnosticCollection;
		if (diagnostics.has(doc.uri)) {
			diagnostics.delete(doc.uri);
		}
	}

	/**
	 * Called by VS Code when a text document is opened. Checks if a SQL file was opened
	 * to enable features of our extension for the document.
	 */
	public onDidOpenTextDocument(doc: vscode.TextDocument): void {
		if (this._connectionMgr === undefined) {
			// Avoid processing events before initialization is complete
			return;
		}
		this._connectionMgr.onDidOpenTextDocument(doc);

		if (doc && doc.languageId === Constants.languageId) {
			// set encoding to false
			this._statusview.languageFlavorChanged(doc.uri.toString(true), Constants.mssqlProviderName);
		}

		// Setup properties incase of rename
		this._lastOpenedTimer = new Utils.Timer();
		this._lastOpenedTimer.start();
		if (doc && doc.uri) {
			this._lastOpenedUri = doc.uri.toString(true);
		}
	}

	/**
	 * Called by VS Code when a text document is saved. Will trigger a timer to
	 * help determine if the file was a file saved from an untitled file.
	 * @param doc The document that was saved
	 */
	public onDidSaveTextDocument(doc: vscode.TextDocument): void {
		if (this._connectionMgr === undefined) {
			// Avoid processing events before initialization is complete
			return;
		}

		// Set encoding to false by giving true as argument
		let savedDocumentUri: string = doc.uri.toString(true);

		// Keep track of which file was last saved and when for detecting the case when we save an untitled document to disk
		this._lastSavedTimer = new Utils.Timer();
		this._lastSavedTimer.start();
		this._lastSavedUri = savedDocumentUri;
	}

	private onChangeQueryHistoryConfig(): void {
		let queryHistoryFeatureEnabled = this._vscodeWrapper.getConfiguration(Constants.extensionConfigSectionName)
			.get(Constants.configEnableQueryHistoryFeature);
		if (queryHistoryFeatureEnabled) {
			this.initializeQueryHistory();
		}
	}

	/**
	 * Called by VS Code when user settings are changed
	 * @param ConfigurationChangeEvent event that is fired when config is changed
	 */
	public async onDidChangeConfiguration(e: vscode.ConfigurationChangeEvent): Promise<void> {
		if (e.affectsConfiguration(Constants.extensionName)) {
			// Query History settings change
			this.onChangeQueryHistoryConfig();

			// Connections change
			let needsRefresh = false;
			// user connections is a super set of object explorer connections
			// read the connections from glocal settings and workspace settings.
			let userConnections: any[] = this.connectionManager.connectionStore.connectionConfig.getConnections(true);
			let objectExplorerConnections = this._objectExplorerProvider.rootNodeConnections;

			// if a connection(s) was/were manually removed
			let staleConnections = objectExplorerConnections.filter((oeConn) => {
				return !userConnections.some((userConn) => Utils.isSameConnection(oeConn, userConn));
			});
			// disconnect that/those connection(s) and then
			// remove its/their credentials from the credential store
			// and MRU
			for (let conn of staleConnections) {
				let profile = <IConnectionProfile>conn;
				if (this.connectionManager.isActiveConnection(conn)) {
					const uri = this.connectionManager.getUriForConnection(conn);
					await this.connectionManager.disconnect(uri);
				}
				await this.connectionManager.connectionStore.removeRecentlyUsed(profile);
				if (profile.authenticationType === Constants.sqlAuthentication &&
					profile.savePassword) {
					await this.connectionManager.deleteCredential(profile);
				}
			}
			// remove them from object explorer
			await this._objectExplorerProvider.removeConnectionNodes(staleConnections);
			needsRefresh = staleConnections.length > 0;

			// if a connection(s) was/were manually added
			let newConnections = userConnections.filter((userConn) => {
				return !objectExplorerConnections.some((oeConn) => Utils.isSameConnection(userConn, oeConn));
			});
			for (let conn of newConnections) {
				// if a connection is not connected
				// that means it was added manually
				const newConnectionProfile = <IConnectionProfile>conn;
				const uri = ObjectExplorerUtils.getNodeUriFromProfile(newConnectionProfile);
				if (!this.connectionManager.isActiveConnection(conn) &&
					!this.connectionManager.isConnecting(uri)) {
					// add a disconnected node for the connection
					this._objectExplorerProvider.addDisconnectedNode(conn);
					needsRefresh = true;
				}
			}

			await this.sanitizeConnectionProfiles();

			if (e.affectsConfiguration(Constants.cmdObjectExplorerGroupBySchemaFlagName)) {
				let errorFoundWhileRefreshing = false;
				(await this._objectExplorerProvider.getChildren()).forEach((n: TreeNodeInfo) => {
					try {
						this._objectExplorerProvider.refreshNode(n);
					} catch (e) {
						errorFoundWhileRefreshing = true;
						this._connectionMgr.client.logger.error(e);
					}
				});
				if (errorFoundWhileRefreshing) {
					Utils.showErrorMsg(LocalizedConstants.objectExplorerNodeRefreshError);
				}
			}

			if (needsRefresh) {
				this._objectExplorerProvider.refresh(undefined);
			}
			if (e.affectsConfiguration(Constants.mssqlPiiLogging)) {
				this.updatePiiLoggingLevel();
			}

			// Prompt to reload VS Code when below settings are updated.
			if (e.affectsConfiguration(Constants.azureAuthLibrary)
				|| e.affectsConfiguration(Constants.enableSqlAuthenticationProvider)) {
				await this.displayReloadMessage();
			}
		}
	}

	/**
	 * Updates Pii Logging configuration for Logger.
	 */
	private updatePiiLoggingLevel(): void {
		const piiLogging: boolean = vscode.workspace.getConfiguration(Constants.extensionName).get(Constants.piiLogging, false);
		SqlToolsServerClient.instance.logger.piiLogging = piiLogging;
	}

	/**
	 * Display notification with button to reload
	 * return true if button clicked
	 * return false if button not clicked
	 */
	private async displayReloadMessage(): Promise<boolean> {
		const result = await vscode.window.showInformationMessage(LocalizedConstants.reloadPrompt, LocalizedConstants.reloadChoice);
		if (result === LocalizedConstants.reloadChoice) {
			await vscode.commands.executeCommand('workbench.action.reloadWindow');
			return true;
		} else {
			return false;
		}
	}

	public removeAadAccount(prompter: IPrompter): void {
		this.connectionManager.removeAccount(prompter);
	}

	public addAddAccount(): void {
		this.connectionManager.addAccount();
	}
}
