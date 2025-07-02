/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as ep from "../../../shared/executionPlanInterfaces";

export class ExecutionPlanView {
    private _diagram: any;
    public expensiveMetricTypes: Set<ep.ExpensiveMetricType> = new Set();
    private _graphElementPropertiesSet: Set<string> = new Set();
    private _executionPlanRootNode: ep.ExecutionPlanNode;

    constructor(node: ep.ExecutionPlanNode) {
        this._executionPlanRootNode = node;
    }

    public getRoot(): ep.ExecutionPlanNode {
        return this._executionPlanRootNode;
    }

    public getTotalRelativeCost(): number {
        return this._executionPlanRootNode.cost + this._executionPlanRootNode.subTreeCost;
    }

    public getDiagram(): any {
        return this._diagram;
    }

    public setDiagram(model: any): void {
        this._diagram = model;
    }

    public populate(node: ep.ExecutionPlanNode = this._executionPlanRootNode): ep.AzDataGraphCell {
        let diagramNode: ep.AzDataGraphCell = <ep.AzDataGraphCell>{};
        diagramNode.label = node.subtext.join("\n");
        diagramNode.tooltipTitle = node.name;
        diagramNode.rowCountDisplayString = node.rowCountDisplayString;
        diagramNode.costDisplayString = node.costDisplayString;

        this.expensiveMetricTypes.add(ep.ExpensiveMetricType.Off);

        if (!node.id.toString().startsWith(`element-`)) {
            node.id = `element-${node.id}`;
        }
        diagramNode.id = node.id;

        diagramNode.icon = node.type;
        diagramNode.metrics = this.populateProperties(node.properties);

        diagramNode.badges = [];
        for (let i = 0; node.badges && i < node.badges.length; i++) {
            diagramNode.badges.push(
                this.getBadgeTypeString(node.badges[i].type) as ep.AzDataGraphNodeBadge,
            );
        }

        diagramNode.edges = this.populateEdges(node.edges);

        diagramNode.children = [];
        for (let i = 0; node.children && i < node.children.length; ++i) {
            diagramNode.children.push(this.populate(node.children[i]));
        }

        diagramNode.description = node.description;
        diagramNode.cost = node.cost;
        if (node.cost) {
            this.expensiveMetricTypes.add(ep.ExpensiveMetricType.Cost);
        }

        diagramNode.subTreeCost = node.subTreeCost;
        if (node.subTreeCost) {
            this.expensiveMetricTypes.add(ep.ExpensiveMetricType.SubtreeCost);
        }

        diagramNode.relativeCost = node.relativeCost;
        diagramNode.elapsedTimeInMs = node.elapsedTimeInMs;
        if (node.elapsedTimeInMs) {
            this.expensiveMetricTypes.add(ep.ExpensiveMetricType.ActualElapsedTime);
        }

        let costMetrics = [];
        for (let i = 0; node.costMetrics && i < node.costMetrics.length; ++i) {
            costMetrics.push(node.costMetrics[i]);

            this.loadMetricTypesFromCostMetrics(node.costMetrics[i].name);
        }
        diagramNode.costMetrics = costMetrics;

        return diagramNode;
    }

    private loadMetricTypesFromCostMetrics(costMetricName: string): void {
        if (costMetricName === "ElapsedCpuTime") {
            this.expensiveMetricTypes.add(ep.ExpensiveMetricType.ActualElapsedCpuTime);
        } else if (costMetricName === "EstimateRowsAllExecs" || costMetricName === "ActualRows") {
            this.expensiveMetricTypes.add(
                ep.ExpensiveMetricType.ActualNumberOfRowsForAllExecutions,
            );
        } else if (costMetricName === "EstimatedRowsRead" || costMetricName === "ActualRowsRead") {
            this.expensiveMetricTypes.add(ep.ExpensiveMetricType.NumberOfRowsRead);
        }
    }

    private getBadgeTypeString(badgeType: ep.BadgeType):
        | {
              type: string;
              tooltip: string;
          }
        | undefined {
        /**
         * TODO: Need to figure out if tooltip have to be removed. For now, they are empty
         */
        switch (badgeType) {
            case ep.BadgeType.Warning:
                return {
                    type: "warning",
                    tooltip: "",
                };
            case ep.BadgeType.CriticalWarning:
                return {
                    type: "criticalWarning",
                    tooltip: "",
                };
            case ep.BadgeType.Parallelism:
                return {
                    type: "parallelism",
                    tooltip: "",
                };
            default:
                return undefined;
        }
    }

    private populateProperties(
        props: ep.ExecutionPlanGraphElementProperty[] | undefined,
    ): ep.AzDataGraphCellMetric[] {
        if (!props) {
            return [];
        }

        props.forEach((p) => {
            this._graphElementPropertiesSet.add(p.name);
        });

        return props
            .filter((e) => typeof e.displayValue === "string" && e.showInTooltip)
            .sort((a, b) => a.displayOrder - b.displayOrder)
            .map((e) => {
                return {
                    name: e.name,
                    value: e.displayValue,
                    isLongString: e.positionAtBottom,
                };
            });
    }

    private populateEdges(
        edges: ep.InternalExecutionPlanEdge[] | undefined,
    ): ep.AzDataGraphCellEdge[] {
        if (!edges) {
            return [];
        }

        return edges.map((e) => {
            e.id = this.createGraphElementId();
            return {
                id: e.id,
                metrics: this.populateProperties(e.properties),
                weight: Math.max(0.5, Math.min(0.5 + 0.75 * Math.log10(e.rowCount), 6)),
                label: "",
            };
        });
    }

    private createGraphElementId(): string {
        return `element-${window.crypto.randomUUID()}`;
    }

    /**
     * Gets a list of unique properties of the graph elements.
     */
    public getUniqueElementProperties(): string[] {
        return [...this._graphElementPropertiesSet].sort();
    }

    /**
     * Enables/Disables the graph tooltips
     * @returns state of the tooltip after toggling
     */
    public toggleTooltip(): boolean {
        this._diagram.showTooltip(!this._diagram.graph.showTooltip);
        return this._diagram.graph.showTooltip;
    }

    public drawSubtreePolygon(subtreeRoot: string, fillColor: string, borderColor: string): void {
        const drawPolygon = this._diagram.graph.model.getCell(`element-${subtreeRoot}`);
        this._diagram.drawPolygon(drawPolygon, fillColor, borderColor);
    }

    public clearSubtreePolygon(): void {
        this._diagram.removeDrawnPolygons();
    }

    public disableNodeCollapse(disable: boolean): void {
        this._diagram.disableNodeCollapse(disable);
    }

    /**
     * Returns the currently selected graph element.
     */
    public getSelectedElement(): ep.InternalExecutionPlanElement | undefined {
        const cell = this._diagram.graph.getSelectionCell();
        if (cell?.id) {
            return this.getElementById(cell.id);
        }

        return undefined;
    }

    /**
     * Zooms in to the diagram.
     */
    public zoomIn(): void {
        this._diagram.zoomIn();
    }

    /**
     * Zooms out of the diagram
     */
    public zoomOut(): void {
        this._diagram.zoomOut();
    }

    /**
     * Fits the diagram into the parent container size.
     */
    public zoomToFit(): void {
        this._diagram.zoomToFit();
        if (this.getZoomLevel() > 200) {
            this.setZoomLevel(200);
        }
    }

    /**
     * Gets the current zoom level of the diagram.
     */
    public getZoomLevel(): number {
        return this._diagram.graph.view.getScale() * 100;
    }

    /**
     * Sets the zoom level of the diagram
     * @param level The scale factor to be be applied to the diagram.
     */
    public setZoomLevel(level: number): void {
        if (level < 1) {
            throw new Error("Zoom level cannot be 0 or negative");
        }

        this._diagram.zoomTo(level);
    }

    /**
     * Searches the diagram nodes based on the search query provided.
     */
    public searchNodes(searchQuery: ep.SearchQuery): ep.ExecutionPlanNode[] {
        const resultNodes: ep.ExecutionPlanNode[] = [];

        const nodeStack: ep.ExecutionPlanNode[] = [];
        nodeStack.push(this._executionPlanRootNode);

        while (nodeStack.length !== 0) {
            const currentNode = nodeStack.pop()!;

            const matchingProp = currentNode.properties.find(
                (e) => e.name === searchQuery.propertyName,
            );
            let matchFound = false;
            // Searching only properties with string value.
            if (typeof matchingProp?.value === "string") {
                // If the search type is '=' we look for exact match and for 'contains' we look search string occurrences in prop value
                switch (searchQuery.searchType) {
                    case ep.SearchType.Equals:
                        matchFound = matchingProp.value === searchQuery.value;
                        break;
                    case ep.SearchType.Contains:
                        matchFound = matchingProp.value.includes(searchQuery.value);
                        break;
                    case ep.SearchType.GreaterThan:
                        matchFound = matchingProp.value > searchQuery.value;
                        break;
                    case ep.SearchType.LesserThan:
                        matchFound = matchingProp.value < searchQuery.value;
                        break;
                    case ep.SearchType.GreaterThanEqualTo:
                        matchFound = matchingProp.value >= searchQuery.value;
                        break;
                    case ep.SearchType.LesserThanEqualTo:
                        matchFound = matchingProp.value <= searchQuery.value;
                        break;
                    case ep.SearchType.LesserAndGreaterThan:
                        matchFound =
                            matchingProp.value < searchQuery.value ||
                            matchingProp.value > searchQuery.value;
                        break;
                }

                if (matchFound) {
                    resultNodes.push(currentNode);
                }
            }

            nodeStack.push(...currentNode.children);
        }

        return resultNodes;
    }

    /**
     * Brings a graph element to the center of the parent view.
     * @param node Node to be brought into the center
     */
    public centerElement(node: ep.InternalExecutionPlanElement): void {
        /**
         * The selected graph node might be hidden/partially visible if the graph is overflowing the parent container.
         * Apart from the obvious problems in aesthetics, user do not get a proper feedback of the search result.
         * To solve this problem, we will have to scroll the node into view. (preferably into the center of the view)
         * Steps for that:
         *  1. Get the bounding rect of the node on graph.
         *  2. Get the midpoint of the node's bounding rect.
         *  3. Find the dimensions of the parent container.
         *  4. Since, we are trying to position the node into center, we set the left top corner position of parent to
         *     below x and y.
         *  x =	node's x midpoint - half the width of parent container
         *  y = node's y midpoint - half the height of parent container
         * 	5. If the x and y are negative, we set them 0 as that is the minimum possible scroll position.
         *  6. Smoothly scroll to the left top x and y calculated in step 4, 5.
         */

        if (!node) {
            return;
        }
        const cell = this._diagram.graph.model.getCell(node.id);
        if (!cell) {
            return;
        }

        const cellRect = this._diagram.graph.getCellBounds(cell);

        const cellMidPoint: ep.Point = {
            x: cellRect.x + cellRect.width / 2,
            y: cellRect.y + cellRect.height / 2,
        };

        const graphContainer = <HTMLElement>this._diagram.graph.container;

        const diagramContainerRect = graphContainer.getBoundingClientRect();

        const leftTopScrollPoint: ep.Point = {
            x: cellMidPoint.x - diagramContainerRect.width / 2,
            y: cellMidPoint.y - diagramContainerRect.height / 2,
        };

        leftTopScrollPoint.x = leftTopScrollPoint.x < 0 ? 0 : leftTopScrollPoint.x;
        leftTopScrollPoint.y = leftTopScrollPoint.y < 0 ? 0 : leftTopScrollPoint.y;

        graphContainer.scrollTo({
            left: leftTopScrollPoint.x,
            top: leftTopScrollPoint.y,
            behavior: "smooth",
        });
    }

    /**
     * Selects an execution plan node/edge in the graph diagram.
     * @param element  Element to be selected
     * @param bringToCenter Check if the selected element has to be brought into the center of this view
     */
    public selectElement(
        element: ep.InternalExecutionPlanElement | undefined,
        bringToCenter: boolean = false,
    ): void {
        let cell;
        if (element) {
            cell = this._diagram.graph.model.getCell(element.id);
        } else {
            cell = this._diagram.graph.model.getCell(
                (<ep.ExecutionPlanNode>this._executionPlanRootNode).id,
            );
        }

        this._diagram.graph.getSelectionModel().setCell(cell);

        if (bringToCenter) {
            this.centerElement(element!);
        }
    }

    public clearExpensiveOperatorHighlighting(): void {
        this._diagram.clearExpensiveOperatorHighlighting();
    }

    public highlightExpensiveOperator(
        predicate: (cell: ep.AzDataGraphCell) => number | undefined,
    ): string {
        return this._diagram.highlightExpensiveOperator(predicate);
    }

    /**
     * Get the diagram element by its id
     * @param id id of the diagram element
     */
    public getElementById(id: string): ep.InternalExecutionPlanElement | undefined {
        const nodeStack: ep.ExecutionPlanNode[] = [];
        nodeStack.push(this._executionPlanRootNode);

        while (nodeStack.length !== 0) {
            const currentNode = nodeStack.pop()!;
            if (currentNode.id === id) {
                return currentNode;
            }

            if (currentNode.edges) {
                for (let i = 0; i < currentNode.edges.length; i++) {
                    if ((<ep.InternalExecutionPlanEdge>currentNode.edges[i]).id === id) {
                        return currentNode.edges[i];
                    }
                }
            }

            nodeStack.push(...currentNode.children);
        }

        return undefined;
    }

    public calculateRelativeQueryCost(): number {
        return this._executionPlanRootNode.subTreeCost + this._executionPlanRootNode.cost;
    }
}
