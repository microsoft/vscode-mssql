/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import * as sinon from "sinon";
import * as telemetry from "../../../src/telemetry/telemetry";
import { TelemetryViews, TelemetryActions } from "../../../src/sharedInterfaces/telemetry";
import {
    ProfilerErrorCategory,
    CloseWarningUserAction,
    categorizeError,
    ProfilerTelemetry,
} from "../../../src/profiler/profilerTelemetry";
import { FilterOperator } from "../../../src/profiler/profilerTypes";

suite("ProfilerTelemetry Tests", () => {
    let sandbox: sinon.SinonSandbox;
    let sendActionEventStub: sinon.SinonStub;

    setup(() => {
        sandbox = sinon.createSandbox();
        sendActionEventStub = sandbox.stub(telemetry, "sendActionEvent");
    });

    teardown(() => {
        sandbox.restore();
    });

    // ================================================================
    // Enum value tests
    // ================================================================

    suite("ProfilerErrorCategory", () => {
        test("has expected values", () => {
            expect(ProfilerErrorCategory.PermissionDenied).to.equal("PermissionDenied");
            expect(ProfilerErrorCategory.AzureUnsupported).to.equal("AzureUnsupported");
            expect(ProfilerErrorCategory.BufferConfigError).to.equal("BufferConfigError");
            expect(ProfilerErrorCategory.XelFileError).to.equal("XelFileError");
            expect(ProfilerErrorCategory.Unknown).to.equal("Unknown");
        });
    });

    suite("CloseWarningUserAction", () => {
        test("has expected values", () => {
            expect(CloseWarningUserAction.Saved).to.equal("Saved");
            expect(CloseWarningUserAction.Discarded).to.equal("Discarded");
            expect(CloseWarningUserAction.Cancelled).to.equal("Cancelled");
        });
    });

    // ================================================================
    // categorizeError tests
    // ================================================================

    suite("categorizeError", () => {
        test("classifies permission errors", () => {
            expect(categorizeError("Permission denied on server")).to.equal(
                ProfilerErrorCategory.PermissionDenied,
            );
            expect(categorizeError("Access denied for user")).to.equal(
                ProfilerErrorCategory.PermissionDenied,
            );
            expect(categorizeError("Request was unauthorized")).to.equal(
                ProfilerErrorCategory.PermissionDenied,
            );
            expect(categorizeError("Permission to run profiler")).to.equal(
                ProfilerErrorCategory.PermissionDenied,
            );
        });

        test("classifies Azure unsupported errors", () => {
            expect(categorizeError("This feature is not supported on Azure")).to.equal(
                ProfilerErrorCategory.AzureUnsupported,
            );
            expect(categorizeError("Unsupported on this edition")).to.equal(
                ProfilerErrorCategory.AzureUnsupported,
            );
            expect(categorizeError("Feature not available")).to.equal(
                ProfilerErrorCategory.AzureUnsupported,
            );
        });

        test("classifies buffer config errors", () => {
            expect(categorizeError("ring_buffer memory exceeded")).to.equal(
                ProfilerErrorCategory.BufferConfigError,
            );
            expect(categorizeError("Buffer capacity too small")).to.equal(
                ProfilerErrorCategory.BufferConfigError,
            );
            expect(categorizeError("Config setting invalid for memory")).to.equal(
                ProfilerErrorCategory.BufferConfigError,
            );
        });

        test("classifies XEL file errors", () => {
            expect(categorizeError("Failed to read XEL file")).to.equal(
                ProfilerErrorCategory.XelFileError,
            );
            expect(categorizeError("XEvent data corrupted")).to.equal(
                ProfilerErrorCategory.XelFileError,
            );
            expect(categorizeError("Extended event log missing")).to.equal(
                ProfilerErrorCategory.XelFileError,
            );
        });

        test("returns Unknown for unrecognised errors", () => {
            expect(categorizeError("Something went wrong")).to.equal(ProfilerErrorCategory.Unknown);
            expect(categorizeError("")).to.equal(ProfilerErrorCategory.Unknown);
        });

        test("is case-insensitive", () => {
            expect(categorizeError("PERMISSION DENIED")).to.equal(
                ProfilerErrorCategory.PermissionDenied,
            );
            expect(categorizeError("NOT SUPPORTED")).to.equal(
                ProfilerErrorCategory.AzureUnsupported,
            );
        });

        test("accepts optional engineType parameter", () => {
            // Engine type does not change the result when keywords already match
            expect(categorizeError("Permission denied", "AzureSQLDB")).to.equal(
                ProfilerErrorCategory.PermissionDenied,
            );
        });
    });

    // ================================================================
    // sendSessionStarted tests
    // ================================================================

    suite("sendSessionStarted", () => {
        test("sends correct view, action, and properties", () => {
            ProfilerTelemetry.sendSessionStarted("sess-1", "SQLServer", "Standard", false);

            expect(sendActionEventStub.calledOnce).to.be.true;
            const [view, action, props] = sendActionEventStub.firstCall.args;
            expect(view).to.equal(TelemetryViews.Profiler);
            expect(action).to.equal(TelemetryActions.ProfilerSessionStarted);
            expect(props).to.deep.include({
                sessionId: "sess-1",
                engineType: "SQLServer",
                templateName: "Standard",
                isFromFile: "false",
            });
        });

        test("sends isFromFile=true for file sessions", () => {
            ProfilerTelemetry.sendSessionStarted("sess-2", "SQLServer", "XEL_File", true);

            const props = sendActionEventStub.firstCall.args[2];
            expect(props.isFromFile).to.equal("true");
        });

        test("swallows errors silently", () => {
            sendActionEventStub.throws(new Error("telemetry failure"));
            expect(() => ProfilerTelemetry.sendSessionStarted("s", "e", "t", false)).to.not.throw();
        });
    });

    // ================================================================
    // sendSessionFailed tests
    // ================================================================

    suite("sendSessionFailed", () => {
        test("sends correct view, action, and properties", () => {
            ProfilerTelemetry.sendSessionFailed(
                "sess-1",
                "AzureSQLDB",
                ProfilerErrorCategory.PermissionDenied,
            );

            expect(sendActionEventStub.calledOnce).to.be.true;
            const [view, action, props] = sendActionEventStub.firstCall.args;
            expect(view).to.equal(TelemetryViews.Profiler);
            expect(action).to.equal(TelemetryActions.ProfilerSessionFailed);
            expect(props).to.deep.include({
                sessionId: "sess-1",
                engineType: "AzureSQLDB",
                errorCategory: ProfilerErrorCategory.PermissionDenied,
            });
        });

        test("swallows errors silently", () => {
            sendActionEventStub.throws(new Error("boom"));
            expect(() =>
                ProfilerTelemetry.sendSessionFailed("s", "e", ProfilerErrorCategory.Unknown),
            ).to.not.throw();
        });
    });

    // ================================================================
    // sendSessionStopped tests
    // ================================================================

    suite("sendSessionStopped", () => {
        test("sends correct view, action, properties, and measurements", () => {
            ProfilerTelemetry.sendSessionStopped("sess-1", 5000, 42, true);

            expect(sendActionEventStub.calledOnce).to.be.true;
            const [view, action, props, measurements] = sendActionEventStub.firstCall.args;
            expect(view).to.equal(TelemetryViews.Profiler);
            expect(action).to.equal(TelemetryActions.ProfilerSessionStopped);
            expect(props).to.deep.include({
                sessionId: "sess-1",
                wasExported: "true",
            });
            expect(measurements).to.deep.include({
                durationMs: 5000,
                eventsCapturedCount: 42,
            });
        });

        test("sends wasExported=false when not exported", () => {
            ProfilerTelemetry.sendSessionStopped("sess-2", 100, 0, false);

            const props = sendActionEventStub.firstCall.args[2];
            expect(props.wasExported).to.equal("false");
        });

        test("swallows errors silently", () => {
            sendActionEventStub.throws(new Error("fail"));
            expect(() => ProfilerTelemetry.sendSessionStopped("s", 0, 0, false)).to.not.throw();
        });
    });

    // ================================================================
    // sendExportDone tests
    // ================================================================

    suite("sendExportDone", () => {
        test("sends correct view, action, properties, and measurements", () => {
            ProfilerTelemetry.sendExportDone("sess-1", "csv", 100);

            expect(sendActionEventStub.calledOnce).to.be.true;
            const [view, action, props, measurements] = sendActionEventStub.firstCall.args;
            expect(view).to.equal(TelemetryViews.Profiler);
            expect(action).to.equal(TelemetryActions.ProfilerExportDone);
            expect(props).to.deep.include({
                sessionId: "sess-1",
                exportFormat: "csv",
            });
            expect(measurements).to.deep.include({
                eventsExportedCount: 100,
            });
        });

        test("swallows errors silently", () => {
            sendActionEventStub.throws(new Error("fail"));
            expect(() => ProfilerTelemetry.sendExportDone("s", "csv", 0)).to.not.throw();
        });
    });

    // ================================================================
    // sendCloseWarningShown tests
    // ================================================================

    suite("sendCloseWarningShown", () => {
        test("sends correct view, action, properties, and measurements", () => {
            ProfilerTelemetry.sendCloseWarningShown("sess-1", 50, CloseWarningUserAction.Discarded);

            expect(sendActionEventStub.calledOnce).to.be.true;
            const [view, action, props, measurements] = sendActionEventStub.firstCall.args;
            expect(view).to.equal(TelemetryViews.Profiler);
            expect(action).to.equal(TelemetryActions.ProfilerCloseWarningShown);
            expect(props).to.deep.include({
                sessionId: "sess-1",
                userAction: "Discarded",
            });
            expect(measurements).to.deep.include({
                unsavedEventsCount: 50,
            });
        });

        test("sends Cancelled action", () => {
            ProfilerTelemetry.sendCloseWarningShown("sess-1", 10, CloseWarningUserAction.Cancelled);

            const props = sendActionEventStub.firstCall.args[2];
            expect(props.userAction).to.equal("Cancelled");
        });

        test("sends Saved action", () => {
            ProfilerTelemetry.sendCloseWarningShown("sess-1", 0, CloseWarningUserAction.Saved);

            const props = sendActionEventStub.firstCall.args[2];
            expect(props.userAction).to.equal("Saved");
        });

        test("swallows errors silently", () => {
            sendActionEventStub.throws(new Error("fail"));
            expect(() =>
                ProfilerTelemetry.sendCloseWarningShown("s", 0, CloseWarningUserAction.Discarded),
            ).to.not.throw();
        });
    });

    // ================================================================
    // sendFilterApplied tests
    // ================================================================

    suite("sendFilterApplied", () => {
        test("sends column:operator pairs without values", () => {
            const filters = [
                { field: "eventClass", operator: FilterOperator.Equals, value: "rpc_completed" },
                {
                    field: "databaseName",
                    operator: FilterOperator.Contains,
                    value: "AdventureWorks",
                },
            ];
            ProfilerTelemetry.sendFilterApplied("sess-1", filters);

            expect(sendActionEventStub.calledOnce).to.be.true;
            const [view, action, props] = sendActionEventStub.firstCall.args;
            expect(view).to.equal(TelemetryViews.Profiler);
            expect(action).to.equal(TelemetryActions.ProfilerFilterApplied);
            expect(props.sessionId).to.equal("sess-1");
            expect(props.filters).to.equal(
                `eventClass:${FilterOperator.Equals},databaseName:${FilterOperator.Contains}`,
            );
        });

        test("sends empty string for no filters", () => {
            ProfilerTelemetry.sendFilterApplied("sess-1", []);

            const props = sendActionEventStub.firstCall.args[2];
            expect(props.filters).to.equal("");
        });

        test("swallows errors silently", () => {
            sendActionEventStub.throws(new Error("fail"));
            expect(() => ProfilerTelemetry.sendFilterApplied("s", [])).to.not.throw();
        });
    });

    // ================================================================
    // sendBufferOverflow tests
    // ================================================================

    suite("sendBufferOverflow", () => {
        test("sends correct view, action, properties, and measurements", () => {
            ProfilerTelemetry.sendBufferOverflow("sess-1", 10000, 5);

            expect(sendActionEventStub.calledOnce).to.be.true;
            const [view, action, props, measurements] = sendActionEventStub.firstCall.args;
            expect(view).to.equal(TelemetryViews.Profiler);
            expect(action).to.equal(TelemetryActions.ProfilerBufferOverflow);
            expect(props).to.deep.include({
                sessionId: "sess-1",
            });
            expect(measurements).to.deep.include({
                bufferCapacity: 10000,
                evictedCount: 5,
            });
        });

        test("swallows errors silently", () => {
            sendActionEventStub.throws(new Error("fail"));
            expect(() => ProfilerTelemetry.sendBufferOverflow("s", 100, 1)).to.not.throw();
        });
    });
});
