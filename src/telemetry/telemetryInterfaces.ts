/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export enum TelemetryViews {
	ObjectExplorer = 'ObjectExplorer',
	CommandPallet = 'CommandPallet',
	SqlProjects = 'SqlProjects',
	QueryEditor = 'QueryEditor',
	ResultsGrid = 'ResultsGrid',
	ConnectionPrompt = 'ConnectionPrompt'
}

export enum TelemetryActions {
	GenerateScript = 'GenerateScript',
	Refresh = 'Refresh',
	CreateProject = 'CreateProject',
	RemoveConnection = 'RemoveConnection',
	Disconnect = 'Disconnect',
	NewQuery = 'NewQuery',
	RunQuery = 'RunQuery',
	QueryExecutionCompleted = 'QueryExecutionCompleted',
	RunResultPaneAction = 'RunResultPaneAction',
	CreateConnection = 'CreateConnection',
	CreateConnectionResult = 'CreateConnectionResult',
	ExpandNode = 'ExpandNode',
	ResultPaneAction = 'ResultPaneAction'
}
