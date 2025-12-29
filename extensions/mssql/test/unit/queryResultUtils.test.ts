/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import * as sinon from "sinon";
import * as vscode from "vscode";
import * as queryResultUtils from "../../src/queryResult/utils";
import * as Constants from "../../src/constants/constants";

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
});
