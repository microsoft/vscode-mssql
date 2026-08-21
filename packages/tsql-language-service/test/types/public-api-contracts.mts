/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    NullMetadataProvider,
    SourceCoordinateMap,
    createEngineCapabilities,
    type ColorizationResult,
    type DocumentAnalysisSnapshot,
    type EngineFacts,
    type MetadataProvider,
    type TextChange,
} from "@vscode-mssql/tsql-language-service";
import type {
    MetadataHydrationRequest,
    MetadataRefreshResult,
    MetadataView,
} from "@vscode-mssql/tsql-language-service/metadata";
import {
    LanguageServiceWorkerClient,
    workerProtocolVersion,
    type WorkerRequest,
    type WorkerResponse,
    type WorkerTransport,
} from "@vscode-mssql/tsql-language-service/worker";
import { createNodeWorkerClient } from "@vscode-mssql/tsql-language-service/worker/node";
import { createBrowserWorkerClient } from "@vscode-mssql/tsql-language-service/worker/browser";

// Metadata providers expose immutable generations and cancellable refresh/hydration contracts.
const metadata: MetadataProvider = new NullMetadataProvider();
const view: MetadataView = metadata.pin();
const hydration: MetadataHydrationRequest = {
    section: "objects",
    database: "db",
    priority: "interactive",
    reason: "public-api-contract",
};
metadata.requestHydration(hydration);
const refresh: Promise<MetadataRefreshResult> = metadata.refresh(new AbortController().signal);

// Engine profiles, source maps, text deltas, and color deltas remain consumable without host APIs.
const facts: EngineFacts = { engineEdition: 3, compatibilityLevel: 170 };
const profile = createEngineCapabilities(facts);
const change: TextChange = { start: 0, end: 0, text: "SELECT " };
const map = new SourceCoordinateMap({}, "contract:/document.sql");
const projected: number | undefined = map.toProjected(change.end);
declare const analysis: DocumentAnalysisSnapshot;
declare const colors: ColorizationResult;

// Node and browser clients share the serializable worker protocol without sharing host objects.
const request: WorkerRequest = {
    protocolVersion: workerProtocolVersion,
    type: "open",
    id: 1,
    uri: "contract:/document.sql",
    version: 1,
    text: "SELECT 1;",
};
declare const response: WorkerResponse;
declare const transport: WorkerTransport;
const client: LanguageServiceWorkerClient = new LanguageServiceWorkerClient(transport);
const nodeClientFactory: () => LanguageServiceWorkerClient = createNodeWorkerClient;
const browserClientFactory: (worker: Worker) => LanguageServiceWorkerClient =
    createBrowserWorkerClient;

void [
    view,
    refresh,
    profile,
    projected,
    analysis,
    colors,
    request,
    response,
    client,
    nodeClientFactory,
    browserClientFactory,
];
