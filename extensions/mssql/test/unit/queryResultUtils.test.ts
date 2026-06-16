/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import * as sinon from "sinon";
import * as vscode from "vscode";
import * as queryResultUtils from "../../src/queryResult/utils";
import * as Constants from "../../src/constants/constants";
import * as qr from "../../src/sharedInterfaces/queryResult";

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

        test("messages copy timestamp config key has correct path", () => {
            expect(Constants.configMessagesCopyIncludeTimestamps).to.equal(
                "messages.copyIncludeTimestamps",
            );
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

    suite("messageToString", () => {
        test("returns message text without timestamp by default", () => {
            const message: qr.IMessage = {
                message: "Started executing query at ",
                isError: false,
                time: "12:34:56 PM",
                link: {
                    text: "Line 1",
                },
            };

            expect(queryResultUtils.messageToString(message)).to.equal(
                "Started executing query at Line 1",
            );
        });

        test("prefixes timestamp when requested", () => {
            const message: qr.IMessage = {
                message: "Rows affected",
                isError: false,
                time: "12:34:56 PM",
            };

            expect(queryResultUtils.messageToString(message, true)).to.equal(
                "12:34:56 PM\tRows affected",
            );
        });

        test("prefixes each message line with timestamp when requested", () => {
            const message: qr.IMessage = {
                message: "First line\nSecond line",
                isError: false,
                time: "12:34:56 PM",
            };

            expect(queryResultUtils.messageToString(message, true)).to.equal(
                "12:34:56 PM\tFirst line\n12:34:56 PM\tSecond line",
            );
        });
    });
});
