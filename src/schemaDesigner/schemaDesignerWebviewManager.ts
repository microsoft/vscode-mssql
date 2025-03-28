/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import VscodeWrapper from "../controllers/vscodeWrapper";
import { SchemaDesigner } from "../sharedInterfaces/schemaDesigner";
import { SchemaDesignerWebviewController } from "./schemaDesignerWebviewController";
import { TreeNodeInfo } from "../objectExplorer/treeNodeInfo";
import MainController from "../controllers/mainController";

export class SchemaDesignerWebviewManager {
    private static instance: SchemaDesignerWebviewManager;
    private schemaDesigners: Map<string, SchemaDesignerWebviewController> = new Map();

    public static getInstance(): SchemaDesignerWebviewManager {
        if (!this.instance) {
            this.instance = new SchemaDesignerWebviewManager();
        }
        return this.instance;
    }

    private constructor() {
        // Private constructor to prevent instantiation
    }

    public getSchemaDesigner(
        context: vscode.ExtensionContext,
        vscodeWrapper: VscodeWrapper,
        mainController: MainController,
        schemaDesignerService: SchemaDesigner.ISchemaDesignerService,
        connectionUri: string,
        databaseName: string,
        treeNode: TreeNodeInfo,
    ): SchemaDesignerWebviewController {
        const key = `${connectionUri}-${databaseName}`;
        if (!this.schemaDesigners.has(key)) {
            const schemaDesigner = new SchemaDesignerWebviewController(
                context,
                vscodeWrapper,
                mainController,
                schemaDesignerService,
                connectionUri,
                databaseName,
                treeNode,
            );
            schemaDesigner.onDisposed(() => {
                this.schemaDesigners.delete(key);
            });
            this.schemaDesigners.set(key, schemaDesigner);
        }
        return this.schemaDesigners.get(key)!;
    }
}
