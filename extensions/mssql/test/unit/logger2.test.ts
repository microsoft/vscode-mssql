/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as sinon from "sinon";
import sinonChai from "sinon-chai";
import * as chai from "chai";
import * as vscode from "vscode";
import { expect } from "chai";
import {
    Logger2,
    logger2,
    logger2OutputChannelName,
    resetLogger2DefaultChannelForTest,
} from "../../src/models/logger2";
import * as Utils from "../../src/models/utils";

chai.use(sinonChai);

interface TestLogOutputChannel extends vscode.LogOutputChannel {
    trace: sinon.SinonStub;
    debug: sinon.SinonStub;
    info: sinon.SinonStub;
    warn: sinon.SinonStub;
    error: sinon.SinonStub;
    show: sinon.SinonStub;
    dispose: sinon.SinonStub;
}

function createChannelStub(): TestLogOutputChannel {
    return {
        name: "test",
        logLevel: vscode.LogLevel.Info,
        onDidChangeLogLevel: sinon.stub() as unknown as vscode.Event<vscode.LogLevel>,
        trace: sinon.stub(),
        debug: sinon.stub(),
        info: sinon.stub(),
        warn: sinon.stub(),
        error: sinon.stub(),
        append: sinon.stub(),
        appendLine: sinon.stub(),
        replace: sinon.stub(),
        clear: sinon.stub(),
        show: sinon.stub(),
        hide: sinon.stub(),
        dispose: sinon.stub(),
    } as unknown as TestLogOutputChannel;
}

suite("Logger2 tests", () => {
    let sandbox: sinon.SinonSandbox;

    setup(() => {
        sandbox = sinon.createSandbox();
        resetLogger2DefaultChannelForTest();
    });

    teardown(() => {
        sandbox.restore();
        resetLogger2DefaultChannelForTest();
    });

    test("global logger lazily creates and reuses the MSSQL log channel", () => {
        const channel = createChannelStub();
        const createOutputChannelStub = sandbox
            .stub(vscode.window, "createOutputChannel")
            .returns(channel);

        logger2.info("first message");
        logger2.warn("second message");

        expect(createOutputChannelStub).to.have.been.calledWithExactly(logger2OutputChannelName, {
            log: true,
        });
        expect(channel.info).to.have.been.calledWithExactly("first message");
        expect(channel.warn).to.have.been.calledWithExactly("second message");
    });

    test("withPrefix prepends the prefix to all messages", () => {
        const channel = createChannelStub();
        const prefixedLogger = Logger2.forChannel(channel).withPrefix("SchemaCompare");

        prefixedLogger.debug("operation started", { id: 42 });

        expect(channel.debug).to.have.been.calledWithExactly(
            '[SchemaCompare] operation started {"id":42}',
        );
    });

    test("forChannel uses the provided channel without creating a new one", () => {
        const channel = createChannelStub();
        const createOutputChannelStub = sandbox.stub(vscode.window, "createOutputChannel");
        const alternateLogger = Logger2.forChannel(channel, "Profiler");

        alternateLogger.error("failed", new Error("boom"));

        expect(createOutputChannelStub).to.not.have.been.called;
        expect(channel.error).to.have.been.calledWithMatch(
            sinon.match(
                (value: string) => value.includes("[Profiler] failed") && value.includes("boom"),
            ),
        );
    });

    test("forChannelName creates a log channel lazily and disposes owned channels", () => {
        const channel = createChannelStub();
        const createOutputChannelStub = sandbox
            .stub(vscode.window, "createOutputChannel")
            .returns(channel);
        const alternateLogger = Logger2.forChannelName("Custom Channel", "Custom");

        alternateLogger.trace("hello");
        alternateLogger.dispose();

        expect(createOutputChannelStub).to.have.been.calledWithExactly("Custom Channel", {
            log: true,
        });
        expect(channel.trace).to.have.been.calledWithExactly("[Custom] hello");
        expect(channel.dispose).to.have.been.called;
    });

    test("show delegates to the underlying channel", () => {
        const channel = createChannelStub();
        const logger = Logger2.forChannel(channel);

        logger.show(true);

        expect(channel.show).to.have.been.calledWithExactly(true);
    });

    test("piiSanitized logs sanitized values when pii logging is enabled", () => {
        const channel = createChannelStub();
        const logger = Logger2.forChannel(channel, "Auth");
        sandbox.stub(Utils, "getConfigPiiLogging").returns(true);

        logger.piiSanitized(
            "token refresh",
            [
                {
                    name: "account",
                    objOrArray: {
                        user: "alice",
                        token: "abcdefghijk",
                        domains: ["contoso.com"],
                    },
                },
            ],
            [{ name: "session", value: "1234567890" }],
            { correlationId: "abc" },
        );

        expect(channel.trace).to.have.been.calledWithExactly(
            '[Auth] [PII] token refresh account={"user":"alice","token":"abc...ijk"} session=123...890 {"correlationId":"abc"}',
        );
    });

    test("piiSanitized does not log when pii logging is disabled", () => {
        const channel = createChannelStub();
        const logger = Logger2.forChannel(channel);
        sandbox.stub(Utils, "getConfigPiiLogging").returns(false);

        logger.piiSanitized("secret", [], []);

        expect(channel.trace).to.not.have.been.called;
    });
});
