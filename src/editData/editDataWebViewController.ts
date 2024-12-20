/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";

import { ReactWebviewPanelController } from "../controllers/reactWebviewPanelController";
import {
    EditDataReducers,
    EditDataWebViewState,
} from "../sharedInterfaces/editData";
import ConnectionManager from "../controllers/connectionManager";
import { ScriptingService } from "../scripting/scriptingService";
import UntitledSqlDocumentService from "../controllers/untitledSqlDocumentService";
import { TreeNodeInfo } from "../objectExplorer/treeNodeInfo";
import { ObjectExplorerUtils } from "../objectExplorer/objectExplorerUtils";
import { Deferred } from "../protocol";
import { ScriptOperation } from "../models/contracts/scripting/scriptingRequest";
import { EditDataService } from "../services/editDataService";
import { EditSessionReadyNotification } from "../models/contracts/editData";
import { NotificationHandler } from "vscode-languageclient";
import * as ed from "../sharedInterfaces/editData";

export class EditDataWebViewController extends ReactWebviewPanelController<
    EditDataWebViewState,
    EditDataReducers
> {
    constructor(
        context: vscode.ExtensionContext,
        private node: TreeNodeInfo,
        private readonly connectionManager: ConnectionManager,
        private readonly scriptingService: ScriptingService,
        private readonly untitledSqlDocumentService: UntitledSqlDocumentService,
        private readonly editDataService: EditDataService,
        data?: EditDataWebViewState,
    ) {
        super(
            context,
            "editData",
            data ?? {
                ownerUri: "",
                objectName: "",
                objectType: "",
                queryString: "",
                schemaName: "",
            },
            {
                title: vscode.l10n.t("Edit Data (Preview)"),
                viewColumn: vscode.ViewColumn.Active,
                iconPath: {
                    dark: vscode.Uri.joinPath(
                        context.extensionUri,
                        "media",
                        "tableDesignerEditor_dark.svg", // lewissanchez TODO - update icon for edit data
                    ),
                    light: vscode.Uri.joinPath(
                        context.extensionUri,
                        "media",
                        "tableDesignerEditor_light.svg", // lewissanchez TODO - update icon for edit data
                    ),
                },
            },
        );

        void this.initialize();
    }

    private async initialize() {
        this.editDataService.sqlToolsClient.onNotification(
            EditSessionReadyNotification.type,
            this.handleEditSessionReadyNotification(),
        );

        const schemaName = this.node.metadata.schema;
        const objectName = this.node.metadata.name;
        const nodeUri = schemaName
            ? `untitled:${schemaName}.${objectName}`
            : `untitled:${objectName}`;
        const objectType = this.node.metadata.metadataTypeName.toUpperCase();
        const limitResults = 200;

        // const nodeUri = ObjectExplorerUtils.getNodeUri(this.node);
        let connectionCreds = Object.assign({}, this.node.connectionInfo);
        const databaseName = ObjectExplorerUtils.getDatabaseName(this.node);

        // if not connected or different database then make a new connection
        if (
            !this.connectionManager.isConnected(nodeUri) ||
            connectionCreds.database !== databaseName
        ) {
            connectionCreds.database = databaseName;
            if (!this.connectionManager.isConnecting(nodeUri)) {
                const promise = new Deferred<boolean>();
                await this.connectionManager.connect(
                    nodeUri,
                    connectionCreds,
                    promise,
                );
                await promise;
            }
        }

        const selectStatement = await this.scriptingService.script(
            this.node,
            nodeUri,
            ScriptOperation.Select,
        );

        await this.editDataService.Initialize(
            nodeUri,
            objectName,
            schemaName,
            objectType,
            undefined,
            limitResults,
        );

        this.registerRpcHandlers();
    }

    private handleEditSessionReadyNotification(): NotificationHandler<ed.EditSessionReadyParams> {
        const self = this;
        return (result: ed.EditSessionReadyParams): void => {
            if (result.success) {
                self.updateState({
                    ...self.state,
                    ownerUri: result.ownerUri,
                });
            }
        };
    }

    private registerRpcHandlers() {}
}
