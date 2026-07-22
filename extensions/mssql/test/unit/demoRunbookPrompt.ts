/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/** Copy/paste demo intent covered by deterministic-preview and opt-in live product tests. */
export const DEMO_RUNBOOK_INTENT =
    "Develop and run a developer-validation runbook. Compare the Entity Framework changes between " +
    "the exact demo and main Git refs, capture the Git change set, generate reviewed migration DDL, " +
    "and apply it. Clone the HobbesDemo_MyApp_Staging staging database through a DACPAC into an owned " +
    "local SQL Server 2025 container. Require base-schema equality before migration, validate expected-head " +
    "schema convergence after migration, export schema-compare diff output, and visualize the migrated " +
    "schema as an ERD. Inspect and run scripts/workload.sql with full DMV and XEvent performance analysis " +
    "covering duration, CPU, logical and physical reads, writes, waits, blocking, and errors. Retain the XEL " +
    "and show factual current-run metrics. Only after every validation gate passes, produce a release-candidate " +
    "DACPAC and canonical release manifest. Always dispose the owned container. The workflow ends at the " +
    "owned candidate and grants no protected deployment authority. Make repository root, exact refs, EF " +
    "project/context, staging connection/database, container name/database/password, workload path/repetitions, " +
    "timeouts, and XEvent maximum file size runbook parameters.";
