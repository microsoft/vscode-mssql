/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/** Manual Runbook Studio demo prompt for EF migration and ERD result widgets. */
export const ERD_DEMO_INTENT = `Compare Entity Framework changes between the current branch and main for repository (C:\\repos\\work2\\test_assets\\hobbes-complex-dev\\myapp). Generate reviewed bidirectional migration DDL. Clone the staging database named HobbesComplexDev_Staging through a DACPAC using a configurable source connection. Provision an owned local SQL Server 2025 container, deploy the source DACPAC, and verify that the deployed base schema matches it. Apply the generated migration, validate the migrated schema against the current-branch Entity Framework model, run schema compare against the original DACPAC and save the schema diff output, then visualize the migrated schema with an ERD diagram. After capturing those results, roll back the migration and validate the original schema. Visualize the restored schema with an ERD diagram, dispose the owned container, and retain the results.`;
