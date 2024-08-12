/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export interface ExecutionPlanWebViewState {
	query?: string;
	sqlPlanContent?: string;
	executionPlan?: GetExecutionPlanResult;
	executionPlanGraphs?: ExecutionPlanGraph[];
}

export interface ExecutionPlanReducers {
	getExecutionPlan: {
		sqlPlanContent: string,
	}
}

export interface ExecutionPlanGraph {
	/**
	 * Root of the execution plan tree
	 */
	root: ExecutionPlanNode;
	/**
	 * Underlying query for the execution plan graph.
	 */
	query: string;
	/**
	 * String representation of graph
	 */
	graphFile: ExecutionPlanGraphInfo;
	/**
	 * Query recommendations for optimizing performance
	 */
	recommendations: ExecutionPlanRecommendations[];
}

export interface ExecutionPlanNode {
	/**
	 * Unique id given to node by the provider
	 */
	id: string;
	/**
	 * Type of the node. This property determines the icon that is displayed for it
	 */
	type: string;
	/**
	 * Cost associated with the node
	 */
	cost: number;
	/**
	 * Cost of the node subtree
	 */
	subTreeCost: number;
	/**
	 * Relative cost of the node compared to its siblings.
	 */
	relativeCost: number;
	/**
	 * Time take by the node operation in milliseconds
	 */
	elapsedTimeInMs: number;
	/**
	 * CPU time taken by the node operation in milliseconds
	 */
	elapsedCpuTimeInMs: number;
	/**
	 * Node properties to be shown in the tooltip
	 */
	properties: ExecutionPlanGraphElementProperty[];
	/**
	 * Display name for the node
	 */
	name: string;
	/**
	 * Description associated with the node.
	 */
	description: string;
	/**
	 * Subtext displayed under the node name
	 */
	subtext: string[];
	/**
	 * Direct children of the nodes.
	 */
	children: ExecutionPlanNode[];
	/**
	 * Edges corresponding to the children.
	 */
	edges: ExecutionPlanEdge[];
	/**
	 * Warning/parallelism badges applicable to the current node
	 */
	badges: ExecutionPlanBadge[];
	/**
	 * Data to show in top operations table for the node.
	 */
	// topOperationsData: TopOperationsDataItem[];
	/**
	 * Output row count associated with the node
	 */
	rowCountDisplayString: string;
	/**
	 * Cost string for the node
	 */
	costDisplayString: string;
	/**
	 * Cost metrics for the node
	 */
	costMetrics: CostMetric[];
}

export interface CostMetric {
	/**
	 * Name of the cost metric.
	 */
	name: string;
	/**
	 * The value of the cost metric
	 */
	value: number | undefined;
}

export interface ExecutionPlanBadge {
	/**
	 * Type of the node overlay. This determines the icon that is displayed for it
	 */
	type: BadgeType;
	/**
	 * Text to display for the overlay tooltip
	 */
	tooltip: string;
}

export enum BadgeType {
	Warning = 0,
	CriticalWarning = 1,
	Parallelism = 2
}

export interface ExecutionPlanEdge {
	/**
	 * Count of the rows returned by the subtree of the edge.
	 */
	rowCount: number;
	/**
	 * Size of the rows returned by the subtree of the edge.
	 */
	rowSize: number;
	/**
	 * Edge properties to be shown in the tooltip.
	 */
	properties: ExecutionPlanGraphElementProperty[]
}

export interface ExecutionPlanGraphElementProperty {
	/**
	 * Name of the property
	 */
	name: string;
	/**
	 * value for the property
	 */
	value: string | ExecutionPlanGraphElementProperty[];
	/**
	 * Flag to show/hide props in tooltip
	 */
	showInTooltip: boolean;
	/**
	 * Display order of property
	 */
	displayOrder: number;
	/**
	 *  Flag to indicate if the property has a longer value so that it will be shown at the bottom of the tooltip
	 */
	positionAtBottom: boolean;
	/**
	 * Display value of property to show in tooltip and other UI element.
	 */
	displayValue: string;
	/**
	 * Data type of the property value
	 */
	dataType: ExecutionPlanGraphElementPropertyDataType;
	/**
	 * Indicates which value is better when 2 similar properties are compared.
	 */
	betterValue: ExecutionPlanGraphElementPropertyBetterValue;
}

export enum ExecutionPlanGraphElementPropertyDataType {
	Number = 0,
	String = 1,
	Boolean = 2,
	Nested = 3
}

export enum ExecutionPlanGraphElementPropertyBetterValue {
	LowerNumber = 0,
	HigherNumber = 1,
	True = 2,
	False = 3,
	None = 4
}

export interface ExecutionPlanRecommendations {
	/**
	 * Text displayed in the show plan graph control description
	 */
	displayString: string;
	/**
	 * Query that is recommended to the user
	 */
	queryText: string;
	/**
	 * Query that will be opened in a new file once the user click on the recommendation
	 */
	queryWithDescription: string;
}

export interface ExecutionPlanGraphInfo {
	/**
	 * File contents
	 */
	graphFileContent: string;
	/**
	 * File type for execution plan. This will be the file type of the editor when the user opens the graph file
	 */
	graphFileType: string;
	/**
	 * Index of the execution plan in the file content
	 */
	planIndexInFile?: number;
}

export interface GetExecutionPlanResult extends ResultStatus {
	graphs: ExecutionPlanGraph[]
}

export interface ExecutionGraphComparisonResult {
	/**
	 * The base ExecutionPlanNode for the ExecutionGraphComparisonResult.
	 */
	baseNode: ExecutionPlanNode;
	/**
	 * The children of the ExecutionGraphComparisonResult.
	 */
	children: ExecutionGraphComparisonResult[];
	/**
	 * The group index of the ExecutionGraphComparisonResult.
	 */
	groupIndex: number;
	/**
	 * Flag to indicate if the ExecutionGraphComparisonResult has a matching node in the compared execution plan.
	 */
	hasMatch: boolean;
	/**
	 * List of matching nodes for the ExecutionGraphComparisonResult.
	 */
	matchingNodesId: number[];
	/**
	 * The parent of the ExecutionGraphComparisonResult.
	 */
	parentNode: ExecutionGraphComparisonResult;
}

export interface ExecutionPlanComparisonResult extends ResultStatus {
	firstComparisonResult: ExecutionGraphComparisonResult;
	secondComparisonResult: ExecutionGraphComparisonResult;
}

export interface IsExecutionPlanResult {
	isExecutionPlan: boolean;
	queryExecutionPlanFileExtension: string;
}

export interface ExecutionPlanService {
	// execution plan service methods

	/**
	 * Gets the execution plan graph from the provider for a given plan file
	 * @param planFile file that contains the execution plan
	 */
	getExecutionPlan(planFile: ExecutionPlanGraphInfo): Thenable<GetExecutionPlanResult>;
	// /**
	//  * Compares two execution plans and identifies matching regions in both execution plans.
	//  * @param firstPlanFile file that contains the first execution plan.
	//  * @param secondPlanFile file that contains the second execution plan.
	//  */
	// compareExecutionPlanGraph(firstPlanFile: ExecutionPlanGraphInfo, secondPlanFile: ExecutionPlanGraphInfo): Thenable<ExecutionPlanComparisonResult>;
	/**
	 * Determines if the provided value is an execution plan and returns the appropriate file extension.
	 * @param value String that needs to be checked.
	 */
// 	isExecutionPlan(value: string): Thenable<IsExecutionPlanResult>;
}

export interface ResultStatus {
	success: boolean;
	errorMessage: string;
}