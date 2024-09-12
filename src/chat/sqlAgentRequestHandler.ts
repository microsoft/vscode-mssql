/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { CopilotService } from '../services/copilotService';
import VscodeWrapper from '../controllers/vscodeWrapper';
// import { name } from 'ejs';
import { MessageType } from '../models/contracts/copilot';

interface ISqlChatResult extends vscode.ChatResult {
	metadata: {
		command: string;
	};
}

const MODEL_SELECTOR: vscode.LanguageModelChatSelector = { vendor: 'copilot', family: 'gpt-4o' };

let nextConversationUriId = 1;


// \"FunctionName\":\"SqlExecAndParse-WriteUserData\",\"FunctionDescription\":\"This method is used to execute a T-SQL statement that will insert, update or delete user data.\\r\\n                                       It also provides the ability to do DDL operations on user objects such as tables, views, etc.\\r\\n                                       The return value is a string with the results of the query.\",\"FunctionParameters\":{},
// \"StrictParameterSchemaEnabled\":null},{\"Kind\":{},

// \"FunctionName\":\"SqlExecAndParse-ValidateGeneratedTSQL\",\"FunctionDescription\":\"This function is used to verify the syntax and binding of a generated T-SQL query. \\r\\n                                    This function *DOES NOT* execute the query or return any results from the query.\\r\\n                                    Use this function to validate and optimize a generated T-SQL statement.\",\"FunctionParameters\":{},\"StrictParameterSchemaEnabled\":null},{\"Kind\":{},

// \"FunctionName\":\"SchemaExploration-GetTableNames\",\"FunctionDescription\":\"Get the names of all the tables in the database.  \\r\\n                                       This method is useful to identify which tables are available to satisfy \\r\\n                                       a request for help with a script for the current database.\\r\\n                                       This method should be the first SQL helper function used to know the schema of the database.\",
// \"FunctionParameters\":{},\"StrictParameterSchemaEnabled\":null},{\"Kind\":{},

// \"FunctionName\":\"SchemaExploration-GetForeignKeysForTable\",\"FunctionDescription\":\"Get all the foreign keys related to this table.    \\r\\n                                       This method is useful to identify relationships between tables.\",\"FunctionParameters\":{},\"StrictParameterSchemaEnabled\":null},{\"Kind\":{},

// \"FunctionName\":\"SchemaExploration-GetDatabaseObjectInformation\",\"FunctionDescription\":\"Get detailed information about a database object.\\r\\n                                       This funtion returns the output of sp_help on the specified user object.\\r\\n                                       This function is useful when needing to explore the user schema and relationships to other user objects.\",\"FunctionParameters\":{},\"StrictParameterSchemaEnabled\":null},{\"Kind\":{},

// \"FunctionName\":\"SchemaExploration-GetColumnInfoForListOfTables\",\"FunctionDescription\":\"function to get the column informat
// ion for a set of tables.\\r\\n                                       This function provides an efficient way to get critical column information for multiple tables in a single query.\",\"FunctionParameters\":{},\"StrictParameterSchemaEnabled\":null},{\"Kind\":{},

// \"FunctionName\":\"SchemaExploration-GetTableColumnNames\",\"FunctionDescription\":\"Get the list of columns for a given table.\\r\\n                                        This function is the best to provide the available columns for writing queries.\\r\\n                                        The function returns the name, data type, default value, and whether the column is nullable.\\r\\n                                        All of which are critical in authoring accurate queries.\",\"FunctionParameters\":{},\"StrictParameterSchemaEnabled\":null},{\"Kind\":{},

// \"FunctionName\":\"SchemaExploration-FindColumn\",\"FunctionDescription\":\"function to find tables with a given column name\\r\\n                                       This function is use
// d to find tables that have a column with the given name.\",\"FunctionParameters\":{},\"StrictParameterSchemaEnabled\":null},{\"Kind\":{},

// \"FunctionName\":\"SchemaExploration-FindColumnReferences\",\"FunctionDescription\":\"Find database objects that reference a given column in a given table.\",\"FunctionParameters\":{},\"StrictParameterSchemaEnabled\":null},{\"Kind\":{},

// \"FunctionName\":\"SchemaExploration-GetObjectText\",\"FunctionDescription\":\"Get the body of a stored procedure, view or CTE.  \\r\\n                                     Using sp_helptext is a very efficient way to get the body of the view, stored procedure or CTE.\\r\\n                                     This function is not helpful for writing select statements.\",\"FunctionParameters\":{},\"StrictParameterSchemaEnabled\":null},{\"Kind\":{},

// \"FunctionName\":\"SchemaExploration-GetTablesThatHaveTriggers\",\"FunctionDescription\":\"List tables that have a trigger.\",\"FunctionParameters\":{},\"StrictParameterSchemaEnabled\":null},{\"Kind\":{
// },

// \"FunctionName\":\"SchemaExploration-GetLatestSchemaChanges\",\"FunctionDescription\":\"Get the latest changes in the database schema. This function will give the top 10 most recent created or modified objects.\",\"FunctionParameters\":{},\"StrictParameterSchemaEnabled\":null},{\"Kind\":{},

// \"FunctionName\":\"SchemaExploration-GetColumnCountPerTable\",\"FunctionDescription\":\"List the number of columns per table in a database. This is a good way to find wide tables.\",\"FunctionParameters\":{},\"StrictParameterSchemaEnabled\":null},{\"Kind\":{},

// \"FunctionName\":\"SchemaExploration-GetTablesWithNoClusteredIndex\",\"FunctionDescription\":\"List any tables that have no clustered index. This is a good way to find heap tables.\",\"FunctionParameters\":{},\"StrictParameterSchemaEnabled\":null},{\"Kind\":{},

// \"FunctionName\":\"SchemaExploration-GetNonClusteredIndexCountPerTable\",\"FunctionDescription\":\"List the number of non-clustered indexes on each table. This is a good way to find tables with a lot of indexes.
// \",\"FunctionParameters\":{},\"StrictParameterSchemaEnabled\":null},{\"Kind\":{},

// \"FunctionName\":\"SchemaExploration-GetTablesWithNoPrimaryKey\",\"FunctionDescription\":\"Get list of tables from the database that have no primary key.  This can be interesting information if \\r\\n                                       queries to a database are performing poorly.  It also can provide potetial areas for consideration\\r\\n                                       general schema design improvements.\",\"FunctionParameters\":{},\"StrictParameterSchemaEnabled\":null},{\"Kind\":{},

// \"FunctionName\":\"SchemaExploration-GetTablesThatHaveDisabledConstraints\",\"FunctionDescription\":\"List any tables that have a constraint disabled.\",\"FunctionParameters\":{},\"StrictParameterSchemaEnabled\":null},{\"Kind\":{},

// \"FunctionName\":\"SchemaExploration-ListIndexes\",\"FunctionDescription\":\"This function lists indexes in the database.\",\"FunctionParameters\":{},\"StrictParameterSchemaEnabled\":null},{\"Kind\":{},\"FunctionNam
// e\":\"Config_Common-GetCurrentDate\",\"FunctionDescription\":\"This function returns the current date.\",\"FunctionParameters\":{},\"StrictParameterSchemaEnabled\":null},{\"Kind\":{},

// \"FunctionName\":\"Config_2017-AutomaticTuning\",\"FunctionDescription\":\"This function fetches data about the automatic tuning configuration of the database, and how to change it.\",\"FunctionParameters\":{},\"StrictParameterSchemaEnabled\":null},{\"Kind\":{},

// \"FunctionName\":\"Connectivity_Common-CheckActiveUserConnections\",\"FunctionDescription\":\"This fetches all active user connections to the server, including system users.\",\"FunctionParameters\":{},\"StrictParameterSchemaEnabled\":null},{\"Kind\":{},

// \"FunctionName\":\"Connectivity_Common-ListDatabasePermission\",\"FunctionDescription\":\"This function lists database permissions granted to database principals.\",\"FunctionParameters\":{},\"StrictParameterSchemaEnabled\":null},{\"Kind\":{},

// \"FunctionName\":\"QueryPerfDMV_Common-ListRunningQueries\",\"FunctionDescription\"
// :\"This function lists top 10 currently running queries by CPU time.\",\"FunctionParameters\":{},\"StrictParameterSchemaEnabled\":null},{\"Kind\":{},

// \"FunctionName\":\"Storage_Common-CheckDatabaseAndTableSize\",\"FunctionDescription\":\"This function collects all used disk storage either in form of logs or user data (referred to as rows). It then surfaces that info aggregated by table and also presents some information about free space available in the database.\",\"FunctionParameters\":{},\"StrictParameterSchemaEnabled\":null},{\"Kind\":{},





// \"FunctionName\":\"TroubleShooting_Common-IdentifyHighCPUConsumingQueries\",\"FunctionDescription\":\"This identifies and show a list to user with top slowest and worst performing queries that cause high CPU utilization from among currently running queries and queries executed in the past 2 houres in the active Azure SQL database. You must call it when user asks to troubleshoot database performance and slowness issue.\",\"FunctionParameters\":{},\"StrictParameterSchemaEnabl
// ed\":null},{\"Kind\":{},

// \"FunctionName\":\"TroubleShooting_Common-SuggestMissingIndex\",\"FunctionDescription\":\"This function suggests missing index. You must call it when user asks to troubleshoot database performance and slowness issue.\",\"FunctionParameters\":{},\"StrictParameterSchemaEnabled\":null},{\"Kind\":{},

// \"FunctionName\":\"TroubleShooting_Common-FindBlockingSession\",\"FunctionDescription\":\"Function that finds head blocking sessions. You must call it when user asks to troubleshoot database performance and slowness issue.\",\"FunctionParameters\":{},\"StrictParameterSchemaEnabled\":null},{\"Kind\":{},

// \"FunctionName\":\"TroubleShooting_Common-CheckMemoryGrant\",\"FunctionDescription\":\"This function checks for memory grant problems. You must call it when user asks to troubleshoot database performance and slowness issue.\",\"FunctionParameters\":{},\"StrictParameterSchemaEnabled\":null},{\"Kind\":{},

// \"FunctionName\":\"TroubleShooting_Common-FindFragmentIndex\",\"FunctionDescription\":\"This func
// tion finds fragmented indexes in the active SQL database. If the user provides a list of tables to check, it will fetch the 5 most fragmented rowstore and columnstore indexes for the provided tables. Otherwise, it will fetch the 5 most fragmented rowstore and columnstore indexes in the database overall. In either case, it provides guidance on how to fix the fragmentation.\",\"FunctionParameters\":{},\"StrictParameterSchemaEnabled\":null},{\"Kind\":{},

// \"FunctionName\":\"TroubleShooting_Common-IdentifyWaitType\",\"FunctionDescription\":\"This identifies database level and query level wait types.\",\"FunctionParameters\":{},\"StrictParameterSchemaEnabled\":null},{\"Kind\":{},

// \"FunctionName\":\"TroubleShooting_Common-UpdateStatistics\",\"FunctionDescription\":\"This function finds auto-create statistics and auto-update statistics settings and checks outdated and stale statistics.\",\"FunctionParameters\":{},\"StrictParameterSchemaEnabled\":null},{\"Kind\":{},

// \"FunctionName\":\"QueryStoreQuery_Common-QDSFindQueryWi
// thHighestWaitDuration\",\"FunctionDescription\":\"This function lists queries that have highest wait durations.\",\"FunctionParameters\":{},\"StrictParameterSchemaEnabled\":null},{\"Kind\":{},

// \"FunctionName\":\"QueryStoreQuery_Common-QDSFindQueryWithMultiplePlans\",\"FunctionDescription\":\"This function lists queries that have multiple execution plans.\",\"FunctionParameters\":{},\"StrictParameterSchemaEnabled\":null},{\"Kind\":{},

// \"FunctionName\":\"QueryStoreQuery_Common-QDSFindQueryWithForcedPlan\",\"FunctionDescription\":\"This function lists queries that have forced plans.\",\"FunctionParameters\":{},\"StrictParameterSchemaEnabled\":null},{\"Kind\":{},

// \"FunctionName\":\"QueryStoreQuery_Common-QDSFindQueryWithHighestIO\",\"FunctionDescription\":\"This function shows the highest I/O using queries.\",\"FunctionParameters\":{},\"StrictParameterSchemaEnabled\":null},{\"Kind\":{},

// \"FunctionName\":\"QueryStoreQuery_Common-QDSFindHighExecutionTimeVariation\",\"FunctionDescription\":\"This function finds the queri
// es that have high execution time variation in the query data store (QDS).\",\"FunctionParameters\":{},\"StrictParameterSchemaEnabled\":null},{\"Kind\":{},

// \"FunctionName\":\"QueryStoreQuery_Common-QDSFindQueryTextByID\",\"FunctionDescription\":\"This function shows the query text for a given query ID fetched from the query data store (QDS).\",\"FunctionParameters\":{},\"StrictParameterSchemaEnabled\":null},{\"Kind\":{},

// \"FunctionName\":\"QueryStoreQuery_Common-QDSLatestExecutedQueries\",\"FunctionDescription\":\"This function shows the latest executed queries in the database.\",\"FunctionParameters\":{},\"StrictParameterSchemaEnabled\":null},{\"Kind\":{},

// \"FunctionName\":\"QueryStoreQuery_Common-QDSLongestRunningQueries\",\"FunctionDescription\":\"This function shows the list of queries that ran for the longest time.\",\"FunctionParameters\":{},\"StrictParameterSchemaEnabled\":null},{\"Kind\":{},

// \"FunctionName\":\"QueryStoreQuery_Common-QDSRegressedQueries\",\"FunctionDescription\":\"This function shows queries
//  that have regressed in performance in a recent time compared to a prior time.\",\"FunctionParameters\":{},\"StrictParameterSchemaEnabled\":null},{\"Kind\":{},

//  \"FunctionName\":\"QueryStoreQuery_Common-QDSRegressedQueriesWithPlanChanges\",

//  \"FunctionDescription\":\"This function shows queries with regressed performance that had query plan changes.\",\"FunctionParameters\":{},\"StrictParameterSchemaEnabled\":null},{\"Kind\":{},

//  \"FunctionName\":\"QueryStoreQuery_Common-FindQueryTimeouts\",\"FunctionDescription\":\"This function finds query execution timeouts and troubleshoot. It helps to troubleshoot database performance and slowness issue.\",\"FunctionParameters\":{},\"StrictParameterSchemaEnabled\":null},{\"Kind\":{},

//  \"FunctionName\":\"QueryStoreQuery_Common-TroubleshootQueryStoreMode\",\"FunctionDescription\":\"This function finds query store (QDS) mode and troubleshoot issues when query store is in read-only mode.\",\"FunctionParameters\":{},\"StrictParameterSchemaEnabled\":null},{\"Kind\":{},

//  \"FunctionName\":
// \"SS_BandRToolset-Hints_CreatingDatabaseBackups\",\"FunctionDescription\":\"This method provides hints on how to improve answers if the user asks about creating database backups, backup plans, or database backup strategies.\\r\\n                                       REQUIRED_SQL_VERSION: SQL Server any version.  Not applicatble to Azure SQL Database\",\"FunctionParameters\":{},\"StrictParameterSchemaEnabled\":null},{\"Kind\":{},

// \"FunctionName\":\"SS_BandRToolset-Hints_CurrentBackupStrategy\",\"FunctionDescription\":\"This method provides specific instructions on how to respond to questions regarding a backup strategy for a given database. \\r\\n                                       The funciton does not provide the actual backup strategy, but rather the steps the LLM should take to gather the necessary information to provide a response.\\r\\n                                       This function should only be called once to get the initial instructions.\",\"FunctionParameters\":{},\"StrictParameterSchemaEnabl
// ed\":null},{\"Kind\":{},

// \"FunctionName\":\"SS_BandRToolset-Hints_DeterminePotentialDatalossFromRestore\",\"FunctionDescription\":\"This method provides hints on how to determine potential data loss if a restore operation was done on the current database.\\r\\n                                       REQUIRED_SQL_VERSION: SQL Server any version and SQL Server Managed Instance.  Not applicatble to Azure SQL Database\",\"FunctionParameters\":{},\"StrictParameterSchemaEnabled\":null},{\"Kind\":{},

// \"FunctionName\":\"SS_BandRToolset-ConvertSegmentedLSNToDecimal\",\"FunctionDescription\":\"Convert a segemented LSN (e.g. '0000001e:00000140:0004' to a decimal format (e.g. '30000000005600001'.This function enables comparison of segmented LSN values from fn_dblog (which are in segmented format) to be compared with LSN values from backup information in msdb (which is in decimal format)\",\"FunctionParameters\":{},\"StrictParameterSchemaEnabled\":null},{\"Kind\":{},

// \"FunctionName\":\"HealthAudit_SqlServer-Hint_SqlServerHealt
// hReport\",\"FunctionDescription\":\"This function provides detailed instructions on how to conduct a health audit report on a SQL Server.  \\r\\n                                       This method should be called first when the user requests a health report or health audit for their current server.\\r\\n                                       These instructions will guide how to use the data from related RAW data tools for health information for the current server and databases.\",\"FunctionParameters\":{},\"StrictParameterSchemaEnabled\":null},{\"Kind\":{},

// \"FunctionName\":\"HealthAudit_SqlServer-ServerCUPatchLevel\",\"FunctionDescription\":\"This function provides the latest CU patched onto the current server\",\"FunctionParameters\":{},\"StrictParameterSchemaEnabled\":null},{\"Kind\":{},

// \"FunctionName\":\"HealthAudit_SqlServer-ServerNumaConfiguration\",\"FunctionDescription\":\"This function provides MAXDOP, CPU and NUMA configuration for the current SQL Server.\",\"FunctionParameters\":{},\"StrictParameterS
// chemaEnabled\":null},{\"Kind\":{},

// \"FunctionName\":\"HealthAudit_SqlServer-ServerSoftNumaInUse\",\"FunctionDescription\":\"This function returns whether or not 'soft numa' is in use on the current server or not\",\"FunctionParameters\":{},\"StrictParameterSchemaEnabled\":null},{\"Kind\":{},

// \"FunctionName\":\"HealthAudit_SqlServer-ServerMemoryConfiguration\",\"FunctionDescription\":\"This function returns the memory configuration for the current server.  This includes current memory, max memory and a recommendation on a value for max memory.\",\"FunctionParameters\":{},\"StrictParameterSchemaEnabled\":null},{\"Kind\":{},

// \"FunctionName\":\"HealthAudit_SqlServer-SummarizeUnhealthyDatabases\",\"FunctionDescription\":\"This function list databases that have one more more configurations that would be considered unhealthy or poorly configured.\",\"FunctionParameters\":{},\"StrictParameterSchemaEnabled\":null},{\"Kind\":{},

// \"FunctionName\":\"HealthAudit_SqlServer-IsSAAccountEnabled\",\"FunctionDescription\":\"This fun
// ction checks to see if the SQL Server SA account is currently enabled or disabled.\",\"FunctionParameters\":{},\"StrictParameterSchemaEnabled\":null},{\"Kind\":{},

// \"FunctionName\":\"HealthAudit_SqlServer-ListHighPrivilegeLogins\",\"FunctionDescription\":\"This function lists all logins on the current server that have high access privileges.\",\"FunctionParameters\":{},\"StrictParameterSchemaEnabled\":null},{\"Kind\":{},

// \"FunctionName\":\"HealthAudit_SqlServer-GetServerEncryptionConfiguration\",\"FunctionDescription\":\"This function checks to see if the current server has 'ForceEncryption' enabled and also returns the number of enabled SQL AUTH logins there are.\",\"FunctionParameters\":{},\"StrictParameterSchemaEnabled\":null},{\"Kind\":{},

// \"FunctionName\":\"HealthAudit_SqlServer-ListDBsWithNoHA\",\"FunctionDescription\":\"This function lists all databases on the current server that have no high availability solution configured.\",\"FunctionParameters\":{},\"StrictParameterSchemaEnabled\":null},{\"Kind\":{},

// \
// "FunctionName\":\"HealthAudit_SqlServer-ListDBsWithNoFullBackup\",\"FunctionDescription\":\"This function lists all databases on the current server that have no full backup available on the server.\",\"FunctionParameters\":{},\"StrictParameterSchemaEnabled\":null}],\"Functions\":[]}"

const externalTools = [
	{
		name: "SqlExecAndParse-ReadSystemMetadata",
		description: "This method is used to read system metadata from the current database. The return value is a string with the results of the query.",
		parametersSchema: {}
	},
	{
		name: "SqlExecAndParse-WriteSystemMetadata",
		description: "This method is used to execute a T-SQL statement that will write to system metadata in the current database. For example, creating a SQL agent job, or XEvent session. The return value is a string with the results of the query.",
		parametersSchema: {}
	},
	{
		name: "SqlExecAndParse-ReadUserData",
		description: "This method is used to execute a T-SQL statement that will read user data.",
		parametersSchema: {}
	},
	{
		name: "SqlExecAndParse-WriteUserData",
		description: "This method is used to execute a T-SQL statement that will insert, update or delete user data. It also provides the ability to do DDL operations on user objects such as tables, views, etc. The return value is a string with the results of the query.",
		parametersSchema: {}
	},
	{
		name: "SqlExecAndParse-ValidateGeneratedTSQL",
		description: "This function is used to verify the syntax and binding of a generated T-SQL query. This function *DOES NOT* execute the query or return any results from the query. Use this function to validate and optimize a generated T-SQL statement.",
		parametersSchema: {}
	},
	{
		name: "SchemaExploration-GetTableNames",
		description: "Get the names of all the tables in the database. This method is useful to identify which tables are available to satisfy a request for help with a script for the current database. This method should be the first SQL helper function used to know the schema of the database.",
		parametersSchema: {}
	},
	{
		name: "SchemaExploration-GetForeignKeysForTable",
		description: "Get all the foreign keys related to this table. This method is useful to identify relationships between tables.",
		parametersSchema: {}
	},
	{
		name: "SchemaExploration-GetDatabaseObjectInformation",
		description: "Get detailed information about a database object. This function returns the output of sp_help on the specified user object. This function is useful when needing to explore the user schema and relationships to other user objects.",
		parametersSchema: {}
	},
	{
		name: "SchemaExploration-GetColumnInfoForListOfTables",
		description: "Get the column information for a set of tables. This function provides an efficient way to get critical column information for multiple tables in a single query.",
		parametersSchema: {}
	},
	{
		name: "SchemaExploration-GetTableColumnNames",
		description: "Get the list of columns for a given table. This function is the best to provide the available columns for writing queries. The function returns the name, data type, default value, and whether the column is nullable. All of which are critical in authoring accurate queries.",
		parametersSchema: {}
	},
	{
		name: "SchemaExploration-FindColumn",
		description: "Function to find tables with a given column name. This function is used to find tables that have a column with the given name.",
		parametersSchema: {}
	},
	{
		name: "SchemaExploration-FindColumnReferences",
		description: "Find database objects that reference a given column in a given table.",
		parametersSchema: {}
	},
	{
		name: "SchemaExploration-GetObjectText",
		description: "Get the body of a stored procedure, view or CTE. Using sp_helptext is a very efficient way to get the body of the view, stored procedure or CTE. This function is not helpful for writing select statements.",
		parametersSchema: {}
	},
	{
		name: "SchemaExploration-GetTablesThatHaveTriggers",
		description: "List tables that have a trigger.",
		parametersSchema: {}
	},
	{
		name: "SchemaExploration-GetLatestSchemaChanges",
		description: "Get the latest changes in the database schema. This function will give the top 10 most recent created or modified objects.",
		parametersSchema: {}
	},
	{
		name: "SchemaExploration-GetTablesWithNoClusteredIndex",
		description: "List any tables that have no clustered index. This is a good way to find heap tables.",
		parametersSchema: {}
	},
	{
		name: "SchemaExploration-GetNonClusteredIndexCountPerTable",
		description: "List the number of non-clustered indexes on each table. This is a good way to find tables with a lot of indexes.",
		parametersSchema: {}
	},
	{
		name: "SchemaExploration-GetTablesWithNoPrimaryKey",
		description: "Get list of tables from the database that have no primary key. This can be interesting information if queries to a database are performing poorly. It also can provide potetial areas for consideration general schema design improvements.",
		parametersSchema: {}
	},
	{
		name: "SchemaExploration-GetTablesThatHaveDisabledConstraints",
		description: "List any tables that have a constraint disabled.",
		parametersSchema: {}
	},
	{
		name: "SchemaExploration-ListIndexes",
		description: "This function lists indexes in the database.",
		parametersSchema: {}
	},
	{
		name: "Config_2017-AutomaticTuning",
		description: "This function fetches data about the automatic tuning configuration of the database, and how to change it.",
		parametersSchema: {}
	},
	{
		name: "Connectivity_Common-CheckActiveUserConnections",
		description: "This fetches all active user connections to the server, including system users.",
		parametersSchema: {}
	},
	{
		name: "Connectivity_Common-ListDatabasePermission",
		description: "This function lists database permissions granted to database principals.",
		parametersSchema: {}
	},
	{
		name: "QueryPerfDMV_Common-ListRunningQueries",
		description: "This function lists top 10 currently running queries by CPU time.",
		parametersSchema: {}
	},
	{
		name: "Storage_Common-CheckDatabaseAndTableSize",
		description: "This function collects all used disk storage either in form of logs or user data (referred to as rows). It then surfaces that info aggregated by table and also presents some information about free space available in the database.",
		parametersSchema: {}
	},
	{
		name: "SchemaExploration-GetTableNames",
		description: "Get the names of all the tables in the database. This method is useful to identify which tables are available to satisfy a request for help with a script for the current database. This method should be the first SQL helper function used to know the schema of the database.",
		parametersSchema: {}
	}
];



let useExternalEngine = false;

export const createSqlAgentRequestHandler = (
	copilotService: CopilotService,
	vscodeWrapper: VscodeWrapper,
	context: vscode.ExtensionContext): vscode.ChatRequestHandler => {

	const handler: vscode.ChatRequestHandler = async (
		request: vscode.ChatRequest,
		_context: vscode.ChatContext,
		stream: vscode.ChatResponseStream,
		token: vscode.CancellationToken
	): Promise<ISqlChatResult> => {

		// const tools = [
		// 	{
		// 		kind: {},
		// 		function_name: "SqlExecAndParse-ReadSystemMetadata",
		// 		function_description:
		// 			"This method is used to read system metadata from the current database.\n The return value is a string with the results of the query.",
		// 		function_parameters: {},
		// 		strict_parameter_schema_enabled: null,
		// 	},
		// 	{
		// 		kind: {},
		// 		function_name: "SchemaExploration-GetTableNames",
		// 		function_description:
		// 			"Get the names of all the tables in the database.\n This method is useful to identify which tables are available to satisfy\n a request for help with a script for the current database.\n This method should be the first SQL helper function used to know the schema of the database.",
		// 		function_parameters: {},
		// 		strict_parameter_schema_enabled: null,
		// 	}
		// ];

		const prompt = request.prompt.trim();
		const [model] = await vscode.lm.selectChatModels(MODEL_SELECTOR);

		if (!useExternalEngine) {
			try {
				if (!model) {
					stream.markdown('No model found.');
					return { metadata: { command: '' } };
				}

				stream.progress(`Using ${model.name} (${context.languageModelAccessInformation.canSendRequest(model)})...`);

				// const messages = [
				// 	vscode.LanguageModelChatMessage.User(
				// 		`You're a friendly SQL Server assistant, helping with writing database queries.`
				// 	),
				// 	vscode.LanguageModelChatMessage.User(
				// 		`Please provide help with ${prompt}.`
				// 	)
				// ];
				// const chatResponse = await model.sendRequest(messages, { modelOptions: { tools: tools} }, token);
				// for await (const fragment of chatResponse.text) {
				// 	stream.markdown(fragment);
				// }

				stream.markdown(`Available tools: ${vscode.lm.tools.map(tool => tool.id).join(', ')}\n\n`);

				const allTools = vscode.lm.tools.map((tool): vscode.LanguageModelChatTool => {
					return {
						name: tool.id,
						description: tool.modelDescription,
						parametersSchema: tool.parametersSchema ?? {}
					};
				});

				const options: vscode.LanguageModelChatRequestOptions = {
					justification: 'Just because!',
				};

				const messages = [
					vscode.LanguageModelChatMessage.User(`There is a selection of tools that may give helpful context to answer the user's query. If you aren't sure which tool is relevant, you can call multiple tools.`),
					vscode.LanguageModelChatMessage.User(request.prompt),
				];

				const toolReferences = [...request.toolReferences];

				const runWithFunctions = async () => {
					const requestedTool = toolReferences.shift();
					if (requestedTool) {
						options.toolChoice = requestedTool.id;
						options.tools = allTools.filter(tool => tool.name === requestedTool.id);
					} else {
						options.toolChoice = undefined;
						//options.tools = allTools;

						options.tools = externalTools;
						// [
						// 	{
						// 		name: "SqlExecAndParse-ReadSystemMetadata",
						// 		description: "This method is used to read system metadata from the current database. The return value is a string with the results of the query.",
						// 		parametersSchema: {}
						// 	},
						// 	{
						// 		name: "SchemaExploration-GetTableNames",
						// 		description: "Get the names of all the tables in the database. This method is useful to identify which tables are available to satisfy a request for help with a script for the current database. This method should be the first SQL helper function used to know the schema of the database.",
						// 		parametersSchema: {}
						// 	}
						// ];
					}

					let didReceiveFunctionUse = false;

					const response = await model.sendRequest(messages, options, token);

					for await (const part of response.stream) {
						if (part instanceof vscode.LanguageModelChatResponseTextPart) {
							stream.markdown(part.value);
						} else if (part instanceof vscode.LanguageModelChatResponseToolCallPart) {
							const tool = vscode.lm.tools.find(tool => tool.id === part.name);
							if (!tool) {
								stream.markdown(`Tool lookup for: ${part.name} - ${part.parameters}.  Invoking external tool.`);
								continue;
							}

							let _parameters: any;
							try {
								_parameters = JSON.parse(part.parameters);
							} catch (err) {
								throw new Error(`Got invalid tool use parameters: "${part.parameters}". (${(err as Error).message})`);
							}

							stream.progress(`Calling tool: ${tool.id} with ${part.parameters}`);
							const result = await vscode.lm.invokeTool(tool.id,
								{ parameters: JSON.parse(part.parameters),  toolInvocationToken: request.toolInvocationToken }, token);

							let assistantMsg = vscode.LanguageModelChatMessage.Assistant('');
							assistantMsg.content2 = [new vscode.LanguageModelChatResponseToolCallPart(tool.id, part.toolCallId, part.parameters)];
							messages.push(assistantMsg);

							// NOTE that the result of calling a function is a special content type of a USER-message
							let message = vscode.LanguageModelChatMessage.User('');
							message.content2 = [new vscode.LanguageModelChatMessageToolResultPart(part.toolCallId, result.toString())];
							messages.push(message);

							// IMPORTANT
							// IMPORTANT working around CAPI always wanting to end with a `User`-message
							// IMPORTANT
							messages.push(vscode.LanguageModelChatMessage.User(`Above is the result of calling the function ${tool.id}. The user cannot see this result, so you should explain it to the user if referencing it in your answer.`));
							didReceiveFunctionUse = true;
						}
					}

					if (didReceiveFunctionUse) {
						// RE-enter
						return runWithFunctions();
					}
				};

				await runWithFunctions();
			} catch (err) {
				handleError(err, stream);
			}

			return { metadata: { command: '' } };
		} else {
			try {

				if (!model) {
					stream.markdown('No model found.');
					return { metadata: { command: '' } };
				}

				stream.progress(`Using ${model.name} (${context.languageModelAccessInformation.canSendRequest(model)})...`);

			   let conversationUri = `conversationUri${nextConversationUriId++}`;
				let connectionUri = vscodeWrapper.activeTextEditorUri;
				if (!connectionUri) {
					stream.markdown('Please open a SQL file before asking for help.');
					return { metadata: { command: '' } };
				}

				const success = await copilotService.startConversation(conversationUri, connectionUri, prompt);
				console.log(success ? "Success" : "Failure");

				let replyText = '';
				let continuePollingMessages = true;
				while (continuePollingMessages) {
					const result = await copilotService.getNextMessage(conversationUri, replyText);

					continuePollingMessages = result.messageType !== MessageType.Complete;
					if (result.messageType === MessageType.Complete || result.messageType === MessageType.Fragment) {
						replyText = '';
						stream.markdown(result.responseText);
					} else if (result.messageType === MessageType.RequestLLM) {
						const messages = [
							vscode.LanguageModelChatMessage.User(result.responseText),
						];
						replyText = '';
						const chatResponse = await model.sendRequest(messages, {}, token);
						for await (const fragment of chatResponse.text) {
							replyText += fragment;
						}
					}
				}
				// const messages = [
				// 	vscode.LanguageModelChatMessage.User(
				// 		`You're a friendly SQL Server assistant, helping with writing database queries.`
				// 	),
				// 	vscode.LanguageModelChatMessage.User(
				// 		`Please provide help with ${prompt}.`
				// 	)
				// ];
				// const chatResponse = await model.sendRequest(messages, { modelOptions: { tools: tools} }, token);
				// for await (const fragment of chatResponse.text) {
				// 	stream.markdown(fragment);
				// }


			} catch (err) {
				handleError(err, stream);
			}

			return { metadata: { command: '' } };
		}
	};




	// 	} catch (err) {
	// 		handleError(err, stream);
	// 	}

	// 	return { metadata: { command: '' } };
	// };
	return handler;
};

/* HELPER FUNCTIONS */

function handleError(err: any, stream: vscode.ChatResponseStream): void {
	// making the chat request might fail because
	// - model does not exist
	// - user consent not given
	// - quote limits exceeded
	if (err instanceof vscode.LanguageModelError) {
		console.log(err.message, err.code);
		if (err.message.includes('off_topic')) {
			stream.markdown(vscode.l10n.t("I'm sorry, I can only explain computer science concepts."));
		}
	} else {
		// re-throw other errors so they show up in the UI
		throw err;
	}
}


// async function isFileEmpty(filePath: string): Promise<boolean> {
//   const fileUri = vscode.Uri.file(filePath);
//   const stat = await vscode.workspace.fs.stat(fileUri);
//   return stat.size === 0;
// }

// async function getFilePath() {
//   const rootPath = vscode.workspace?.workspaceFolders ? vscode.workspace?.workspaceFolders[0].uri.path : '';
//   const folderPath = path.join(rootPath, 'supabase/migrations');
//   const folderUri = vscode.Uri.file(folderPath);
//   const entries = await vscode.workspace.fs.readDirectory(folderUri);

//   // entries.forEach(([name, type]) => {
//   //   console.log(`${name} - ${type === vscode.FileType.File ? 'File' : 'Directory'}`);
//   // });

//   const filePath = path.join(folderPath, entries[entries.length - 1][0]);
//   return filePath;
// }


// // Show command
// if (request.command === 'show') {
//   stream.progress('Fetching tables...');
//   try {
//     let md = ['```json'];
//     if (prompt === 'tables' || prompt.trim() === '') {
//       let tables = undefined;
//       // let tables = await supabase.getTables();
//       if (!tables) {
//         stream.markdown('No tables found in the database.');
//         return { metadata: { command: 'show' } };
//       }
//       stream.markdown(
//         'Here are the tables in the database. You can ask for details about any table using `show [table]`.\n'
//       );
//       tables.forEach((t) => md.push(t.name));
//       md.push('```');
//       stream.markdown(md.join('\n'));
//     } else {
//       // ...
//       // const table = await supabase.getTable(prompt);
//       // if (table) {
//       //   stream.markdown('Here are details for `' + prompt + '`\n');
//       //   md.push(table);
//       //   md.push('```');
//       //   stream.markdown(md.join('\n'));
//       // } else {
//       //   stream.markdown("Can't find the table `" + prompt + '` \n');
//       // }
//     }
//   } catch (err) {
//     handleError(err, stream);
//   }

//   return { metadata: { command: 'show' } };
// } else if (request.command === 'migration') {
//   try {
//     const [model] = await vscode.lm.selectChatModels(MODEL_SELECTOR);
//     if (model) {
//       try {
//         // Create new migration file (execute supabase migration new copilot).
//         // const migrationName = `copilot`; // TODO: generate from prompt.

//         // const cmd = `${Commands.NEW_MIGRATION} ${migrationName}`;
//         // executeCommand(cmd);

//         // // Get schema context.
//         // const schema = await supabase.getSchema();

//         // const schema = "dbo";

//         // TODO: figure out how to modify the prompt to only generate valid SQL. Currently Copilot generates a markdown response.
//         // const messages = [
//         //   vscode.LanguageModelChatMessage.User(
//         //     `You're a friendly PostgreSQL assistant called Supabase Clippy, helping with writing database migrations.`
//         //   ),
//         //   vscode.LanguageModelChatMessage.User(
//         //     `Please provide help with ${prompt}. The reference database schema for question is ${schema}. IMPORTANT: Be sure you only use the tables and columns from this schema in your answer!`
//         //   )
//         // ];

//         const messages = [
//             vscode.LanguageModelChatMessage.User(
//               `You're a friendly PostgreSQL assistant called Supabase Clippy, helping with writing database migrations.`
//             )
//           ];

//         const chatResponse = await model.sendRequest(messages, {}, token);
//         let responseText = '';

//         for await (const fragment of chatResponse.text) {
//           stream.markdown(fragment);
//           responseText += fragment;
//         }

//         // Open migration file in editor.
//         let filePath = await getFilePath();
//         while (!(await isFileEmpty(filePath))) {
//           await new Promise((resolve) => setTimeout(resolve, 500));
//           filePath = await getFilePath();
//         }

//         const openPath = vscode.Uri.file(filePath);
//         const doc = await vscode.workspace.openTextDocument(openPath);
//         await vscode.window.showTextDocument(doc);
//         const textEditor = vscode.window.activeTextEditor;

//         // Extract SQL from markdown and write to migration file.
//         // const sql = extractCode(responseText);
//         const sql = "SELECT 1";

//         if (textEditor) {
//           for await (const statement of sql) {
//             await textEditor.edit((edit) => {
//               const lastLine = textEditor.document.lineAt(textEditor.document.lineCount - 1);
//               const position = new vscode.Position(lastLine.lineNumber, lastLine.text.length);
//               edit.insert(position, statement);
//             });
//           }
//           await textEditor.document.save();
//         }

//         // Render button to apply migration.
//         stream.markdown('\n\nMake sure to review the migration file before applying it!');
//         stream.button({
//           command: 'databaseProvider.db_push',
//           title: vscode.l10n.t('Apply migration.')
//         });
//       } catch (err) {
//         stream.markdown(
//           "🤔 I can't find the schema for the database. Please check that `supabase start` is running."
//         );
//       }
//     }
//   } catch (err) {
//     handleError(err, stream);
//   }

//   return { metadata: { command: 'migration' } };
// } else {

//const result = await copilotService.getNextMessage(conversationUri, replyText);
//stream.markdown(result.responseText);

// const [model] = await vscode.lm.selectChatModels(MODEL_SELECTOR);
// if (model) {
//   try {
//     // const schema = await supabase.getSchema();
//     const schema = "dbo";

//     const messages = [
//       vscode.LanguageModelChatMessage.User(
//         `You're a friendly PostgreSQL assistant called Supabase Clippy, helping with writing SQL.`
//       ),
//       vscode.LanguageModelChatMessage.User(
//         `Please provide help with ${prompt}. The reference database schema for this question is ${schema}. IMPORTANT: Be sure you only use the tables and columns from this schema in your answer.`
//       )
//     ];

//     const chatResponse = await model.sendRequest(messages, {}, token);
//     for await (const fragment of chatResponse.text) {
//       stream.markdown(fragment);
//     }
//   } catch (err) {
//     stream.markdown(
//       "🤔 I can't find the schema for the database. Please check that `supabase start` is running."
//     );
//   }
//}