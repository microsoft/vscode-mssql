/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/** Independently refreshable metadata sections shared by providers and observability. */
export type MetadataSection =
    | "databases"
    | "schemas"
    | "objects"
    | "columns"
    | "parameters"
    | "indexes"
    | "triggers"
    | "constraints"
    | "clrTypes"
    | "securables"
    | "collations"
    | "principals"
    | "definitions";

export type MetadataSectionState = "unknown" | "loading" | "ready" | "partial" | "stale" | "failed";

export type MetadataCompleteness = Readonly<Record<MetadataSection, MetadataSectionState>>;
