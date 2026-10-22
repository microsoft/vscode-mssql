/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type * as vscode from "vscode";
import type {
    CompletionCatalogAccess,
    CompletionMetadataResolver,
} from "../copilot/completionSchemaContextService";
import { findQueryStudioModel } from "./queryStudioEditorProvider";

/** Share the document's existing metadata lease with inline completions. */
export class QueryStudioCompletionMetadataResolver implements CompletionMetadataResolver {
    async resolve(document: vscode.TextDocument): Promise<CompletionCatalogAccess | undefined> {
        const binding = findQueryStudioModel(document.uri)?.sessionBinding;
        const snapshot = binding?.metadataHandleForConsumers?.current();
        if (!binding || !snapshot) {
            return undefined;
        }
        const state = binding.connectionState;
        return {
            snapshot,
            generation: snapshot.generation,
            facts: { server: state.serverDisplayName, database: state.database },
            fingerprint: `qs|${state.serverDisplayName ?? "?"}|${state.database ?? "?"}|${state.loginName ?? "?"}`,
        };
    }
}
