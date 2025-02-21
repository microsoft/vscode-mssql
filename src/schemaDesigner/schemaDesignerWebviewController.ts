/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import { ReactWebviewPanelController } from "../controllers/reactWebviewPanelController";
import {
    ISchema,
    ISchemaDesignerService,
    SchemaDesignerReducers,
    SchemaDesignerWebviewState,
} from "../sharedInterfaces/schemaDesigner";
import VscodeWrapper from "../controllers/vscodeWrapper";

export class SchemaDesignerWebviewController extends ReactWebviewPanelController<
    SchemaDesignerWebviewState,
    SchemaDesignerReducers
> {
    constructor(
        context: vscode.ExtensionContext,
        vscodeWrapper: VscodeWrapper,
        public _schemaDesignerService: ISchemaDesignerService,
        _database: string,
        intialSchema: ISchema,
    ) {
        super(
            context,
            vscodeWrapper,
            "schemaDesigner",
            "schemaDesigner",
            {
                schema: intialSchema,
            },
            {
                title: _database,
                viewColumn: vscode.ViewColumn.One,
                iconPath: {
                    light: vscode.Uri.joinPath(
                        context.extensionUri,
                        "media",
                        "visualizeSchema_light.svg",
                    ),
                    dark: vscode.Uri.joinPath(
                        context.extensionUri,
                        "media",
                        "visualizeSchema_dark.svg",
                    ),
                },
                showRestorePromptAfterClose: false,
            },
        );

        this._schemaDesignerService.onModelReady(() => {
            vscodeWrapper.showInformationMessage(
                "Schema Designer model is ready.",
            );
        });

        this.registerReducer("publishSchema", async () => {
            console.log("Publishing schema");
            return this.state;
        });
    }
}
