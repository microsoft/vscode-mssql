/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import * as sinon from "sinon";
import { Logger2StateCommandDiagnosticsSink } from "../../src/platform/stateCommands/stateCommandLogger";
import { ILogger2 } from "../../src/models/logger2";

suite("Logger2StateCommandDiagnosticsSink Tests", () => {
    test("logs state command diagnostics to Logger2 output channel levels", () => {
        const logger = {
            info: sinon.stub(),
            warn: sinon.stub(),
            debug: sinon.stub(),
            trace: sinon.stub(),
            error: sinon.stub(),
            piiSanitized: sinon.stub(),
            show: sinon.stub(),
            withPrefix: sinon.stub(),
            dispose: sinon.stub(),
        } as unknown as sinon.SinonStubbedInstance<ILogger2>;
        const sink = new Logger2StateCommandDiagnosticsSink(logger);

        sink.emit({
            feature: "dab",
            source: "ux",
            stage: "apply_batch",
            status: "started",
            sessionId: "session-1",
            commandCount: 2,
        });
        sink.emit({
            feature: "dab",
            stage: "apply_command",
            status: "failed",
            commandType: "set_api_types",
            reason: "validation_error",
            message: "Invalid API type.",
        });
        sink.emit({
            feature: "dab",
            stage: "commit",
            status: "skipped",
            reason: "validation_error",
        });

        expect(logger.info.calledOnce).to.equal(true);
        expect(logger.info.firstCall.args[0]).to.include("feature=dab");
        expect(logger.info.firstCall.args[0]).to.include("source=ux");
        expect(logger.info.firstCall.args[0]).to.include("commandCount=2");
        expect(logger.warn.calledOnce).to.equal(true);
        expect(logger.warn.firstCall.args[0]).to.include("status=failed");
        expect(logger.warn.firstCall.args[0]).to.include("message=Invalid API type.");
        expect(logger.debug.calledOnce).to.equal(true);
        expect(logger.debug.firstCall.args[0]).to.include("status=skipped");
    });
});
