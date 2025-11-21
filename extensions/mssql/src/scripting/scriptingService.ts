/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import SqlToolsServiceClient from "../languageservice/serviceclient";
import ConnectionManager from "../controllers/connectionManager";
import {
  ScriptingRequest,
  IScriptingParams,
  IScriptOptions,
  ScriptingProgressNotification,
  ScriptOperation,
  ScriptingCompleteNotification,
  ScriptingCancelRequest,
} from "../models/contracts/scripting/scriptingRequest";
import { TreeNodeInfo } from "../objectExplorer/nodes/treeNodeInfo";
import * as vscode from "vscode";
import { IScriptingObject, IServerInfo } from "vscode-mssql";
import SqlDocumentService, {
  ConnectionStrategy,
} from "../controllers/sqlDocumentService";
import { ObjectExplorerUtils } from "../objectExplorer/objectExplorerUtils";
import {
  ActivityStatus,
  TelemetryActions,
  TelemetryViews,
} from "../sharedInterfaces/telemetry";
import { startActivity } from "../telemetry/telemetry";
import * as LocalizedConstants from "../constants/locConstants";
import * as Constants from "../constants/constants";
import { getErrorMessage, getUriKey } from "../utils/utils";
import { Deferred } from "../protocol";
import { SqlOutputContentProvider } from "../models/sqlOutputContentProvider";
import { IConnectionProfile } from "../models/interfaces";
import StatusView from "../views/statusView";
import { Logger } from "../models/logger";
import VscodeWrapper from "../controllers/vscodeWrapper";
import { UserSurvey } from "../nps/userSurvey";

export const SCRIPT_OPERATION_CANCELED_ERROR =
  "Scripting operation cancelled by user.";

export class ScriptingService {
  private _client: SqlToolsServiceClient;
  private _onGoingScriptingOperations: Map<
    string, // Key is operationId returned from STS for each scripting request
    Deferred<{
      script: string;
      errorMessage: string;
      errorDetails: string;
    }>
  > = new Map();
  private _logger: Logger;

  constructor(
    private _context: vscode.ExtensionContext,
    private _vscodeWrapper: VscodeWrapper,
    private _connectionManager: ConnectionManager,
    private _sqlDocumentService: SqlDocumentService,
    private _sqlOutputContentProvider: SqlOutputContentProvider,
    private _statusview: StatusView,
    private _objectExplorerTree: vscode.TreeView<TreeNodeInfo>,
  ) {
    this._client = this._connectionManager.client;
    this._logger = Logger.create(
      this._vscodeWrapper.outputChannel,
      "ObjectExplorerService",
    );

    this.initialize();
  }

  private initialize() {
    const pushDisposable = (disposable: vscode.Disposable): void => {
      if (this._context?.subscriptions) {
        this._context.subscriptions.push(disposable);
      }
    };

    // Script as Select
    pushDisposable(
      vscode.commands.registerCommand(
        Constants.cmdScriptSelect,
        async (node: TreeNodeInfo) => {
          await this.runScriptingCommand(ScriptOperation.Select, node);
        },
      ),
    );

    // Script as Create
    pushDisposable(
      vscode.commands.registerCommand(
        Constants.cmdScriptCreate,
        async (node: TreeNodeInfo) => {
          await this.runScriptingCommand(ScriptOperation.Create, node);
        },
      ),
    );

    // Script as Drop
    pushDisposable(
      vscode.commands.registerCommand(
        Constants.cmdScriptDelete,
        async (node: TreeNodeInfo) => {
          await this.runScriptingCommand(ScriptOperation.Delete, node);
        },
      ),
    );

    // Script as Execute
    pushDisposable(
      vscode.commands.registerCommand(
        Constants.cmdScriptExecute,
        async (node: TreeNodeInfo) => {
          await this.runScriptingCommand(ScriptOperation.Execute, node);
        },
      ),
    );

    // Script as Alter
    pushDisposable(
      vscode.commands.registerCommand(
        Constants.cmdScriptAlter,
        async (node: TreeNodeInfo) => {
          await this.runScriptingCommand(ScriptOperation.Alter, node);
        },
      ),
    );

    // Handle scripting progress notifications
    this._client.onNotification(
      ScriptingProgressNotification.type,
      (params) => {
        if (!params.errorMessage) {
          // Ignore progress updates without errors
          return;
        }
        const defferedOperation = this._onGoingScriptingOperations.get(
          params.operationId,
        );
        if (!defferedOperation) {
          return;
        }
        this._onGoingScriptingOperations.delete(params.operationId);

        /**
         * Sometimes a progress notification reports an error, but the final completion
         * event still returns an empty or partial script without any error.
         * To ensure correctness, we treat any progress error as fatal and stop the operation,
         * since it's better to show an error than an invalid script.
         */
        defferedOperation.resolve({
          script: undefined,
          errorMessage: params.errorMessage,
          errorDetails: params.errorDetails,
        });
      },
    );

    // Handle scripting complete notifications
    this._client.onNotification(
      ScriptingCompleteNotification.type,
      (params) => {
        const defferedOperation = this._onGoingScriptingOperations.get(
          params.operationId,
        );
        if (!defferedOperation) {
          return;
        }
        this._onGoingScriptingOperations.delete(params.operationId);

        defferedOperation.resolve({
          script: params.script,
          errorMessage: params.errorMessage,
          errorDetails: params.errorDetails,
        });
      },
    );
  }

  /**
   * Helper to get and validate a node for scripting operations
   */
  private getNodeForScripting(
    node: TreeNodeInfo | undefined,
  ): TreeNodeInfo | undefined {
    // Get the node from the tree selection if not passed as parameter
    if (!node) {
      const selection = this._objectExplorerTree.selection;
      if (!selection || selection.length === 0) {
        vscode.window.showInformationMessage(
          LocalizedConstants.msgSelectNodeToScript,
        );
        return undefined;
      }
      if (selection.length > 1) {
        vscode.window.showInformationMessage(
          LocalizedConstants.msgSelectSingleNodeToScript,
        );
        return undefined;
      }
      node = selection[0];
    }
    return node;
  }

  /**
   * Helper to run the scripting command
   * @param operation Type of scripting operation
   * @param node Optional node to script. If not provided, will use the selected node in the Object Explorer
   * @returns void
   */
  private async runScriptingCommand(
    operation: ScriptOperation,
    node?: TreeNodeInfo,
  ) {
    node = this.getNodeForScripting(node);
    if (!node) {
      return;
    }
    await this.scriptNode(node, operation);
  }

  /**
   * Helper to script a node based on the script operation
   */
  public async scriptNode(
    node: TreeNodeInfo,
    operation: ScriptOperation,
  ): Promise<void> {
    const scriptTelemetryActivity = startActivity(
      TelemetryViews.ObjectExplorer,
      TelemetryActions.ScriptNode,
      undefined,
      {
        operation: this.stringifyScriptOperation(operation),
        nodeType: node.nodeType,
        subType: node.nodeSubType,
      },
    );

    try {
      const nodeUri = ObjectExplorerUtils.getNodeUri(node);
      let connectionCreds = node.connectionProfile;
      const databaseName = ObjectExplorerUtils.getDatabaseName(node);
      if (
        !this._connectionManager.isConnected(nodeUri) ||
        connectionCreds.database !== databaseName
      ) {
        connectionCreds.database = databaseName;
        if (!this._connectionManager.isConnecting(nodeUri)) {
          const isConnected = await this._connectionManager.connect(
            nodeUri,
            connectionCreds,
            {
              connectionSource: "scriptNode",
            },
          );
          if (isConnected) {
            node.updateEntraTokenInfo(connectionCreds); // may be updated Entra token after connect() call
          } else {
            /**
             * The connection wasn't successful. Stopping scripting operation.
             * Not throwing an error because the user is already notified of
             * the connection failure in the connection manager.
             */
            throw new Error("Connection failed");
          }
        }
      }

      // Get scripting object first to validate it exists
      let scriptingObject = this.getScriptingObjectFromNode(node);
      if (!scriptingObject) {
        throw new Error(
          LocalizedConstants.msgScriptingObjectNotFound(
            node.nodeType,
            node.label as string,
          ),
        );
      }

      let generatedScript = await this.scriptTreeNode(node, nodeUri, operation);
      if (!generatedScript) {
        throw new Error(LocalizedConstants.msgScriptingFailed);
      }

      let title = `${scriptingObject.schema}.${scriptingObject.name}`;
      const editor = await this._sqlDocumentService.newQuery({
        content: generatedScript,
        connectionStrategy: ConnectionStrategy.CopyConnectionFromInfo,
        connectionInfo: connectionCreds,
      });

      if (!editor) {
        throw new Error(LocalizedConstants.msgScriptingEditorFailed);
      }

      node.updateEntraTokenInfo(connectionCreds); // newQuery calls connect() internally, so may be updated Entra token

      if (
        operation === ScriptOperation.Select &&
        (await this.shouldAutoExecuteScript())
      ) {
        const uri = getUriKey(editor.document.uri);
        const queryPromise = new Deferred<boolean>();
        await this._sqlOutputContentProvider.runQuery(
          this._statusview,
          uri,
          undefined,
          title,
          undefined,
          queryPromise,
        );
        await queryPromise;
        await this._connectionManager.connectionStore.removeRecentlyUsed(
          <IConnectionProfile>connectionCreds,
        );
      }

      scriptTelemetryActivity.end(ActivityStatus.Succeeded);
    } catch (error) {
      this._logger.error("Scripting failed: ", getErrorMessage(error));
      scriptTelemetryActivity.endFailed(
        error,
        false /* do not include error message */,
      );
    }

    UserSurvey.getInstance()?.promptUserForNPSFeedback("scriptAs");
  }

  public static getScriptCompatibility(
    serverMajorVersion: number,
    serverMinorVersion: number,
  ) {
    switch (serverMajorVersion) {
      case 8:
        return "Script80Compat";
      case 9:
        return "Script90Compat";
      case 10:
        if (serverMinorVersion === 50) {
          return "Script105Compat";
        }
        return "Script100Compat";
      case 11:
        return "Script110Compat";
      case 12:
        return "Script120Compat";
      case 13:
        return "Script130Compat";
      case 14:
        return "Script140Compat";
      case 15:
        return "Script150Compat";
      case 16:
        return "Script160Compat";
      case 17:
        return "Script170Compat";
      default:
        return "Script140Compat";
    }
  }

  // map for the target database engine edition (default is Enterprise)
  readonly targetDatabaseEngineEditionMap = {
    0: "SqlServerEnterpriseEdition",
    1: "SqlServerPersonalEdition",
    2: "SqlServerStandardEdition",
    3: "SqlServerEnterpriseEdition",
    4: "SqlServerExpressEdition",
    5: "SqlAzureDatabaseEdition",
    6: "SqlDatawarehouseEdition",
    7: "SqlServerStretchEdition",
    8: "SqlManagedInstanceEdition",
    9: "SqlDatabaseEdgeEdition",
    11: "SqlOnDemandEdition",
  };

  /**
   * Helper to get scripting object from a tree node
   * @param node Tree node
   * @returns Scripting object or undefined if not found
   */
  private getScriptingObjectFromNode(
    node: TreeNodeInfo,
  ): IScriptingObject | undefined {
    let metadata = node.metadata;
    if (!metadata) {
      return undefined;
    }
    let scriptingObject: IScriptingObject = {
      type: metadata.metadataTypeName,
      schema: metadata.schema,
      name: metadata.name,
      parentName: metadata.parentName,
      parentTypeName: metadata.parentTypeName,
    };
    return scriptingObject;
  }

  /**
   * Helper to create scripting params
   * @param serverInfo Server info
   * @param scriptingObject Object to script
   * @param uri Owner URI
   * @param operation Scripting operation
   * @returns Scripting params
   */
  public createScriptingRequestParams(
    serverInfo: IServerInfo,
    scriptingObject: IScriptingObject,
    uri: string,
    operation: ScriptOperation,
  ): IScriptingParams {
    let scriptCreateDropOption: string;
    switch (operation) {
      case ScriptOperation.Select:
        scriptCreateDropOption = "ScriptSelect";
        break;
      case ScriptOperation.Delete:
        scriptCreateDropOption = "ScriptDrop";
        break;
      case ScriptOperation.Create:
        scriptCreateDropOption = "ScriptCreate";
      default:
        scriptCreateDropOption = "ScriptCreate";
    }
    let scriptOptions: IScriptOptions = {
      scriptCreateDrop: scriptCreateDropOption,
      typeOfDataToScript: "SchemaOnly",
      scriptStatistics: "ScriptStatsNone",
      targetDatabaseEngineEdition:
        serverInfo && serverInfo.engineEditionId
          ? this.targetDatabaseEngineEditionMap[serverInfo.engineEditionId]
          : "SqlServerEnterpriseEdition",
      targetDatabaseEngineType:
        serverInfo && serverInfo.isCloud ? "SqlAzure" : "SingleInstance",
      scriptCompatibilityOption: ScriptingService.getScriptCompatibility(
        serverInfo?.serverMajorVersion,
        serverInfo?.serverMinorVersion,
      ),
    };
    let scriptingParams: IScriptingParams = {
      filePath: undefined,
      scriptDestination: "ToEditor",
      connectionString: undefined,
      scriptingObjects: [scriptingObject],
      includeObjectCriteria: undefined,
      excludeObjectCriteria: undefined,
      includeSchemas: undefined,
      excludeSchemas: undefined,
      includeTypes: undefined,
      excludeTypes: undefined,
      scriptOptions: scriptOptions,
      connectionDetails: undefined,
      ownerURI: uri,
      selectScript: undefined,
      operation: operation,
      returnScriptAsynchronously: true,
    };
    return scriptingParams;
  }

  /**
   * Helper to create scripting params from a tree node
   * @param node Node to create scripting params from
   * @param uri Owner URI
   * @param operation Scripting operation
   * @returns Scripting params
   */
  private createScriptingRequestParamsFromTreeNode(
    node: TreeNodeInfo,
    uri: string,
    operation: ScriptOperation,
  ): IScriptingParams {
    const serverInfo = this._connectionManager.getServerInfo(
      node.connectionProfile,
    );
    const scriptingObject = this.getScriptingObjectFromNode(node);
    return this.createScriptingRequestParams(
      serverInfo,
      scriptingObject,
      uri,
      operation,
    );
  }

  /**
   * Helper to script a tree node
   * @param node Node to script
   * @param uri Owner URI
   * @param operation Scripting operation
   * @returns Generated script as string
   */
  private async scriptTreeNode(
    node: TreeNodeInfo,
    uri: string,
    operation: ScriptOperation,
  ): Promise<string> {
    const scriptingParams = this.createScriptingRequestParamsFromTreeNode(
      node,
      uri,
      operation,
    );
    return this.script(scriptingParams);
  }

  /**
   * Helper to determine whether to auto execute script based on user settings
   * @returns boolean indicating whether to auto execute script
   */
  private async shouldAutoExecuteScript(): Promise<boolean> {
    const preventAutoExecute = vscode.workspace
      .getConfiguration()
      .get<boolean>(Constants.configPreventAutoExecuteScript);
    return !preventAutoExecute;
  }

  private stringifyScriptOperation(operation: ScriptOperation): string {
    switch (operation) {
      case ScriptOperation.Select:
        return "Select";
      case ScriptOperation.Create:
        return "Create";
      case ScriptOperation.Insert:
        return "Insert";
      case ScriptOperation.Update:
        return "Update";
      case ScriptOperation.Delete:
        return "Delete";
      case ScriptOperation.Execute:
        return "Execute";
      case ScriptOperation.Alter:
        return "Alter";
      default:
        return "Unknown";
    }
  }

  public async script(scriptingParams: IScriptingParams): Promise<string> {
    const scriptTelemetryActivity = startActivity(
      TelemetryViews.ScriptingService,
      TelemetryActions.Script,
      undefined,
      {
        operation: this.stringifyScriptOperation(scriptingParams.operation),
      },
    );
    return await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: LocalizedConstants.ObjectExplorer.GeneratingScript,
        cancellable: true,
      },
      async (_progress, token) => {
        const scriptPromise = new Deferred<{
          script: string;
          errorMessage: string;
          errorDetails: string;
        }>();

        let operationId: string | undefined;

        token.onCancellationRequested(() => {
          if (!operationId) {
            scriptTelemetryActivity.end(ActivityStatus.Canceled);
            return;
          }
          this._client.sendRequest(ScriptingCancelRequest.type, {
            operationId,
          });
          const pending = this._onGoingScriptingOperations.get(operationId);
          if (pending) {
            this._onGoingScriptingOperations.delete(operationId);
            pending.resolve({
              script: undefined,
              errorMessage: SCRIPT_OPERATION_CANCELED_ERROR,
              errorDetails: undefined,
            });
          }
        });

        const result = await this._client.sendRequest(
          ScriptingRequest.type,
          scriptingParams,
        );

        operationId = result?.operationId;

        if (!operationId) {
          const error = new Error(
            "Missing operation id from scripting response",
          );
          scriptTelemetryActivity.endFailed(
            error,
            true /* include error message */,
          );
          return undefined;
        }

        this._onGoingScriptingOperations.set(operationId, scriptPromise);

        const scriptResult = await scriptPromise.promise;

        if (scriptResult.errorMessage) {
          scriptTelemetryActivity.endFailed(
            new Error(scriptResult.errorMessage),
            false /* do not include error message */,
          );
          if (scriptResult.errorMessage === SCRIPT_OPERATION_CANCELED_ERROR) {
            scriptTelemetryActivity.end(ActivityStatus.Canceled);
            return;
          }
          vscode.window.showErrorMessage(
            LocalizedConstants.msgScriptingOperationFailed(
              scriptResult.errorMessage,
            ),
          );
          this._logger.error(
            "Scripting error details: ",
            scriptResult.errorMessage,
            scriptResult.errorDetails,
          );
          throw new Error(scriptResult.errorMessage);
        }
        scriptTelemetryActivity.end(ActivityStatus.Succeeded);
        return scriptResult.script;
      },
    );
  }
}
