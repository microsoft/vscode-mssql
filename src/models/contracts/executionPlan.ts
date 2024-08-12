import * as ep from '../../reactviews/pages/ExecutionPlan/executionPlanInterfaces';
import { RequestType } from 'vscode-languageclient';

export interface GetExecutionPlanParams {
	graphInfo: ep.ExecutionPlanGraphInfo,
}

export namespace GetExecutionPlanRequest {
	export const type = new RequestType<GetExecutionPlanParams, ep.GetExecutionPlanResult, void, void>('queryExecutionPlan/getExecutionPlan');
}

export interface ExecutionPlanComparisonParams {
	firstExecutionPlanGraphInfo: ep.ExecutionPlanGraphInfo;
	secondExecutionPlanGraphInfo: ep.ExecutionPlanGraphInfo;
}

export namespace ExecutionPlanComparisonRequest {
	export const type = new RequestType<ExecutionPlanComparisonParams, ep.ExecutionPlanComparisonResult, void, void>('queryExecutionPlan/compareExecutionPlanGraph');
}