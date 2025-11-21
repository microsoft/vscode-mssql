/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ApiStatus } from "./webview";

export interface ExecutionPlanWebviewState {
  executionPlanState: ExecutionPlanState;
}

export interface ExecutionPlanState {
  /**
   * The execution plan graphs returned by the tools service
   */
  executionPlanGraphs?: ExecutionPlanGraph[];
  /**
   * The total cost of the execution plan
   */
  totalCost?: number;
  loadState?: ApiStatus;
  errorMessage?: string;
  /**
   * The xml plans associated with the execution plan
   */
  xmlPlans?: Record<string, string>;
}

export interface ExecutionPlanReducers {
  /**
   * Gets the execution plan graph from the provider
   */
  getExecutionPlan: {};
  /**
   * Saves the given execution plan
   * @param sqlPlanContent the xml content to save
   */
  saveExecutionPlan: {
    sqlPlanContent: string;
  };
  /**
   * Opens the xml content of the execution plan in another editor
   * @param sqlPlanContent the xml content to show
   */
  showPlanXml: {
    sqlPlanContent: string;
  };
  /**
   * Opens the query of the execution plan in another editor
   * @param query the query to open
   */
  showQuery: {
    query: string;
  };
  /**
   * Adds a cost to the overall total cost of an execution plan
   * @param addedCost the cost to add
   */
  updateTotalCost: {
    addedCost: number;
  };
}

export interface ExecutionPlanProvider {
  /**
   * Gets the execution plan graph from the provider
   */
  getExecutionPlan(): void;

  /**
   * Handles saving the execution plan file through the vscode extension api
   * @param sqlPlanContent the xml file content of the execution plan
   */
  saveExecutionPlan(sqlPlanContent: string): void;

  /**
   * Opens the execution plan xml content in another window
   * @param sqlPlanContent the xml file content of the execution plan
   */
  showPlanXml(sqlPlanContent: string): void;

  /**
   * Opens the execution plan query in another window
   * @param sqlPlanContent the query of the execution plan
   */
  showQuery(query: string): void;

  /**
   * Adds the specified cost to the total cost of the execution plan script
   * @param addedCost the cost of the current execution plan graph
   */
  updateTotalCost(addedCost: number): void;
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
  Parallelism = 2,
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
  properties: ExecutionPlanGraphElementProperty[];
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
  Nested = 3,
}

export enum ExecutionPlanGraphElementPropertyBetterValue {
  LowerNumber = 0,
  HigherNumber = 1,
  True = 2,
  False = 3,
  None = 4,
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
  graphs: ExecutionPlanGraph[];
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
  getExecutionPlan(
    planFile: ExecutionPlanGraphInfo,
  ): Thenable<GetExecutionPlanResult>;

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

export interface InternalExecutionPlanEdge extends ExecutionPlanEdge {
  /**
   * Unique internal id given to graph edge by ADS.
   */
  id?: string;
}

export type InternalExecutionPlanElement =
  | InternalExecutionPlanEdge
  | ExecutionPlanNode;

export interface AzDataGraphCell {
  /**
   * Label for the azdata cell
   */
  label: string;
  /**
   * unique identifier for the cell
   */
  id: string;
  /**
   * icon for the cell
   */
  icon: string;
  /**
   * cost string for the cell
   */
  costDisplayString: string;
  /**
   * row count for the cell
   */
  rowCountDisplayString: string;
  /**
   * title for the cell hover tooltip
   */
  tooltipTitle: string;
  /**
   * metrics to be shown in the tooltip
   */
  metrics: AzDataGraphCellMetric[];
  /**
   * cell edges
   */
  edges: AzDataGraphCellEdge[];
  /**
   * child cells
   */
  children: AzDataGraphCell[];
  /**
   * Description to be displayed in the cell tooltip
   */
  description: string;
  badges: AzDataGraphNodeBadge[];
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
   * Time taken by the node operation in milliseconds
   */
  elapsedTimeInMs: number;
  /**
   * cost metrics for the node
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

export interface AzDataGraphNodeBadge {
  type: string;
  tooltip: string;
}

export interface AzDataGraphCellMetric {
  /**
   * name of the metric
   */
  name: string;
  /**
   * display value of the metric
   */
  value: string;
  /**
   * flag that indicates if the display property is a long string
   * long strings will be displayed at the bottom
   */
  isLongString: boolean;
}

export interface AzDataGraphCellEdge {
  /**
   * Label for the edge
   */
  label: string;
  /**
   * Unique identifier for the edge
   */
  id: string;
  /**
   * weight of the edge. This value determines the edge thickness
   */
  weight: number;
  /**
   * metrics to be shown in the edge tooltip
   */
  metrics: AzDataGraphCellMetric[];
}

export interface Point {
  x: number;
  y: number;
}

export enum SearchType {
  Equals,
  Contains,
  LesserThan,
  GreaterThan,
  GreaterThanEqualTo,
  LesserThanEqualTo,
  LesserAndGreaterThan,
}

export enum ExpensiveMetricType {
  Off = "off",
  ActualElapsedTime = "actualElapsedTime",
  ActualElapsedCpuTime = "actualElapsedCpuTime",
  Cost = "cost",
  SubtreeCost = "subtreeCost",
  ActualNumberOfRowsForAllExecutions = "actualNumberOfRowsForAllExecutions",
  NumberOfRowsRead = "numberOfRowsRead",
}

export interface SearchQuery {
  /**
   * property name to be searched
   */
  propertyName: string;
  /**
   * expected value of the property
   */
  value: string;
  /**
   * Type of search to be performed
   */
  searchType: SearchType;
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
  properties: ExecutionPlanGraphElementProperty[];
}

export interface ExecutionPlanPropertyTableItem {
  id: number;
  name: string;
  value: string;
  parent: number;
  children: number[];
  displayOrder: number;
  isExpanded: boolean;
  isChild: boolean;
  level: number;
}

export enum SortOption {
  Alphabetical,
  ReverseAlphabetical,
  Importance,
}
