/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as sinon from "sinon";
import { expect } from "chai";
import { ProfilerService } from "../../src/services/profilerService";
import SqlToolsServiceClient from "../../src/languageservice/serviceclient";
import {
    CreateXEventSessionRequest,
    CreateXEventSessionParams,
    StartProfilingRequest,
    StartProfilingParams,
    StopProfilingRequest,
    StopProfilingParams,
    PauseProfilingRequest,
    PauseProfilingParams,
    GetXEventSessionsRequest,
    GetXEventSessionsParams,
    DisconnectSessionRequest,
    DisconnectSessionParams,
    ProfilingSessionType,
} from "../../src/models/contracts/profiler";

suite("ProfilerService Tests", () => {
    let sandbox: sinon.SinonSandbox;
    let sqlToolsClientStub: sinon.SinonStubbedInstance<SqlToolsServiceClient>;
    let profilerService: ProfilerService;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let notificationHandlers: Map<string, (params: any) => void>;
    let loggerErrorStub: sinon.SinonStub;

    const testOwnerUri = "file:///test.sql";

    setup(() => {
        sandbox = sinon.createSandbox();
        sqlToolsClientStub = sandbox.createStubInstance(SqlToolsServiceClient);
        notificationHandlers = new Map();

        // Capture notification handlers when they're registered
        sqlToolsClientStub.onNotification.callsFake(
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (type: { method: string }, handler: (params: any) => void) => {
                notificationHandlers.set(type.method, handler);
            },
        );

        // Stub logger
        loggerErrorStub = sandbox.stub();
        Object.defineProperty(sqlToolsClientStub, "logger", {
            get: () => ({ error: loggerErrorStub }),
        });

        profilerService = new ProfilerService(sqlToolsClientStub);
    });

    teardown(() => {
        sandbox.restore();
    });

    suite("Constructor and Notification Registration", () => {
        test("should register notification handlers during construction", () => {
            expect(sqlToolsClientStub.onNotification).to.have.been.calledThrice;
        });

        test("should register handler for eventsavailable notification", () => {
            expect(notificationHandlers.has("profiler/eventsavailable")).to.be.true;
        });

        test("should register handler for sessionstopped notification", () => {
            expect(notificationHandlers.has("profiler/sessionstopped")).to.be.true;
        });

        test("should register handler for sessioncreated notification", () => {
            expect(notificationHandlers.has("profiler/sessioncreated")).to.be.true;
        });
    });

    suite("createXEventSession", () => {
        test("should send create session request with correct parameters", async () => {
            const template = {
                name: "TestTemplate",
                defaultView: "Standard View",
                createStatement: "CREATE EVENT SESSION...",
            };
            sqlToolsClientStub.sendRequest.resolves({});

            await profilerService.createXEventSession(testOwnerUri, "TestSession", template);

            expect(sqlToolsClientStub.sendRequest).to.have.been.calledOnce;
            const [requestType, params] = sqlToolsClientStub.sendRequest.firstCall.args;
            expect(requestType).to.equal(CreateXEventSessionRequest.type);
            const typedParams = params as CreateXEventSessionParams;
            expect(typedParams.ownerUri).to.equal(testOwnerUri);
            expect(typedParams.sessionName).to.equal("TestSession");
            expect(typedParams.template).to.deep.equal(template);
        });

        test("should log and rethrow error on failure", async () => {
            const error = new Error("Create session failed");
            sqlToolsClientStub.sendRequest.rejects(error);

            try {
                await profilerService.createXEventSession(testOwnerUri, "TestSession", {
                    name: "Test",
                    defaultView: "",
                    createStatement: "",
                });
                expect.fail("Should have thrown error");
            } catch (e) {
                expect(e).to.equal(error);
                expect(loggerErrorStub).to.have.been.calledOnce;
            }
        });
    });

    suite("startProfiling", () => {
        test("should send start profiling request with default session type", async () => {
            sqlToolsClientStub.sendRequest.resolves({
                uniqueSessionId: "session-123",
                canPause: true,
            });

            const result = await profilerService.startProfiling(testOwnerUri, "TestSession");

            expect(sqlToolsClientStub.sendRequest).to.have.been.calledOnce;
            const [requestType, params] = sqlToolsClientStub.sendRequest.firstCall.args;
            expect(requestType).to.equal(StartProfilingRequest.type);
            const typedParams = params as StartProfilingParams;
            expect(typedParams.ownerUri).to.equal(testOwnerUri);
            expect(typedParams.sessionName).to.equal("TestSession");
            expect(typedParams.sessionType).to.equal(ProfilingSessionType.RemoteSession);
            expect(result.uniqueSessionId).to.equal("session-123");
            expect(result.canPause).to.be.true;
        });

        test("should send start profiling request with LocalFile session type", async () => {
            sqlToolsClientStub.sendRequest.resolves({
                uniqueSessionId: "session-456",
                canPause: false,
            });

            const result = await profilerService.startProfiling(
                testOwnerUri,
                "C:\\path\\to\\file.xel",
                ProfilingSessionType.LocalFile,
            );

            const [, params] = sqlToolsClientStub.sendRequest.firstCall.args;
            const typedParams = params as StartProfilingParams;
            expect(typedParams.sessionType).to.equal(ProfilingSessionType.LocalFile);
            expect(result.canPause).to.be.false;
        });

        test("should log and rethrow error on failure", async () => {
            const error = new Error("Start profiling failed");
            sqlToolsClientStub.sendRequest.rejects(error);

            try {
                await profilerService.startProfiling(testOwnerUri, "TestSession");
                expect.fail("Should have thrown error");
            } catch (e) {
                expect(e).to.equal(error);
                expect(loggerErrorStub).to.have.been.calledOnce;
            }
        });
    });

    suite("stopProfiling", () => {
        test("should send stop profiling request", async () => {
            sqlToolsClientStub.sendRequest.resolves({});

            await profilerService.stopProfiling(testOwnerUri);

            expect(sqlToolsClientStub.sendRequest).to.have.been.calledOnce;
            const [requestType, params] = sqlToolsClientStub.sendRequest.firstCall.args;
            expect(requestType).to.equal(StopProfilingRequest.type);
            const typedParams = params as StopProfilingParams;
            expect(typedParams.ownerUri).to.equal(testOwnerUri);
        });

        test("should log and rethrow error on failure", async () => {
            const error = new Error("Stop profiling failed");
            sqlToolsClientStub.sendRequest.rejects(error);

            try {
                await profilerService.stopProfiling(testOwnerUri);
                expect.fail("Should have thrown error");
            } catch (e) {
                expect(e).to.equal(error);
                expect(loggerErrorStub).to.have.been.calledOnce;
            }
        });
    });

    suite("pauseProfiling", () => {
        test("should send pause profiling request and return isPaused state", async () => {
            sqlToolsClientStub.sendRequest.resolves({ isPaused: true });

            const result = await profilerService.pauseProfiling(testOwnerUri);

            expect(sqlToolsClientStub.sendRequest).to.have.been.calledOnce;
            const [requestType, params] = sqlToolsClientStub.sendRequest.firstCall.args;
            expect(requestType).to.equal(PauseProfilingRequest.type);
            const typedParams = params as PauseProfilingParams;
            expect(typedParams.ownerUri).to.equal(testOwnerUri);
            expect(result.isPaused).to.be.true;
        });

        test("should return isPaused false when resuming", async () => {
            sqlToolsClientStub.sendRequest.resolves({ isPaused: false });

            const result = await profilerService.pauseProfiling(testOwnerUri);

            expect(result.isPaused).to.be.false;
        });

        test("should log and rethrow error on failure", async () => {
            const error = new Error("Pause profiling failed");
            sqlToolsClientStub.sendRequest.rejects(error);

            try {
                await profilerService.pauseProfiling(testOwnerUri);
                expect.fail("Should have thrown error");
            } catch (e) {
                expect(e).to.equal(error);
                expect(loggerErrorStub).to.have.been.calledOnce;
            }
        });
    });

    suite("getXEventSessions", () => {
        test("should send get sessions request and return sessions", async () => {
            const expectedSessions = ["Session1", "Session2", "Session3"];
            sqlToolsClientStub.sendRequest.resolves({ sessions: expectedSessions });

            const result = await profilerService.getXEventSessions(testOwnerUri);

            expect(sqlToolsClientStub.sendRequest).to.have.been.calledOnce;
            const [requestType, params] = sqlToolsClientStub.sendRequest.firstCall.args;
            expect(requestType).to.equal(GetXEventSessionsRequest.type);
            const typedParams = params as GetXEventSessionsParams;
            expect(typedParams.ownerUri).to.equal(testOwnerUri);
            expect(result.sessions).to.deep.equal(expectedSessions);
        });

        test("should log and rethrow error on failure", async () => {
            const error = new Error("Get sessions failed");
            sqlToolsClientStub.sendRequest.rejects(error);

            try {
                await profilerService.getXEventSessions(testOwnerUri);
                expect.fail("Should have thrown error");
            } catch (e) {
                expect(e).to.equal(error);
                expect(loggerErrorStub).to.have.been.calledOnce;
            }
        });
    });

    suite("disconnectSession", () => {
        test("should send disconnect request", async () => {
            sqlToolsClientStub.sendRequest.resolves({});

            await profilerService.disconnectSession(testOwnerUri);

            expect(sqlToolsClientStub.sendRequest).to.have.been.calledOnce;
            const [requestType, params] = sqlToolsClientStub.sendRequest.firstCall.args;
            expect(requestType).to.equal(DisconnectSessionRequest.type);
            const typedParams = params as DisconnectSessionParams;
            expect(typedParams.ownerUri).to.equal(testOwnerUri);
        });

        test("should log and rethrow error on failure", async () => {
            const error = new Error("Disconnect failed");
            sqlToolsClientStub.sendRequest.rejects(error);

            try {
                await profilerService.disconnectSession(testOwnerUri);
                expect.fail("Should have thrown error");
            } catch (e) {
                expect(e).to.equal(error);
                expect(loggerErrorStub).to.have.been.calledOnce;
            }
        });
    });

    suite("Event Handlers", () => {
        suite("onEventsAvailable", () => {
            test("should register handler and call it when events are received", () => {
                const handlerSpy = sandbox.spy();
                profilerService.onEventsAvailable(testOwnerUri, handlerSpy);

                const eventsHandler = notificationHandlers.get("profiler/eventsavailable");
                const eventParams = {
                    ownerUri: testOwnerUri,
                    events: [{ name: "test_event", timestamp: "2026-01-09", values: {} }],
                };
                eventsHandler(eventParams);

                expect(handlerSpy).to.have.been.calledOnceWith(eventParams);
            });

            test("should not call handler for different ownerUri", () => {
                const handlerSpy = sandbox.spy();
                profilerService.onEventsAvailable(testOwnerUri, handlerSpy);

                const eventsHandler = notificationHandlers.get("profiler/eventsavailable");
                eventsHandler({
                    ownerUri: "file:///other.sql",
                    events: [],
                });

                expect(handlerSpy).to.not.have.been.called;
            });

            test("should return disposable that unregisters handler", () => {
                const handlerSpy = sandbox.spy();
                const disposable = profilerService.onEventsAvailable(testOwnerUri, handlerSpy);

                disposable.dispose();

                const eventsHandler = notificationHandlers.get("profiler/eventsavailable");
                eventsHandler({
                    ownerUri: testOwnerUri,
                    events: [],
                });

                expect(handlerSpy).to.not.have.been.called;
            });

            test("should support multiple handlers for same ownerUri", () => {
                const handler1 = sandbox.spy();
                const handler2 = sandbox.spy();
                profilerService.onEventsAvailable(testOwnerUri, handler1);
                profilerService.onEventsAvailable(testOwnerUri, handler2);

                const eventsHandler = notificationHandlers.get("profiler/eventsavailable");
                const eventParams = {
                    ownerUri: testOwnerUri,
                    events: [],
                };
                eventsHandler(eventParams);

                expect(handler1).to.have.been.calledOnce;
                expect(handler2).to.have.been.calledOnce;
            });
        });

        suite("onSessionStopped", () => {
            test("should register handler and call it when session stops", () => {
                const handlerSpy = sandbox.spy();
                profilerService.onSessionStopped(testOwnerUri, handlerSpy);

                const stoppedHandler = notificationHandlers.get("profiler/sessionstopped");
                const stoppedParams = {
                    ownerUri: testOwnerUri,
                    sessionId: 1,
                    uniqueSessionId: "session-123",
                    errorMessage: undefined,
                };
                stoppedHandler(stoppedParams);

                expect(handlerSpy).to.have.been.calledOnceWith(stoppedParams);
            });

            test("should return disposable that unregisters handler", () => {
                const handlerSpy = sandbox.spy();
                const disposable = profilerService.onSessionStopped(testOwnerUri, handlerSpy);

                disposable.dispose();

                const stoppedHandler = notificationHandlers.get("profiler/sessionstopped");
                stoppedHandler({
                    ownerUri: testOwnerUri,
                    sessionId: 1,
                });

                expect(handlerSpy).to.not.have.been.called;
            });
        });

        suite("onSessionCreated", () => {
            test("should register handler and call it when session is created", () => {
                const handlerSpy = sandbox.spy();
                profilerService.onSessionCreated(testOwnerUri, handlerSpy);

                const createdHandler = notificationHandlers.get("profiler/sessioncreated");
                const createdParams = {
                    ownerUri: testOwnerUri,
                    sessionName: "NewSession",
                    templateName: "TestTemplate",
                };
                createdHandler(createdParams);

                expect(handlerSpy).to.have.been.calledOnceWith(createdParams);
            });

            test("should return disposable that unregisters handler", () => {
                const handlerSpy = sandbox.spy();
                const disposable = profilerService.onSessionCreated(testOwnerUri, handlerSpy);

                disposable.dispose();

                const createdHandler = notificationHandlers.get("profiler/sessioncreated");
                createdHandler({
                    ownerUri: testOwnerUri,
                    sessionName: "NewSession",
                    templateName: "TestTemplate",
                });

                expect(handlerSpy).to.not.have.been.called;
            });
        });
    });

    suite("cleanupHandlers", () => {
        test("should remove all handlers for specified ownerUri", () => {
            const eventsHandler = sandbox.spy();
            const stoppedHandler = sandbox.spy();
            const createdHandler = sandbox.spy();

            profilerService.onEventsAvailable(testOwnerUri, eventsHandler);
            profilerService.onSessionStopped(testOwnerUri, stoppedHandler);
            profilerService.onSessionCreated(testOwnerUri, createdHandler);

            profilerService.cleanupHandlers(testOwnerUri);

            // Trigger notifications
            notificationHandlers.get("profiler/eventsavailable")({
                ownerUri: testOwnerUri,
                events: [],
            });
            notificationHandlers.get("profiler/sessionstopped")({
                ownerUri: testOwnerUri,
                sessionId: 1,
            });
            notificationHandlers.get("profiler/sessioncreated")({
                ownerUri: testOwnerUri,
                sessionName: "Test",
                templateName: "Template",
            });

            expect(eventsHandler).to.not.have.been.called;
            expect(stoppedHandler).to.not.have.been.called;
            expect(createdHandler).to.not.have.been.called;
        });

        test("should not affect handlers for other ownerUris", () => {
            const otherUri = "file:///other.sql";
            const handler1 = sandbox.spy();
            const handler2 = sandbox.spy();

            profilerService.onEventsAvailable(testOwnerUri, handler1);
            profilerService.onEventsAvailable(otherUri, handler2);

            profilerService.cleanupHandlers(testOwnerUri);

            // Trigger notification for other URI
            notificationHandlers.get("profiler/eventsavailable")({
                ownerUri: otherUri,
                events: [],
            });

            expect(handler1).to.not.have.been.called;
            expect(handler2).to.have.been.calledOnce;
        });
    });
});
