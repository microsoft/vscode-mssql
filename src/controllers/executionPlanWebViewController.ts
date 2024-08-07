/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { ReactWebViewPanelController } from "./reactWebviewController";
import * as ep from '../reactviews/pages/ExecutionPlan/executionPlanInterfaces';
import { AzdataGraphView } from '../reactviews/pages/ExecutionPlan/azdataGraphView';


export class ExecutionPlanWebViewController extends ReactWebViewPanelController<ep.ExecutionPlanWebViewState> {
	constructor(context: vscode.ExtensionContext,
		private _executionPlanService: ep.ExecutionPlanProvider,
		private executionPlanContents: string
	) {
		super(context, 'Execution Plan', 'executionPlan.js', 'executionPlan.css', {
		}, vscode.ViewColumn.Active, {
			dark: vscode.Uri.joinPath(context.extensionUri, 'media', 'executionPlan_inverse.svg'),
			light: vscode.Uri.joinPath(context.extensionUri, 'media', 'executionPlan.svg')
		});
		this.initialize();
	}

	private async initialize() {
		this.state.sqlPlanContent = this.executionPlanContents;
		this.registerRpcHandlers();
	}

	private registerRpcHandlers() {
		this.registerReducers({
			'getExecutionPlan': async (state, payload: {
			}) => {
				if (!this.state.executionPlan) {
					const planFile: ep.ExecutionPlanGraphInfo = {
						graphFileContent: this.executionPlanContents,
						graphFileType: '.sqlplan'
					}
					this.state.executionPlan = await this._executionPlanService.getExecutionPlan(planFile);
					this.state.executionPlanGraphs = this.state.executionPlan.graphs;
					this.state.query = this.state.executionPlanGraphs[0].query;
				}

				//document is not defined, this is a typescript environment
				const diagramContainer: HTMLElement = this.getDiagramContainer();

				// constructor: constructor(private _parentContainer: HTMLElement, private _executionPlan: ep.ExecutionPlanGraph,executionPlanDiagramName: string
				const graph = new AzdataGraphView(diagramContainer, this.state.executionPlanGraphs[0], "Diagram Name");

				graph;

				return { ...state, executionPlan: this.state.executionPlan, executionPlanGraphs: this.state.executionPlanGraphs, query: this.state.query };
			},
		});
	}

	// Example of mocking the HTMLElement for testing
	private getDiagramContainer(): HTMLElement {
		if (typeof document !== 'undefined') {
			return document.getElementById('diagramContainer') as HTMLElement;
		} else {
			// Mock HTMLElement for environments without DOM
			// Can I make this a regular div?
			return {
				tagName: 'DIV',
			} as HTMLElement;
		}
	}
}