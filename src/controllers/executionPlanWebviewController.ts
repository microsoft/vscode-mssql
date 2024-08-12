import * as vscode from 'vscode';
import { ReactWebViewPanelController } from "./reactWebviewController";
import * as ep from '../reactviews/pages/ExecutionPlan/executionPlanInterfaces';
import { WebviewRoute } from '../sharedInterfaces/webviewRoutes';

export class ExecutionPlanWebViewController extends ReactWebViewPanelController<ep.ExecutionPlanWebViewState, ep.ExecutionPlanReducers> {
	constructor(context: vscode.ExtensionContext,
		private _executionPlanService: ep.ExecutionPlanService,
		private executionPlanContents: string
	) {
		super(context, 'Execution Plan', WebviewRoute.executionPlan, {},
			vscode.ViewColumn.Active, {
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
		this.registerReducer('getExecutionPlan', async (state, payload) => {
			if (!this.state.executionPlan) {
				const planFile: ep.ExecutionPlanGraphInfo = {
					graphFileContent: this.executionPlanContents ?? payload.sqlPlanContent,
					graphFileType: '.sqlplan'
				}
				this.state.executionPlan = await this._executionPlanService.getExecutionPlan(planFile);
				this.state.executionPlanGraphs = this.state.executionPlan.graphs;
				this.state.query = this.state.executionPlanGraphs[0].query;
			}

			return { ...state, executionPlan: this.state.executionPlan, executionPlanGraphs: this.state.executionPlanGraphs, query: this.state.query };
		});
	}
}