/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * One shared document model per URI (A2 §5.1). The registry is deliberately
 * dumb: identity map + lifecycle sweep. Model creation happens at resolve
 * time (the TextDocument only exists there); cross-feature consumers look
 * models up by URI.
 */

import * as vscode from "vscode";
import { RunbookStudioDocumentModel } from "./runbookStudioDocumentModel";

export class RunbookStudioDocumentRegistry {
    private readonly models = new Map<string, RunbookStudioDocumentModel>();

    public get(uri: vscode.Uri | string): RunbookStudioDocumentModel | undefined {
        return this.models.get(typeof uri === "string" ? uri : uri.toString());
    }

    public first(): RunbookStudioDocumentModel | undefined {
        return this.models.values().next().value;
    }

    public getOrCreate(document: vscode.TextDocument): RunbookStudioDocumentModel {
        const uriKey = document.uri.toString();
        let model = this.models.get(uriKey);
        if (!model) {
            model = new RunbookStudioDocumentModel(document, (closed) => {
                if (this.models.get(closed.uriKey) === closed) {
                    this.models.delete(closed.uriKey);
                }
            });
            this.models.set(uriKey, model);
        } else if (model.backingDocument !== document) {
            model.rebind(document);
        }
        return model;
    }

    public disposeAll(): void {
        for (const model of [...this.models.values()]) {
            model.dispose();
        }
        this.models.clear();
    }
}
