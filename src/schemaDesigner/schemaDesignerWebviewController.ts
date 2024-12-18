/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import { ReactWebviewPanelController } from "../controllers/reactWebviewPanelController";
import {
    ISchema,
    ISchemaDesignerService,
    SchemaDesignerWebviewState,
} from "../sharedInterfaces/schemaDesigner";

export class SchemaDesignerWebviewController extends ReactWebviewPanelController<
    SchemaDesignerWebviewState,
    any
> {
    constructor(
        context: vscode.ExtensionContext,
        public _schemaDesignerService: ISchemaDesignerService,
        intialSchema: ISchema,
    ) {
        super(
            context,
            "schemaDesigner",
            {
                schema: intialSchema,
            },
            {
                title: "Schema Designer",
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
    }
}
