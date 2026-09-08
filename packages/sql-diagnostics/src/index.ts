/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * SQL Server diagnostics: DMV and Query Store catalogs, SQL Agent operations, and Extended
 * Events decoding.
 *
 * The package holds no vscode dependency. Callers supply a {@link SqlRunner} backed by whatever
 * data plane they have, and a {@link DiagnosticsPort} to receive telemetry.
 */

export * from "./core/types";
export * from "./core/platform";
export * from "./core/diagnostics";
export * from "./core/catalog";

export { dmvQueries } from "./dmv/catalog";
export * as dmv from "./dmv/catalog";

export { queryStoreQueries, queryStoreStateSql, setQueryStoreSql } from "./querystore/catalog";
export * as querystore from "./querystore/catalog";

export { agentQueries } from "./agent/catalog";
export * as agent from "./agent/catalog";

export * from "./profiler/xelFormat";
export * from "./profiler/xelMetadata";
export * from "./profiler/xelParser";
export * from "./profiler/xelFileReader";
export * from "./profiler/sessionManager";
export * from "./profiler/sessionTemplates";
export * from "./profiler/liveStream";
export * from "./profiler/capture";
export * from "./profiler/eventBuffer";
export * from "./profiler/eventFilter";
export * from "./profiler/aggregation";
