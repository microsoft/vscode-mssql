/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import * as sinon from "sinon";
import * as vscode from "vscode";
import * as queryResultUtils from "../../src/queryResult/utils";
import * as Constants from "../../src/constants/constants";
import { QueryResultWebviewController } from "../../src/queryResult/queryResultWebViewController";
import * as qr from "../../src/sharedInterfaces/queryResult";
import * as sharedExecutionPlanUtils from "../../src/controllers/sharedExecutionPlanUtils";

suite("QueryResult Utils Tests", () => {
    let sandbox: sinon.SinonSandbox;

    setup(() => {
        sandbox = sinon.createSandbox();
    });

    teardown(() => {
        sandbox.restore();
    });

    suite("getInMemoryGridDataProcessingThreshold", () => {
        test("should read from the correct configuration key with mssql prefix", () => {
            const mockConfig = {
                get: sandbox.stub(),
            } as unknown as vscode.WorkspaceConfiguration;

            const getConfigurationStub = sandbox
                .stub(vscode.workspace, "getConfiguration")
                .returns(mockConfig);

            (mockConfig.get as sinon.SinonStub).returns(10000);

            queryResultUtils.getInMemoryGridDataProcessingThreshold();

            expect(getConfigurationStub).to.have.been.calledOnce;
            expect(mockConfig.get).to.have.been.calledWith(
                Constants.configInMemoryDataProcessingThreshold,
            );
            expect(Constants.configInMemoryDataProcessingThreshold).to.equal(
                "mssql.resultsGrid.inMemoryDataProcessingThreshold",
            );
        });

        test("should return custom value when configuration is set", () => {
            const customValue = 10000;
            const mockConfig = {
                get: sandbox.stub().returns(customValue),
            } as unknown as vscode.WorkspaceConfiguration;

            sandbox.stub(vscode.workspace, "getConfiguration").returns(mockConfig);

            const result = queryResultUtils.getInMemoryGridDataProcessingThreshold();

            expect(result).to.equal(customValue);
        });

        test("should return default value of 5000 when configuration is not set", () => {
            const mockConfig = {
                get: sandbox.stub().returns(undefined),
            } as unknown as vscode.WorkspaceConfiguration;

            sandbox.stub(vscode.workspace, "getConfiguration").returns(mockConfig);

            const result = queryResultUtils.getInMemoryGridDataProcessingThreshold();

            expect(result).to.equal(5000);
        });
    });

    suite("getGridSettings constants", () => {
        test("alternatingRowColors config key has correct section-relative path", () => {
            expect(Constants.configResultsGridAlternatingRowColors).to.equal(
                "resultsGrid.alternatingRowColors",
            );
        });

        test("showGridLines config key has correct path", () => {
            expect(Constants.configResultsGridShowGridLines).to.equal("resultsGrid.showGridLines");
        });

        test("rowPadding config key has correct path", () => {
            expect(Constants.configResultsGridRowPadding).to.equal("resultsGrid.rowPadding");
        });

        test("default gridSettings returns rowPadding=undefined when config is undefined", () => {
            const mockConfig = {
                get: sandbox.stub().returns(undefined),
            } as unknown as vscode.WorkspaceConfiguration;

            sandbox.stub(vscode.workspace, "getConfiguration").returns(mockConfig);

            const rowPadding = mockConfig.get(Constants.configResultsGridRowPadding) ?? undefined;
            expect(rowPadding).to.equal(undefined);
        });
    });

    suite("bucketizeRowCount", () => {
        const testCases: { value: number; expected: number }[] = [
            { value: 0, expected: 50 },
            { value: 49, expected: 50 },
            { value: 50, expected: 100 },
            { value: 99, expected: 100 },
            { value: 100, expected: 500 },
            { value: 499, expected: 500 },
            { value: 500, expected: 1000 },
            { value: 999, expected: 1000 },
            { value: 1000, expected: 5000 },
            { value: 4999, expected: 5000 },
            { value: 5000, expected: 10000 },
            { value: 12000, expected: 10000 },
        ];

        for (const { value, expected } of testCases) {
            test(`returns ${expected} for row count ${value}`, () => {
                expect(queryResultUtils.bucketizeRowCount(value)).to.equal(expected);
            });
        }
    });

    suite("registerCommonRequestHandlers", () => {
        test("registers getExecutionPlan reducer that creates graphs from query-result xml plans", async () => {
            const reducers = new Map<string, Function>();
            const executionPlanService = {};
            const controller = Object.create(QueryResultWebviewController.prototype) as {
                onRequest: sinon.SinonStub;
                onNotification: sinon.SinonStub;
                registerReducer: (name: string, reducer: Function) => void;
                executionPlanService: unknown;
                getSqlOutputContentProvider: sinon.SinonStub;
            };

            controller.onRequest = sandbox.stub();
            controller.onNotification = sandbox.stub();
            controller.getSqlOutputContentProvider = sandbox.stub();
            controller.registerReducer = (name: string, reducer: Function) => {
                reducers.set(name, reducer);
            };
            sandbox.stub(controller, "executionPlanService").get(() => executionPlanService);

            const createExecutionPlanGraphsStub = sandbox
                .stub(sharedExecutionPlanUtils, "createExecutionPlanGraphs")
                .resolves({
                    executionPlanState: {
                        executionPlanGraphs: [{ root: { cost: 1, subTreeCost: 2 } }],
                    },
                } as qr.QueryResultWebviewState);

            queryResultUtils.registerCommonRequestHandlers(
                controller as unknown as QueryResultWebviewController,
                "test-correlation-id",
            );

            const reducer = reducers.get("getExecutionPlan");
            expect(reducer).to.exist;

            const state = {
                resultSetSummaries: {},
                messages: [],
                fontSettings: {},
                executionPlanState: {
                    executionPlanGraphs: [],
                    xmlPlans: {
                        "0,0": "<ShowPlanXML />",
                    },
                },
            } as unknown as qr.QueryResultWebviewState;

            await reducer?.(state, {});

            expect(createExecutionPlanGraphsStub).to.have.been.calledOnceWithExactly(
                state,
                executionPlanService,
                ["<ShowPlanXML />"],
                "QueryResults",
            );
        });
    });
});
