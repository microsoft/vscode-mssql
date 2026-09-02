/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type {
    ObjectDefinitionProvider,
    ObjectDefinitionRequest,
    ObjectDefinitionResult,
} from "@vscode-mssql/tsql-language-service";
import * as vscode from "vscode";
import type { IScriptingObject, IServerInfo } from "vscode-mssql";
import { ScriptOperation } from "../../models/contracts/scripting/scriptingRequest";
import type { ScriptingService } from "../../scripting/scriptingService";

/**
 * Catalog kinds mapped onto the SMO type names the scripting service understands. A user type needs
 * its category to choose between the two SMO types that share the `type` kind.
 */
export function scriptingTypeOf(request: ObjectDefinitionRequest): string | undefined {
    switch (request.kind) {
        case "table":
            return "Table";
        case "view":
            return "View";
        case "procedure":
            return "StoredProcedure";
        case "scalarFunction":
        case "tableFunction":
            return "UserDefinedFunction";
        case "synonym":
            return "Synonym";
        case "type":
            return request.typeCategory === "table"
                ? "UserDefinedTableType"
                : request.typeCategory === "alias"
                  ? "UserDefinedDataType"
                  : undefined;
        default:
            return undefined;
    }
}

/** The subset of the scripting service this provider needs, so tests do not build the whole one. */
export interface ScriptObjectRunner {
    createScriptingRequestParams: ScriptingService["createScriptingRequestParams"];
    script: ScriptingService["script"];
}

/**
 * Scripts an object through the SQL Tools Service, the same path "Script as Create" uses. It runs
 * quietly: answering a keystroke must not raise a progress notification or report failure to the
 * user, so the operation throws and the caller decides that navigation simply found nothing.
 */
export class ScriptingObjectDefinitionProvider implements ObjectDefinitionProvider {
    public constructor(
        private readonly _scripting: ScriptObjectRunner,
        private readonly _serverInfo: (connectionUri: string) => IServerInfo | undefined,
    ) {}

    public async getDefinition(
        request: ObjectDefinitionRequest,
        signal?: AbortSignal,
    ): Promise<ObjectDefinitionResult | undefined> {
        const type = scriptingTypeOf(request);
        if (!type || signal?.aborted) return undefined;

        const scriptingObject: IScriptingObject = {
            type,
            schema: request.schema,
            name: request.name,
            // The database that owns the object, which differs from the connection for a
            // cross-database name. The scripting service reads it from the object itself.
            ...(request.database ? { databaseName: request.database } : {}),
        };
        const parameters = this._scripting.createScriptingRequestParams(
            this._serverInfo(request.connectionId) as IServerInfo,
            scriptingObject,
            request.connectionId,
            ScriptOperation.Create,
        );
        const cancellation = new vscode.CancellationTokenSource();
        const abort = (): void => cancellation.cancel();
        signal?.addEventListener("abort", abort);
        try {
            const text = await this._scripting.script(parameters, {
                quiet: true,
                token: cancellation.token,
            });
            if (!text || signal?.aborted) return undefined;
            return Object.freeze({ text, definitionOffset: createStatementOffset(text) });
        } finally {
            signal?.removeEventListener("abort", abort);
            cancellation.dispose();
        }
    }
}

/**
 * Offset of the statement that defines an object. A scripted module keeps the comment banner its
 * author wrote above `CREATE`, so the first line-leading `CREATE` is a better landing place than
 * the top of the text.
 */
export function createStatementOffset(text: string): number {
    const match = /^[^\S\r\n]*CREATE\b/imu.exec(text);
    return match?.index ?? 0;
}
