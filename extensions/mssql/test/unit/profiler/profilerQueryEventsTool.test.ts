/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import { expect } from "chai";
import * as sinon from "sinon";
import * as chai from "chai";
import sinonChai from "sinon-chai";
import { ProfilerQueryEventsTool } from "../../../src/copilot/tools/profilerQueryEventsTool";
import { SessionState, FilterOperator } from "../../../src/profiler/profilerTypes";
import {
    createMockSession,
    createMockSessionManager,
    createMockEvents,
} from "../profiler/profilerToolTestUtils";
import {
    QueryEventsResult,
    QueryEventsParams,
    FilterClause,
} from "../../../src/copilot/tools/profilerToolTypes";

chai.use(sinonChai);

suite("ProfilerQueryEventsTool Tests", () => {
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
        test("T021: returns error when session not found", async () => {
            // Arrange
            const mockManager = createMockSessionManager([]);
            const tool = new ProfilerQueryEventsTool(mockManager as any);

            const options = {
                input: { sessionId: "non-existent-session" },
            } as vscode.LanguageModelToolInvocationOptions<QueryEventsParams>;

            // Act
            const result = await tool.call(options, mockToken);
            const parsed: QueryEventsResult = JSON.parse(result);

            // Assert
            expect(parsed.success).to.be.false;
            expect(parsed.message).to.include("not found");
        });

        test("T022: returns events sorted by duration desc by default", async () => {
            // Arrange
            const mockSession = createMockSession({
                id: "session-123",
                sessionName: "Performance Trace",
                state: SessionState.Running,
            });

            // Add events with different durations
            const events = [
                ...createMockEvents(1, { duration: 1000 }),
                ...createMockEvents(1, { duration: 5000 }),
                ...createMockEvents(1, { duration: 2000 }),
            ];
            for (const event of events) {
                mockSession.events.add(event);
            }

            const mockManager = createMockSessionManager([mockSession]);
            const tool = new ProfilerQueryEventsTool(mockManager as any);

            const options = {
                input: { sessionId: "session-123" },
            } as vscode.LanguageModelToolInvocationOptions<QueryEventsParams>;

            // Act
            const result = await tool.call(options, mockToken);
            const parsed: QueryEventsResult = JSON.parse(result);

            // Assert
            expect(parsed.success).to.be.true;
            expect(parsed.events).to.have.lengthOf(3);
            // Default sort is by duration descending
            expect(parsed.events![0].duration).to.equal(5000);
            expect(parsed.events![1].duration).to.equal(2000);
            expect(parsed.events![2].duration).to.equal(1000);
        });

        test("T023: respects limit parameter (default 50, max 200)", async () => {
            // Arrange
            const mockSession = createMockSession({
                id: "session-123",
                sessionName: "Performance Trace",
                state: SessionState.Running,
            });

            // Add 75 events
            const events = createMockEvents(75);
            for (const event of events) {
                mockSession.events.add(event);
            }

            const mockManager = createMockSessionManager([mockSession]);
            const tool = new ProfilerQueryEventsTool(mockManager as any);

            // Test default limit (50)
            const defaultOptions = {
                input: { sessionId: "session-123" },
            } as vscode.LanguageModelToolInvocationOptions<QueryEventsParams>;

            const defaultResult = await tool.call(defaultOptions, mockToken);
            const defaultParsed: QueryEventsResult = JSON.parse(defaultResult);

            expect(defaultParsed.success).to.be.true;
            expect(defaultParsed.events).to.have.lengthOf(50);
            expect(defaultParsed.metadata!.truncated).to.be.true;
            expect(defaultParsed.metadata!.totalMatching).to.equal(75);

            // Test custom limit
            const customOptions = {
                input: { sessionId: "session-123", limit: 10 },
            } as vscode.LanguageModelToolInvocationOptions<QueryEventsParams>;

            const customResult = await tool.call(customOptions, mockToken);
            const customParsed: QueryEventsResult = JSON.parse(customResult);

            expect(customParsed.events).to.have.lengthOf(10);

            // Test max limit (200)
            const maxOptions = {
                input: { sessionId: "session-123", limit: 500 },
            } as vscode.LanguageModelToolInvocationOptions<QueryEventsParams>;

            const maxResult = await tool.call(maxOptions, mockToken);
            const maxParsed: QueryEventsResult = JSON.parse(maxResult);

            expect(maxParsed.events).to.have.lengthOf(75); // Only 75 events exist
        });

        test("T024: truncates textData to 512 chars", async () => {
            // Arrange
            const mockSession = createMockSession({
                id: "session-123",
                sessionName: "Performance Trace",
                state: SessionState.Running,
            });

            const longText = "a".repeat(1000); // 1000 character text
            const events = createMockEvents(1, { textData: longText });
            for (const event of events) {
                mockSession.events.add(event);
            }

            const mockManager = createMockSessionManager([mockSession]);
            const tool = new ProfilerQueryEventsTool(mockManager as any);

            const options = {
                input: { sessionId: "session-123" },
            } as vscode.LanguageModelToolInvocationOptions<QueryEventsParams>;

            // Act
            const result = await tool.call(options, mockToken);
            const parsed: QueryEventsResult = JSON.parse(result);

            // Assert
            expect(parsed.success).to.be.true;
            expect(parsed.events![0].textData.length).to.be.at.most(515); // 512 + "..."
            expect(parsed.events![0].textData).to.include("...");
        });

        test("T025: applies FilterClause filters correctly (Equals, Contains, GreaterThan)", async () => {
            // Arrange
            const mockSession = createMockSession({
                id: "session-123",
                sessionName: "Performance Trace",
                state: SessionState.Running,
            });

            // Add events with different properties
            const events = [
                ...createMockEvents(1, {
                    eventClass: "sql_statement_completed",
                    databaseName: "TestDB",
                    duration: 1000,
                }),
                ...createMockEvents(1, {
                    eventClass: "rpc_completed",
                    databaseName: "TestDB",
                    duration: 5000,
                }),
                ...createMockEvents(1, {
                    eventClass: "sql_statement_completed",
                    databaseName: "OtherDB",
                    duration: 3000,
                }),
            ];
            for (const event of events) {
                mockSession.events.add(event);
            }

            const mockManager = createMockSessionManager([mockSession]);
            const tool = new ProfilerQueryEventsTool(mockManager as any);

            // Test Equals filter
            const equalsOptions = {
                input: {
                    sessionId: "session-123",
                    filters: [
                        {
                            field: "eventClass",
                            operator: FilterOperator.Equals,
                            value: "sql_statement_completed",
                        } as FilterClause,
                    ],
                },
            } as vscode.LanguageModelToolInvocationOptions<QueryEventsParams>;

            const equalsResult = await tool.call(equalsOptions, mockToken);
            const equalsParsed: QueryEventsResult = JSON.parse(equalsResult);

            expect(equalsParsed.success).to.be.true;
            expect(equalsParsed.events).to.have.lengthOf(2);
            expect(equalsParsed.events!.every((e) => e.eventClass === "sql_statement_completed")).to
                .be.true;

            // Test GreaterThan filter
            const gtOptions = {
                input: {
                    sessionId: "session-123",
                    filters: [
                        {
                            field: "duration",
                            operator: FilterOperator.GreaterThan,
                            value: 2000,
                        } as FilterClause,
                    ],
                },
            } as vscode.LanguageModelToolInvocationOptions<QueryEventsParams>;

            const gtResult = await tool.call(gtOptions, mockToken);
            const gtParsed: QueryEventsResult = JSON.parse(gtResult);

            expect(gtParsed.success).to.be.true;
            expect(gtParsed.events).to.have.lengthOf(2);
            expect(gtParsed.events!.every((e) => e.duration! > 2000)).to.be.true;
        });

        test("T026: returns empty array with message when no matches", async () => {
            // Arrange
            const mockSession = createMockSession({
                id: "session-123",
                sessionName: "Performance Trace",
                state: SessionState.Running,
            });

            const events = createMockEvents(5, { eventClass: "sql_statement_completed" });
            for (const event of events) {
                mockSession.events.add(event);
            }

            const mockManager = createMockSessionManager([mockSession]);
            const tool = new ProfilerQueryEventsTool(mockManager as any);

            const options = {
                input: {
                    sessionId: "session-123",
                    filters: [
                        {
                            field: "eventClass",
                            operator: FilterOperator.Equals,
                            value: "nonexistent_event_type",
                        } as FilterClause,
                    ],
                },
            } as vscode.LanguageModelToolInvocationOptions<QueryEventsParams>;

            // Act
            const result = await tool.call(options, mockToken);
            const parsed: QueryEventsResult = JSON.parse(result);

            // Assert
            expect(parsed.success).to.be.true;
            expect(parsed.events).to.be.an("array").that.is.empty;
            expect(parsed.message).to.include("No events");
        });

        test("T027: includes metadata (totalMatching, returned, truncated)", async () => {
            // Arrange
            const mockSession = createMockSession({
                id: "session-123",
                sessionName: "Performance Trace",
                state: SessionState.Running,
            });

            const events = createMockEvents(100);
            for (const event of events) {
                mockSession.events.add(event);
            }

            const mockManager = createMockSessionManager([mockSession]);
            const tool = new ProfilerQueryEventsTool(mockManager as any);

            const options = {
                input: { sessionId: "session-123", limit: 25 },
            } as vscode.LanguageModelToolInvocationOptions<QueryEventsParams>;

            // Act
            const result = await tool.call(options, mockToken);
            const parsed: QueryEventsResult = JSON.parse(result);

            // Assert
            expect(parsed.success).to.be.true;
            expect(parsed.metadata).to.exist;
            expect(parsed.metadata!.totalMatching).to.equal(100);
            expect(parsed.metadata!.returned).to.equal(25);
            expect(parsed.metadata!.truncated).to.be.true;
            expect(parsed.metadata!.textTruncationLimit).to.equal(512);
        });

        test("sorts by timestamp when specified", async () => {
            // Arrange
            const mockSession = createMockSession({
                id: "session-123",
                sessionName: "Performance Trace",
                state: SessionState.Running,
            });

            const events = createMockEvents(5, {
                baseTimestamp: new Date("2026-02-03T10:00:00Z").getTime(),
                timestampIncrement: 60000,
            });
            for (const event of events) {
                mockSession.events.add(event);
            }

            const mockManager = createMockSessionManager([mockSession]);
            const tool = new ProfilerQueryEventsTool(mockManager as any);

            const options = {
                input: {
                    sessionId: "session-123",
                    sortBy: "timestamp" as const,
                    sortOrder: "asc" as const,
                },
            } as vscode.LanguageModelToolInvocationOptions<QueryEventsParams>;

            // Act
            const result = await tool.call(options, mockToken);
            const parsed: QueryEventsResult = JSON.parse(result);

            // Assert
            expect(parsed.success).to.be.true;
            // Events should be in ascending timestamp order
            for (let i = 1; i < parsed.events!.length; i++) {
                const prev = new Date(parsed.events![i - 1].timestamp).getTime();
                const curr = new Date(parsed.events![i].timestamp).getTime();
                expect(curr).to.be.at.least(prev);
            }
        });
    });

    suite("prepareInvocation", () => {
        test("returns confirmation messages and invocation message", async () => {
            // Arrange
            const mockManager = createMockSessionManager([]);
            const tool = new ProfilerQueryEventsTool(mockManager as any);

            const options = {
                input: { sessionId: "test-session" },
            } as vscode.LanguageModelToolInvocationPrepareOptions<QueryEventsParams>;

            // Act
            const result = await tool.prepareInvocation(options, mockToken);

            // Assert
            expect(result.confirmationMessages).to.exist;
            expect(result.confirmationMessages!.title).to.include("Query");
            expect(result.confirmationMessages!.message).to.be.instanceOf(vscode.MarkdownString);
            expect(result.invocationMessage).to.be.a("string");
        });
    });
});
