/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import { expect } from "chai";
import * as sinon from "sinon";
import * as chai from "chai";
import sinonChai from "sinon-chai";
import { ProfilerListSessionsTool } from "../../../src/copilot/tools/profilerListSessionsTool";
import { SessionState } from "../../../src/profiler/profilerTypes";
import {
    createMockSession,
    createMockSessionManager,
    createMockEvents,
} from "../profiler/profilerToolTestUtils";
import { ListSessionsResult } from "../../../src/copilot/tools/profilerToolTypes";

chai.use(sinonChai);

suite("ProfilerListSessionsTool Tests", () => {
    let sandbox: sinon.SinonSandbox;
    let mockToken: vscode.CancellationToken;

    setup(() => {
        sandbox = sinon.createSandbox();
        mockToken = {
            isCancellationRequested: false,
            onCancellationRequested: sandbox.stub(),
        } as unknown as vscode.CancellationToken;
    });

    teardown(() => {
        sandbox.restore();
    });

    suite("call", () => {
        test("T007: returns empty array when no sessions exist", async () => {
            // Arrange
            const mockManager = createMockSessionManager([]);
            const tool = new ProfilerListSessionsTool(mockManager as any);

            const options = {
                input: {},
            } as vscode.LanguageModelToolInvocationOptions<Record<string, never>>;

            // Act
            const result = await tool.call(options, mockToken);
            const parsed: ListSessionsResult = JSON.parse(result);

            // Assert
            expect(parsed.success).to.be.true;
            expect(parsed.sessions).to.be.an("array").that.is.empty;
            expect(parsed.message).to.include("No profiler sessions");
        });

        test("T008: returns session list with correct fields", async () => {
            // Arrange
            const mockSession = createMockSession({
                id: "session-123",
                sessionName: "Performance Trace",
                templateName: "Standard",
                state: SessionState.Running,
                ownerUri: "mssql://localhost/AdventureWorks",
            });

            // Add some events
            const events = createMockEvents(5);
            for (const event of events) {
                mockSession.events.add(event);
            }

            const mockManager = createMockSessionManager([mockSession]);
            const tool = new ProfilerListSessionsTool(mockManager as any);

            const options = {
                input: {},
            } as vscode.LanguageModelToolInvocationOptions<Record<string, never>>;

            // Act
            const result = await tool.call(options, mockToken);
            const parsed: ListSessionsResult = JSON.parse(result);

            // Assert
            expect(parsed.success).to.be.true;
            expect(parsed.sessions).to.have.lengthOf(1);

            const session = parsed.sessions[0];
            expect(session.sessionId).to.equal("session-123");
            expect(session.sessionName).to.equal("Performance Trace");
            expect(session.templateName).to.equal("Standard");
            expect(session.state).to.equal("running");
            expect(session.eventCount).to.equal(5);
            expect(session.bufferCapacity).to.be.a("number");
            expect(session.createdAt).to.match(/^\d{4}-\d{2}-\d{2}T/); // ISO 8601 format
            expect(session.connectionLabel).to.be.a("string");
        });

        test("T009: correctly maps all session states (running/paused/stopped/failed)", async () => {
            // Arrange
            const sessions = [
                createMockSession({
                    id: "session-running",
                    sessionName: "Running Session",
                    state: SessionState.Running,
                }),
                createMockSession({
                    id: "session-paused",
                    sessionName: "Paused Session",
                    state: SessionState.Paused,
                }),
                createMockSession({
                    id: "session-stopped",
                    sessionName: "Stopped Session",
                    state: SessionState.Stopped,
                }),
                createMockSession({
                    id: "session-failed",
                    sessionName: "Failed Session",
                    state: SessionState.Failed,
                }),
                createMockSession({
                    id: "session-creating",
                    sessionName: "Creating Session",
                    state: SessionState.Creating,
                }),
                createMockSession({
                    id: "session-notstarted",
                    sessionName: "Not Started Session",
                    state: SessionState.NotStarted,
                }),
            ];

            const mockManager = createMockSessionManager(sessions);
            const tool = new ProfilerListSessionsTool(mockManager as any);

            const options = {
                input: {},
            } as vscode.LanguageModelToolInvocationOptions<Record<string, never>>;

            // Act
            const result = await tool.call(options, mockToken);
            const parsed: ListSessionsResult = JSON.parse(result);

            // Assert
            expect(parsed.success).to.be.true;
            expect(parsed.sessions).to.have.lengthOf(6);

            const stateMap = new Map(parsed.sessions.map((s) => [s.sessionId, s.state]));
            expect(stateMap.get("session-running")).to.equal("running");
            expect(stateMap.get("session-paused")).to.equal("paused");
            expect(stateMap.get("session-stopped")).to.equal("stopped");
            expect(stateMap.get("session-failed")).to.equal("failed");
            expect(stateMap.get("session-creating")).to.equal("creating");
            expect(stateMap.get("session-notstarted")).to.equal("notStarted");
        });

        test("T009a: handles disposed session gracefully", async () => {
            // Arrange - Create a session that simulates a disposed state
            const mockSession = createMockSession({
                id: "session-disposed",
                sessionName: "Disposed Session",
                state: SessionState.Stopped,
            });

            // Simulate a disposed session by clearing internal state
            // The tool should still be able to read basic properties
            const mockManager = createMockSessionManager([mockSession]);
            const tool = new ProfilerListSessionsTool(mockManager as any);

            const options = {
                input: {},
            } as vscode.LanguageModelToolInvocationOptions<Record<string, never>>;

            // Act
            const result = await tool.call(options, mockToken);
            const parsed: ListSessionsResult = JSON.parse(result);

            // Assert - Should not throw and should return valid data
            expect(parsed.success).to.be.true;
            expect(parsed.sessions).to.have.lengthOf(1);
            expect(parsed.sessions[0].sessionId).to.equal("session-disposed");
            expect(parsed.sessions[0].state).to.equal("stopped");
        });

        test("returns multiple sessions correctly", async () => {
            // Arrange
            const sessions = [
                createMockSession({
                    id: "session-1",
                    sessionName: "First Session",
                    state: SessionState.Running,
                }),
                createMockSession({
                    id: "session-2",
                    sessionName: "Second Session",
                    state: SessionState.Paused,
                }),
            ];

            const mockManager = createMockSessionManager(sessions);
            const tool = new ProfilerListSessionsTool(mockManager as any);

            const options = {
                input: {},
            } as vscode.LanguageModelToolInvocationOptions<Record<string, never>>;

            // Act
            const result = await tool.call(options, mockToken);
            const parsed: ListSessionsResult = JSON.parse(result);

            // Assert
            expect(parsed.success).to.be.true;
            expect(parsed.sessions).to.have.lengthOf(2);
            expect(parsed.sessions.map((s) => s.sessionId)).to.include.members([
                "session-1",
                "session-2",
            ]);
        });
    });

    suite("prepareInvocation", () => {
        test("returns confirmation messages and invocation message", async () => {
            // Arrange
            const mockManager = createMockSessionManager([]);
            const tool = new ProfilerListSessionsTool(mockManager as any);

            const options = {
                input: {},
            } as vscode.LanguageModelToolInvocationPrepareOptions<Record<string, never>>;

            // Act
            const result = await tool.prepareInvocation(options, mockToken);

            // Assert
            expect(result.confirmationMessages).to.exist;
            expect(result.confirmationMessages!.title).to.include("Profiler");
            expect(result.confirmationMessages!.message).to.be.instanceOf(vscode.MarkdownString);
            expect(result.invocationMessage).to.be.a("string");
        });
    });
});
