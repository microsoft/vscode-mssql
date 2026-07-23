/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/** Exact detailed execution-plan repro from the Runbook Studio Author surface. */
export const DETAILED_EXECUTION_PLAN_INTENT = `Develop a detailed execution plan for the following workflow:

1. Compare the repository’s (C:\\repos\\work2\\test_assets\\hobbes-complex-dev\\myapp) active branch against the \`main\` branch and identify all changes related to Entity Framework, including migrations, model changes, configuration updates, and generated database artifacts.

2. Based on the identified Entity Framework changes, generate a consolidated DDL script that represents the required database schema modifications.

3. Extract the current DACPAC from the staging application server. Document the source database, extraction method, authentication requirements, and any assumptions or prerequisites.

4. Provision a local SQL Server 2025 container with appropriate persistent storage, networking, credentials, and configuration.

5. Deploy the staging DACPAC to the local SQL Server 2025 instance.

6. Apply the generated DDL script to bring the local database schema in line with the active branch.

7. Execute the \`workload.sql\` script located under \`repo\\scripts\` against the local database.

8. Collect relevant performance metrics during execution, including query duration, CPU consumption, logical and physical reads, waits, execution plans, resource utilization, and any regressions or errors.

9. Produce a performance analysis report containing:

   * An executive summary
   * The tested environment and configuration
   * The identified Entity Framework changes
   * DACPAC deployment and DDL application results
   * Workload execution results
   * Performance findings and bottlenecks
   * Query-plan observations
   * Errors, warnings, and environmental limitations
   * Recommended follow-up actions

The plan should include prerequisites, dependencies, commands or tools to use, validation checkpoints, rollback and cleanup procedures, expected artifacts, and clear success criteria for each phase.

Do not make destructive changes to the staging environment. Any required credentials, server names, database names, container settings, or repository paths that cannot be inferred should be represented as explicit configurable parameters.`;
