/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/** A Query Store replica group. Callers show localized text for each code. */
export type ReplicaGroup = "primary" | "secondary" | "geoSecondary" | "geoHASecondary";

/** The `replica_group_id` of each replica group. */
export const replicaGroupIds: Readonly<Record<ReplicaGroup, number>> = {
    primary: 1,
    secondary: 2,
    geoSecondary: 3,
    geoHASecondary: 4,
};
