/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { RequestType } from "vscode-languageclient";
import type { SimpleExecuteResult } from "vscode-mssql";
import SqlToolsServiceClient from "../serviceclient";

/**
 * Runs one statement on an already-connected editor and returns its single result set. This is the
 * request the SQL Tools Service exposes for short catalog reads; it neither opens a connection nor
 * takes part in query-editor result handling.
 */
export const simpleExecuteRequest = new RequestType<
    { ownerUri: string; queryString: string },
    SimpleExecuteResult,
    void
>("query/simpleexecute");

/** Sends one simple query for a connection the caller has already verified. */
export type SimpleQuerySender = (
    connectionUri: string,
    query: string,
) => Promise<SimpleExecuteResult>;

export const sendSimpleQuery: SimpleQuerySender = (connectionUri, query) =>
    Promise.resolve(
        SqlToolsServiceClient.instance.sendRequest(simpleExecuteRequest, {
            ownerUri: connectionUri,
            queryString: query,
        }),
    );
