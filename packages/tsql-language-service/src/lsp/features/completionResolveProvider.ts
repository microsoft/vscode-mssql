/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { CompletionItem } from "vscode-languageserver-types";
import type { SqlCompletion } from "../../analysis/contracts.js";
import type { MaybePromise, SqlFeatureDocumentAccessor } from "./featureDocument.js";

export interface SqlCompletionResolveData {
    readonly uri: string;
    readonly offset: number;
    readonly version?: number;
    readonly label: string;
}

export interface SqlCompletionResolution {
    readonly detail?: string;
    readonly documentation?: string;
}

export interface SqlCompletionDocumentationResolver {
    resolve(
        completion: SqlCompletion,
        data: SqlCompletionResolveData,
    ): MaybePromise<SqlCompletionResolution | undefined>;
}

/** Resolves deferred completion documentation without reparsing the document. */
export class SqlCompletionResolveProvider {
    public constructor(
        private readonly documents: SqlFeatureDocumentAccessor,
        private readonly resolver?: SqlCompletionDocumentationResolver,
    ) {}

    public async resolveCompletionItem(item: CompletionItem): Promise<CompletionItem> {
        const data = completionResolveData(item.data);
        if (!data) {
            return item;
        }
        const document = await this.documents.getDocument(data.uri);
        if (!document || (data.version !== undefined && document.version !== data.version)) {
            return item;
        }
        const completion = document.analysis
            .completeAt(data.offset)
            .items.find((candidate) => candidate.label === data.label);
        if (!completion) {
            return item;
        }
        const external = await this.resolver?.resolve(completion, data);
        return {
            ...item,
            detail: external?.detail ?? completion.detail ?? item.detail,
            documentation:
                external?.documentation ?? completion.documentation ?? item.documentation,
        };
    }
}

export function createCompletionResolveData(
    uri: string,
    offset: number,
    label: string,
    version?: number,
): SqlCompletionResolveData {
    return Object.freeze({ uri, offset, label, version });
}

function completionResolveData(value: unknown): SqlCompletionResolveData | undefined {
    if (!value || typeof value !== "object") {
        return undefined;
    }
    const candidate = value as Partial<SqlCompletionResolveData>;
    return typeof candidate.uri === "string" &&
        typeof candidate.offset === "number" &&
        typeof candidate.label === "string"
        ? (candidate as SqlCompletionResolveData)
        : undefined;
}
