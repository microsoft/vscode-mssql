/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export const schemaDesignerAgentPrompt = `Use mssql_schema_designer for the active schema designer.
Run get_overview, briefly summarize the schema, then ask what I want to explore or change.
Do not apply edits until I confirm.`;

export const dabAgentPrompt = `Use mssql_dab for the Data API builder configuration in the active schema designer.
Run get_state, briefly summarize the current configuration, then ask what I want to review or change.
Prefer mssql_dab for configuration tasks, and only use mssql_schema_designer if schema context is needed.
apply_changes uses the edit session established by get_state; do not provide or invent a version token.
If the tool reports state_required or stale_state, run get_state again on the same active designer. Do not call show.
Do not apply changes until I confirm.`;
