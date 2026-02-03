/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import { expect } from "chai";
import * as sinon from "sinon";
import * as chai from "chai";
import sinonChai from "sinon-chai";
import { ProfilerGetSessionSummaryTool } from "../../../src/copilot/tools/profilerGetSessionSummaryTool";
import { SessionState } from "../../../src/profiler/profilerTypes";
import {
    createMockSession,
    createMockSessionManager,
    createMockEvents,
} from "../profiler/profilerToolTestUtils";
import { SessionSummaryResult } from "../../../src/copilot/tools/profilerToolTypes";

chai.use(sinonChai);

suite("ProfilerGetSessionSummaryTool Tests", () => {
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
        test("T013: returns error when session not found", async () => {
            // Arrange
            const mockManager = createMockSessionManager([]);
            const tool = new ProfilerGetSessionSummaryTool(mockManager as any);

            const options = {
                input: { sessionId: "non-existent-session" },
            } as vscode.LanguageModelToolInvocationOptions<{ sessionId: string }>;

            // Act
            const result = await tool.call(options, mockToken);
            const parsed: SessionSummaryResult = JSON.parse(result);

            // Assert
            expect(parsed.success).to.be.false;
            expect(parsed.error).to.include("not found");
        });

        test("T014: returns summary with correct event count and time range", async () => {
            // Arrange
            const mockSession = createMockSession({
                id: "session-123",
                sessionName: "Performance Trace",
                state: SessionState.Running,
            });

            // Add events with timestamps spanning a time range
            const events = createMockEvents(10, {
                baseTimestamp: new Date("2026-02-03T10:00:00Z").getTime(),
                timestampIncrement: 60000, // 1 minute apart
            });
            for (const event of events) {
                mockSession.events.add(event);
            }

            const mockManager = createMockSessionManager([mockSession]);
            const tool = new ProfilerGetSessionSummaryTool(mockManager as any);

            const options = {
                input: { sessionId: "session-123" },
            } as vscode.LanguageModelToolInvocationOptions<{ sessionId: string }>;

            // Act
            const result = await tool.call(options, mockToken);
            const parsed: SessionSummaryResult = JSON.parse(result);

            // Assert
            expect(parsed.success).to.be.true;
            expect(parsed.summary).to.exist;
            expect(parsed.summary!.totalEvents).to.equal(10);
            expect(parsed.summary!.timeRange).to.exist;
            expect(parsed.summary!.timeRange!.start).to.be.a("string");
            expect(parsed.summary!.timeRange!.end).to.be.a("string");
        });

        test("T015: calculates top event types correctly", async () => {
            // Arrange
            const mockSession = createMockSession({
                id: "session-123",
                sessionName: "Performance Trace",
                state: SessionState.Running,
            });

            // Add events with different event classes
            const events = [
                ...createMockEvents(5, { eventClass: "sql_statement_completed" }),
                ...createMockEvents(3, { eventClass: "rpc_completed" }),
                ...createMockEvents(2, { eventClass: "sp_statement_completed" }),
            ];
            for (const event of events) {
                mockSession.events.add(event);
            }

            const mockManager = createMockSessionManager([mockSession]);
            const tool = new ProfilerGetSessionSummaryTool(mockManager as any);

            const options = {
                input: { sessionId: "session-123" },
            } as vscode.LanguageModelToolInvocationOptions<{ sessionId: string }>;

            // Act
            const result = await tool.call(options, mockToken);
            const parsed: SessionSummaryResult = JSON.parse(result);

            // Assert
            expect(parsed.success).to.be.true;
            expect(parsed.summary).to.exist;
            expect(parsed.summary!.topEventTypes).to.be.an("array");
            expect(parsed.summary!.topEventTypes.length).to.be.at.most(5);

            // Verify ordering (most common first)
            const eventTypeCounts = parsed.summary!.topEventTypes;
            expect(eventTypeCounts[0].eventType).to.equal("sql_statement_completed");
            expect(eventTypeCounts[0].count).to.equal(5);
            expect(eventTypeCounts[1].eventType).to.equal("rpc_completed");
            expect(eventTypeCounts[1].count).to.equal(3);
        });

        test("T016: handles empty session (no events) gracefully", async () => {
            // Arrange
            const mockSession = createMockSession({
                id: "empty-session",
                sessionName: "Empty Trace",
                state: SessionState.Running,
            });
            // No events added

            const mockManager = createMockSessionManager([mockSession]);
            const tool = new ProfilerGetSessionSummaryTool(mockManager as any);

            const options = {
                input: { sessionId: "empty-session" },
            } as vscode.LanguageModelToolInvocationOptions<{ sessionId: string }>;

            // Act
            const result = await tool.call(options, mockToken);
            const parsed: SessionSummaryResult = JSON.parse(result);

            // Assert
            expect(parsed.success).to.be.true;
            expect(parsed.summary).to.exist;
            expect(parsed.summary!.totalEvents).to.equal(0);
            expect(parsed.summary!.topEventTypes).to.be.an("array").that.is.empty;
            expect(parsed.summary!.timeRange).to.be.undefined;
        });

        test("T016a: sets eventsLostToOverflow=true when buffer is at capacity (FR-008)", async () => {
            // Arrange
            const bufferCapacity = 10;
            const mockSession = createMockSession({
                id: "overflow-session",
                sessionName: "Overflow Trace",
                state: SessionState.Running,
                bufferCapacity: bufferCapacity,
            });

            // Fill the buffer to capacity + overflow (to simulate events lost)
            const events = createMockEvents(bufferCapacity + 5);
            for (const event of events) {
                mockSession.events.add(event);
            }

            const mockManager = createMockSessionManager([mockSession]);
            const tool = new ProfilerGetSessionSummaryTool(mockManager as any);

            const options = {
                input: { sessionId: "overflow-session" },
            } as vscode.LanguageModelToolInvocationOptions<{ sessionId: string }>;

            // Act
            const result = await tool.call(options, mockToken);
            const parsed: SessionSummaryResult = JSON.parse(result);

            // Assert
            expect(parsed.success).to.be.true;
            expect(parsed.summary).to.exist;
            expect(parsed.summary!.eventsLostToOverflow).to.be.true;
        });

        test("returns summary for specified session", async () => {
            // Arrange
            const session1 = createMockSession({
                id: "session-1",
                sessionName: "First Session",
                state: SessionState.Running,
            });
            const session2 = createMockSession({
                id: "session-2",
                sessionName: "Second Session",
                state: SessionState.Paused,
            });

            // Add different event counts to each session
            const events1 = createMockEvents(5);
            const events2 = createMockEvents(15);
            for (const event of events1) {
                session1.events.add(event);
            }
            for (const event of events2) {
                session2.events.add(event);
            }

            const mockManager = createMockSessionManager([session1, session2]);
            const tool = new ProfilerGetSessionSummaryTool(mockManager as any);

            // Request summary for session 2
            const options = {
                input: { sessionId: "session-2" },
            } as vscode.LanguageModelToolInvocationOptions<{ sessionId: string }>;

            // Act
            const result = await tool.call(options, mockToken);
            const parsed: SessionSummaryResult = JSON.parse(result);

            // Assert
            expect(parsed.success).to.be.true;
            expect(parsed.summary).to.exist;
            expect(parsed.summary!.sessionId).to.equal("session-2");
            expect(parsed.summary!.totalEvents).to.equal(15);
        });

        test("T043 [US6]: returns topDatabases sorted by count desc", async () => {
            // Arrange
            const mockSession = createMockSession({
                id: "session-db",
                sessionName: "Database Distribution Trace",
                state: SessionState.Running,
            });

            // Add events from different databases
            const events = [
                ...createMockEvents(5, { databaseName: "SalesDB" }),
                ...createMockEvents(3, { databaseName: "InventoryDB" }),
                ...createMockEvents(8, { databaseName: "CustomerDB" }),
                ...createMockEvents(2, { databaseName: "ReportsDB" }),
            ];
            for (const event of events) {
                mockSession.events.add(event);
            }

            const mockManager = createMockSessionManager([mockSession]);
            const tool = new ProfilerGetSessionSummaryTool(mockManager as any);

            const options = {
                input: { sessionId: "session-db" },
            } as vscode.LanguageModelToolInvocationOptions<{ sessionId: string }>;

            // Act
            const result = await tool.call(options, mockToken);
            const parsed: SessionSummaryResult = JSON.parse(result);

            // Assert
            expect(parsed.success).to.be.true;
            expect(parsed.summary).to.exist;
            expect(parsed.summary!.topDatabases).to.be.an("array");
            expect(parsed.summary!.topDatabases.length).to.be.at.most(5);

            // Verify sorted by count descending
            expect(parsed.summary!.topDatabases[0].database).to.equal("CustomerDB");
            expect(parsed.summary!.topDatabases[0].count).to.equal(8);
            expect(parsed.summary!.topDatabases[1].database).to.equal("SalesDB");
            expect(parsed.summary!.topDatabases[1].count).to.equal(5);
        });

        test("T044 [US6]: returns topApplications sorted by count desc", async () => {
            // Arrange
            const mockSession = createMockSession({
                id: "session-app",
                sessionName: "Application Distribution Trace",
                state: SessionState.Running,
            });

            // Add events from different applications (via additionalData)
            const events = [
                ...createMockEvents(7, { additionalData: { applicationName: "WebApp" } }),
                ...createMockEvents(2, { additionalData: { applicationName: "ReportService" } }),
                ...createMockEvents(4, { additionalData: { applicationName: "DataSync" } }),
                ...createMockEvents(9, { additionalData: { applicationName: "APIGateway" } }),
            ];
            for (const event of events) {
                mockSession.events.add(event);
            }

            const mockManager = createMockSessionManager([mockSession]);
            const tool = new ProfilerGetSessionSummaryTool(mockManager as any);

            const options = {
                input: { sessionId: "session-app" },
            } as vscode.LanguageModelToolInvocationOptions<{ sessionId: string }>;

            // Act
            const result = await tool.call(options, mockToken);
            const parsed: SessionSummaryResult = JSON.parse(result);

            // Assert
            expect(parsed.success).to.be.true;
            expect(parsed.summary).to.exist;
            expect(parsed.summary!.topApplications).to.be.an("array");
            expect(parsed.summary!.topApplications.length).to.be.at.most(5);

            // Verify sorted by count descending
            expect(parsed.summary!.topApplications[0].application).to.equal("APIGateway");
            expect(parsed.summary!.topApplications[0].count).to.equal(9);
            expect(parsed.summary!.topApplications[1].application).to.equal("WebApp");
            expect(parsed.summary!.topApplications[1].count).to.equal(7);
        });
    });

    suite("prepareInvocation", () => {
        test("returns confirmation messages and invocation message", async () => {
            // Arrange
            const mockManager = createMockSessionManager([]);
            const tool = new ProfilerGetSessionSummaryTool(mockManager as any);

            const options = {
                input: { sessionId: "test-session" },
            } as vscode.LanguageModelToolInvocationPrepareOptions<{ sessionId: string }>;

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
