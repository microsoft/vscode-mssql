import * as ep from './executionPlanInterfaces';

export class ExecutionPlanView {
	private _diagram: any;
	// private _diagramModel: ep.AzDataGraphCell;
	// private _cellInFocus: ep.AzDataGraphCell;
	public expensiveMetricTypes: Set<ep.ExpensiveMetricType> = new Set();
	private _graphElementPropertiesSet: Set<string> = new Set();
	private executionPlanRootNode: ep.ExecutionPlanNode;

	constructor(node: ep.ExecutionPlanNode) {
		this.executionPlanRootNode = node;
	}

	public getRoot(): ep.ExecutionPlanNode {
		return this.executionPlanRootNode;
	}

	public populate(node: ep.ExecutionPlanNode = this.executionPlanRootNode): ep.AzDataGraphCell {
		let diagramNode: ep.AzDataGraphCell = <ep.AzDataGraphCell>{};
		diagramNode.label = node.subtext.join('\n');
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
			diagramNode.badges.push((this.getBadgeTypeString(node.badges[i].type)) as ep.AzDataGraphNodeBadge);
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
		if (costMetricName === 'ElapsedCpuTime') {
			this.expensiveMetricTypes.add(ep.ExpensiveMetricType.ActualElapsedCpuTime);
		}
		else if (costMetricName === 'EstimateRowsAllExecs' || costMetricName === 'ActualRows') {
			this.expensiveMetricTypes.add(ep.ExpensiveMetricType.ActualNumberOfRowsForAllExecutions);
		}
		else if (costMetricName === 'EstimatedRowsRead' || costMetricName === 'ActualRowsRead') {
			this.expensiveMetricTypes.add(ep.ExpensiveMetricType.NumberOfRowsRead);
		}
	}

	private getBadgeTypeString(badgeType: ep.BadgeType): {
		type: string,
		tooltip: string
	} | undefined {
		/**
		 * TODO: Need to figure out if tooltip have to be removed. For now, they are empty
		 */
		switch (badgeType) {
			case ep.BadgeType.Warning:
				return {
					type: 'warning',
					tooltip: ''
				};
			case ep.BadgeType.CriticalWarning:
				return {
					type: 'criticalWarning',
					tooltip: ''
				};
			case ep.BadgeType.Parallelism:
				return {
					type: 'parallelism',
					tooltip: ''
				};
			default:
				return undefined;
		}
	}

	private populateProperties(props: ep.ExecutionPlanGraphElementProperty[] | undefined): ep.AzDataGraphCellMetric[] {
		if (!props) {
			return [];
		}

		props.forEach(p => {
			this._graphElementPropertiesSet.add(p.name);
		});

		return props.filter(e => (typeof e.displayValue === 'string') && e.showInTooltip)
			.sort((a, b) => a.displayOrder - b.displayOrder)
			.map(e => {
				return {
					name: e.name,
					value: e.displayValue,
					isLongString: e.positionAtBottom
				};
			});
	}

	private populateEdges(edges: ep.InternalExecutionPlanEdge[] | undefined): ep.AzDataGraphCellEdge[] {
		if (!edges) {
			return [];
		}

		return edges.map(e => {
			e.id = this.createGraphElementId();
			return {
				id: e.id,
				metrics: this.populateProperties(e.properties),
				weight: Math.max(0.5, Math.min(0.5 + 0.75 * Math.log10(e.rowCount), 6)),
				label: ''
			};
		});
	}

	private createGraphElementId(): string {
		return `element-${this.getNonce()}`;
	}

	private getNonce(): string {
		let text = "";
		const possible = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
		for (let i = 0; i < 32; i++) {
			text += possible.charAt(Math.floor(Math.random() * possible.length));
		}
		return text;
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
}