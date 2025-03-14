/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import VscodeWrapper from "../controllers/vscodeWrapper";
import { SchemaDesigner } from "../sharedInterfaces/schemaDesigner";
import { SchemaDesignerWebviewController } from "./schemaDesignerWebviewController";

export class SchemaDesignerWebviewManager {
    private static instance: SchemaDesignerWebviewManager;
    private schemaDesigners: Map<string, SchemaDesignerWebviewController> =
        new Map();

    public static getInstance(): SchemaDesignerWebviewManager {
        if (!this.instance) {
            this.instance = new SchemaDesignerWebviewManager();
        }
        return this.instance;
    }

    private constructor() {
        // Private constructor to prevent instantiation
    }

    private createSchemaDesigner(
        context: vscode.ExtensionContext,
        vscodeWrapper: VscodeWrapper,
        schemaDesignerService: SchemaDesigner.ISchemaDesignerService,
        connectionUri: string,
        databaseName: string,
    ): SchemaDesignerWebviewController {
        return new SchemaDesignerWebviewController(
            context,
            vscodeWrapper,
            schemaDesignerService,
            connectionUri,
            databaseName,
        );
    }

    public getSchemaDesigner(
        context: vscode.ExtensionContext,
        vscodeWrapper: VscodeWrapper,
        schemaDesignerService: SchemaDesigner.ISchemaDesignerService,
        connectionUri: string,
        databaseName: string,
    ): SchemaDesignerWebviewController {
        const key = `${connectionUri}-${databaseName}`;
        if (!this.schemaDesigners.has(key)) {
            const schemaDesigner = this.createSchemaDesigner(
                context,
                vscodeWrapper,
                schemaDesignerService,
                connectionUri,
                databaseName,
            );
            this.schemaDesigners.set(key, schemaDesigner);
        }
        return this.schemaDesigners.get(key)!;
    }
}
