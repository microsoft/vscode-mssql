/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import * as chai from "chai";
import * as sinon from "sinon";
import sinonChai from "sinon-chai";
import * as vscode from "vscode";
import * as queryResultUtils from "../../src/queryResult/utils";
import * as Constants from "../../src/constants/constants";
import * as qr from "../../src/sharedInterfaces/queryResult";
import { getPreviewConfigKey, PreviewFeature } from "../../src/previews/previewService";
import { TelemetryActions, TelemetryViews } from "../../src/sharedInterfaces/telemetry";
import { stubPreviewService, stubTelemetry } from "./utils";

chai.use(sinonChai);

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

    suite("toggleResultsGridMode request handler", () => {
        const betaGridConfigKey = getPreviewConfigKey(PreviewFeature.BetaResultsGrid);
        const correlationId = "test-correlation-id";

        /**
         * Registers the common request handlers against a stand-in controller and returns the
         * captured toggle handler along with the config `update` stub it writes through.
         */
        function registerHandlers(updateBehavior?: (stub: sinon.SinonStub) => void): {
            invokeToggle: (params?: qr.ToggleResultsGridModeParams) => Promise<void>;
            update: sinon.SinonStub;
            setGridModeChangeReportedBySwitch: sinon.SinonStub;
        } {
            const handlers = new Map<
                string,
                (params?: qr.ToggleResultsGridModeParams) => Promise<void>
            >();
            const update = sandbox.stub().resolves();
            updateBehavior?.(update);

            sandbox.stub(vscode.workspace, "getConfiguration").returns({
                get: sandbox.stub(),
                update,
            } as unknown as vscode.WorkspaceConfiguration);

            const setGridModeChangeReportedBySwitch = sandbox.stub();

            const controller = {
                onRequest: sandbox
                    .stub()
                    .callsFake(
                        (
                            type: { method: string },
                            handler: (params?: qr.ToggleResultsGridModeParams) => Promise<void>,
                        ) => {
                            handlers.set(type.method, handler);
                        },
                    ),
                onNotification: sandbox.stub(),
                registerReducer: sandbox.stub(),
                getQueryResultWebviewViewController: sandbox
                    .stub()
                    .returns({ setGridModeChangeReportedBySwitch }),
            };

            queryResultUtils.registerCommonRequestHandlers(
                controller as unknown as Parameters<
                    typeof queryResultUtils.registerCommonRequestHandlers
                >[0],
                correlationId,
            );

            const handler = handlers.get(qr.ToggleResultsGridModeRequest.type.method);
            expect(handler, "toggle handler should be registered").to.not.be.undefined;

            return {
                invokeToggle: (params?) => handler!(params),
                update,
                setGridModeChangeReportedBySwitch,
            };
        }

        test("turns the beta grid off when it is currently enabled", async () => {
            stubTelemetry(sandbox);
            stubPreviewService(sandbox, { [PreviewFeature.BetaResultsGrid]: true });

            const { invokeToggle, update } = registerHandlers();
            await invokeToggle();

            expect(update).to.have.been.calledOnceWithExactly(
                betaGridConfigKey,
                false,
                vscode.ConfigurationTarget.Global,
            );
        });

        test("turns the beta grid on when the setting is unset and experimental features are off", async () => {
            // The preview setting falls back to the global experimental flag when unset, so the
            // toggle must negate the effective value rather than the stored one.
            stubTelemetry(sandbox);
            stubPreviewService(sandbox, {}, false);

            const { invokeToggle, update } = registerHandlers();
            await invokeToggle();

            expect(update).to.have.been.calledOnceWithExactly(
                betaGridConfigKey,
                true,
                vscode.ConfigurationTarget.Global,
            );
        });

        test("sends telemetry describing the mode being switched to", async () => {
            const { sendActionEvent } = stubTelemetry(sandbox);
            stubPreviewService(sandbox, { [PreviewFeature.BetaResultsGrid]: true });

            const { invokeToggle } = registerHandlers();
            await invokeToggle();

            expect(sendActionEvent).to.have.been.calledOnceWithExactly(
                TelemetryViews.QueryResult,
                TelemetryActions.ToggleResultsGridMode,
                {
                    correlationId: correlationId,
                    newMode: "classic",
                    source: "resultsPaneSwitch",
                    // The stand-in controller is not a QueryResultWebviewController, so the
                    // handler reports it as a tab-hosted view.
                    webviewLocation: "document",
                },
                {},
            );
        });

        test("claims the configuration change so the listener does not double count it", async () => {
            stubTelemetry(sandbox);
            stubPreviewService(sandbox, { [PreviewFeature.BetaResultsGrid]: true });

            const { invokeToggle, setGridModeChangeReportedBySwitch } = registerHandlers();
            await invokeToggle();

            expect(setGridModeChangeReportedBySwitch).to.have.been.calledOnceWithExactly(true);
        });

        test("releases the claim when writing the configuration fails", async () => {
            stubTelemetry(sandbox);
            stubPreviewService(sandbox, { [PreviewFeature.BetaResultsGrid]: true });

            const { invokeToggle, setGridModeChangeReportedBySwitch } = registerHandlers((stub) =>
                stub.rejects(new Error("write failed")),
            );

            // The listener never fires for a failed write, so a stale claim would swallow the
            // telemetry for the next genuine settings-driven change.
            try {
                await invokeToggle();
                expect.fail("expected the failed configuration write to propagate");
            } catch (error) {
                expect((error as Error).message).to.equal("write failed");
            }

            expect(setGridModeChangeReportedBySwitch.secondCall).to.have.been.calledWithExactly(
                false,
            );
        });

        test("reports the on-screen result set size, bucketized", async () => {
            const { sendActionEvent } = stubTelemetry(sandbox);
            stubPreviewService(sandbox, { [PreviewFeature.BetaResultsGrid]: true });

            const { invokeToggle } = registerHandlers();
            await invokeToggle({ gridCount: 3, rowCount: 1234 });

            expect(sendActionEvent.firstCall.args[3]).to.deep.equal({
                gridCount: 3,
                rowCount: queryResultUtils.bucketizeRowCount(1234),
            });
        });

        test("omits result set measurements when the webview does not report them", async () => {
            const { sendActionEvent } = stubTelemetry(sandbox);
            stubPreviewService(sandbox, { [PreviewFeature.BetaResultsGrid]: true });

            const { invokeToggle } = registerHandlers();
            await invokeToggle({});

            expect(sendActionEvent.firstCall.args[3]).to.deep.equal({});
        });
    });
});
