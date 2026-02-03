/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import * as vscode from "vscode";
import { ProfilerGetEventDetailTool } from "../../../src/copilot/tools/profilerGetEventDetailTool";
import {
    GetEventDetailParams,
    GetEventDetailResult,
} from "../../../src/copilot/tools/profilerToolTypes";
import { SessionState } from "../../../src/profiler/profilerTypes";
import {
    createMockSessionManager,
    createMockSession,
    createMockEvents,
} from "./profilerToolTestUtils";

suite("ProfilerGetEventDetailTool", () => {
    const mockToken: vscode.CancellationToken = {
        isCancellationRequested: false,
        onCancellationRequested: () => ({ dispose: () => {} }) as any,
    };

    suite("constructor", () => {
        test("T034: creates tool with session manager", () => {
            // Arrange
            const mockManager = createMockSessionManager([]);

            // Act
            const tool = new ProfilerGetEventDetailTool(mockManager as any);

            // Assert
            expect(tool).to.be.instanceOf(ProfilerGetEventDetailTool);
            expect(tool.toolName).to.equal("mssql_profiler_get_event_detail");
        });
    });

    suite("call", () => {
        test("T035: returns error when session not found", async () => {
            // Arrange
            const mockManager = createMockSessionManager([]);
            const tool = new ProfilerGetEventDetailTool(mockManager as any);

            const options = {
                input: { sessionId: "non-existent-session", eventId: "event-1" },
            } as vscode.LanguageModelToolInvocationOptions<GetEventDetailParams>;

            // Act
            const result = await tool.call(options, mockToken);
            const parsed: GetEventDetailResult = JSON.parse(result);

            // Assert
            expect(parsed.success).to.be.false;
            expect(parsed.message).to.include("not found");
        });

        test("T036: returns error when event not found in session", async () => {
            // Arrange
            const mockSession = createMockSession({
                id: "session-123",
                sessionName: "My Trace",
                state: SessionState.Running,
            });

            // Add some events
            const events = createMockEvents(3);
            for (const event of events) {
                mockSession.events.add(event);
            }

            const mockManager = createMockSessionManager([mockSession]);
            const tool = new ProfilerGetEventDetailTool(mockManager as any);

            const options = {
                input: { sessionId: "session-123", eventId: "non-existent-event" },
            } as vscode.LanguageModelToolInvocationOptions<GetEventDetailParams>;

            // Act
            const result = await tool.call(options, mockToken);
            const parsed: GetEventDetailResult = JSON.parse(result);

            // Assert
            expect(parsed.success).to.be.false;
            expect(parsed.message).to.include("not found");
        });

        test("T037: returns full event details with textTruncated flag", async () => {
            // Arrange
            const mockSession = createMockSession({
                id: "session-123",
                sessionName: "My Trace",
                state: SessionState.Running,
            });

            const longText = "SELECT " + "x".repeat(5000) + " FROM table";
            const events = createMockEvents(1, {
                textData: longText,
                additionalData: { applicationName: "TestApp" },
            });
            for (const event of events) {
                mockSession.events.add(event);
            }

            const mockManager = createMockSessionManager([mockSession]);
            const tool = new ProfilerGetEventDetailTool(mockManager as any);

            const eventId = mockSession.events.getAllRows()[0].id;
            const options = {
                input: { sessionId: "session-123", eventId },
            } as vscode.LanguageModelToolInvocationOptions<GetEventDetailParams>;

            // Act
            const result = await tool.call(options, mockToken);
            const parsed: GetEventDetailResult = JSON.parse(result);

            // Assert
            expect(parsed.success).to.be.true;
            expect(parsed.event).to.exist;
            expect(parsed.event!.eventId).to.equal(eventId);
            expect(parsed.event!.textTruncated).to.be.true;
            expect(parsed.event!.applicationName).to.equal("TestApp");
        });

        test("T038: returns event with additionalData populated", async () => {
            // Arrange
            const mockSession = createMockSession({
                id: "session-123",
                sessionName: "My Trace",
                state: SessionState.Running,
            });

            const events = createMockEvents(1, {
                additionalData: {
                    objectName: "MyTable",
                    objectType: "TABLE",
                    hostName: "localhost",
                },
            });
            for (const event of events) {
                mockSession.events.add(event);
            }

            const mockManager = createMockSessionManager([mockSession]);
            const tool = new ProfilerGetEventDetailTool(mockManager as any);

            const eventId = mockSession.events.getAllRows()[0].id;
            const options = {
                input: { sessionId: "session-123", eventId },
            } as vscode.LanguageModelToolInvocationOptions<GetEventDetailParams>;

            // Act
            const result = await tool.call(options, mockToken);
            const parsed: GetEventDetailResult = JSON.parse(result);

            // Assert
            expect(parsed.success).to.be.true;
            expect(parsed.event).to.exist;
            expect(parsed.event!.additionalData).to.deep.include({
                objectName: "MyTable",
                objectType: "TABLE",
                hostName: "localhost",
            });
        });

        test("T039: returns event with all core fields populated", async () => {
            // Arrange
            const mockSession = createMockSession({
                id: "session-123",
                sessionName: "My Trace",
                state: SessionState.Running,
            });

            const events = createMockEvents(1, {
                duration: 5000,
                cpu: 100,
                reads: 500,
                writes: 10,
                spid: 52,
                databaseName: "TestDB",
                eventClass: "RPC:Completed",
            });
            for (const event of events) {
                mockSession.events.add(event);
            }

            const mockManager = createMockSessionManager([mockSession]);
            const tool = new ProfilerGetEventDetailTool(mockManager as any);

            const eventId = mockSession.events.getAllRows()[0].id;
            const options = {
                input: { sessionId: "session-123", eventId },
            } as vscode.LanguageModelToolInvocationOptions<GetEventDetailParams>;

            // Act
            const result = await tool.call(options, mockToken);
            const parsed: GetEventDetailResult = JSON.parse(result);

            // Assert
            expect(parsed.success).to.be.true;
            const event = parsed.event!;
            expect(event.duration).to.equal(5000);
            expect(event.cpu).to.equal(100);
            expect(event.reads).to.equal(500);
            expect(event.writes).to.equal(10);
            expect(event.spid).to.equal(52);
            expect(event.databaseName).to.equal("TestDB");
            expect(event.eventClass).to.equal("RPC:Completed");
        });

        test("T040: handles stopped session with no events gracefully", async () => {
            // Arrange
            const mockSession = createMockSession({
                id: "session-stopped",
                sessionName: "Stopped Session",
                state: SessionState.Stopped,
            });

            // No events added to the session

            const mockManager = createMockSessionManager([mockSession]);
            const tool = new ProfilerGetEventDetailTool(mockManager as any);

            const options = {
                input: { sessionId: "session-stopped", eventId: "any-event" },
            } as vscode.LanguageModelToolInvocationOptions<GetEventDetailParams>;

            // Act
            const result = await tool.call(options, mockToken);
            const parsed: GetEventDetailResult = JSON.parse(result);

            // Assert - should return event not found
            expect(parsed.success).to.be.false;
            expect(parsed.message).to.include("not found");
        });

        test("T041: returns textTruncated=false for short text", async () => {
            // Arrange
            const mockSession = createMockSession({
                id: "session-123",
                sessionName: "My Trace",
                state: SessionState.Running,
            });

            const shortText = "SELECT * FROM users";
            const events = createMockEvents(1, { textData: shortText });
            for (const event of events) {
                mockSession.events.add(event);
            }

            const mockManager = createMockSessionManager([mockSession]);
            const tool = new ProfilerGetEventDetailTool(mockManager as any);

            const eventId = mockSession.events.getAllRows()[0].id;
            const options = {
                input: { sessionId: "session-123", eventId },
            } as vscode.LanguageModelToolInvocationOptions<GetEventDetailParams>;

            // Act
            const result = await tool.call(options, mockToken);
            const parsed: GetEventDetailResult = JSON.parse(result);

            // Assert
            expect(parsed.success).to.be.true;
            expect(parsed.event!.textTruncated).to.be.false;
            expect(parsed.event!.textData).to.equal(shortText);
        });
    });

    suite("prepareInvocation", () => {
        test("T042: returns proper confirmation messages", async () => {
            // Arrange
            const mockManager = createMockSessionManager([]);
            const tool = new ProfilerGetEventDetailTool(mockManager as any);

            const options = {
                input: { sessionId: "session-123", eventId: "event-456" },
            } as vscode.LanguageModelToolInvocationPrepareOptions<GetEventDetailParams>;

            // Act
            const result = await tool.prepareInvocation(options, mockToken);

            // Assert
            expect(result.invocationMessage).to.include("session-123");
            expect(result.confirmationMessages.title).to.include("Event Detail");
        });
    });
});
