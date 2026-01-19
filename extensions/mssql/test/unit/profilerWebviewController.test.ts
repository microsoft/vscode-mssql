/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import * as chai from "chai";
import sinonChai from "sinon-chai";
import * as sinon from "sinon";
import * as vscode from "vscode";
import { ProfilerWebviewController } from "../../src/controllers/profilerWebviewController";
import * as profiler from "../../src/sharedInterfaces/profiler";
import { ApiStatus } from "../../src/sharedInterfaces/webview";
import VscodeWrapper from "../../src/controllers/vscodeWrapper";
import { stubVscodeWrapper } from "./utils";

chai.use(sinonChai);

suite("ProfilerWebviewController", () => {
    let sandbox: sinon.SinonSandbox;
    let mockContext: vscode.ExtensionContext;
    let controller: ProfilerWebviewController;
    let vscodeWrapper: sinon.SinonStubbedInstance<VscodeWrapper>;
    let mockInitialEvents: profiler.ProfilerEvent[];

    const sessionName = "TestSession";

    setup(() => {
        sandbox = sinon.createSandbox();
        mockContext = {
            extensionUri: vscode.Uri.parse("https://localhost"),
            extensionPath: "path",
        } as unknown as vscode.ExtensionContext;

        vscodeWrapper = stubVscodeWrapper(sandbox);

        mockInitialEvents = [
            {
                eventClass: "SQL:BatchCompleted",
                textData: "SELECT * FROM Users",
                applicationName: "SSMS",
                databaseName: "TestDB",
                loginName: "testuser",
                cpu: 10,
                duration: 100,
                reads: 5,
                writes: 2,
                startTime: "2024-01-19T10:00:00Z",
                spid: 52,
            },
            {
                eventClass: "SQL:StmtCompleted",
                textData: "UPDATE Products SET Price = 100 WHERE Id = 1",
                applicationName: "MyApp",
                databaseName: "TestDB",
                loginName: "appuser",
                cpu: 15,
                duration: 150,
                reads: 10,
                writes: 5,
                startTime: "2024-01-19T10:00:01Z",
                spid: 53,
            },
        ];

        controller = new ProfilerWebviewController(
            mockContext,
            vscodeWrapper,
            sessionName,
            mockInitialEvents,
        );
    });

    teardown(() => {
        sandbox.restore();
    });

    test("should initialize with correct state and webview title", () => {
        const expectedState: profiler.ProfilerWebviewState = {
            profilerState: {
                loadState: ApiStatus.Loaded,
                events: mockInitialEvents,
                detailsPanelVisible: false,
                detailsPanelMaximized: false,
                activeTab: "text",
            },
        };

        expect(controller.state, "Initial state should match").to.deep.equal(expectedState);
        expect(controller.panel.title, "Webview Title should match").to.equal(
            `SQL Profiler - ${sessionName}`,
        );
    });

    test("selectEvent reducer should update selectedEvent and show details panel", async () => {
        const event = mockInitialEvents[0];
        const mockPayload = { event };

        const result = await controller["_reducerHandlers"].get("selectEvent")(
            controller.state,
            mockPayload,
        );

        expect(result.profilerState.selectedEvent, "Selected event should be set").to.equal(event);
        expect(
            result.profilerState.detailsPanelVisible,
            "Details panel should be visible",
        ).to.be.true;
    });

    test("closeDetailsPanel reducer should hide the details panel", async () => {
        // First select an event
        const event = mockInitialEvents[0];
        controller.state.profilerState.selectedEvent = event;
        controller.state.profilerState.detailsPanelVisible = true;

        const result = await controller["_reducerHandlers"].get("closeDetailsPanel")(
            controller.state,
            {},
        );

        expect(
            result.profilerState.detailsPanelVisible,
            "Details panel should be hidden",
        ).to.be.false;
        expect(
            result.profilerState.selectedEvent,
            "Selected event should still be set",
        ).to.equal(event);
    });

    test("toggleMaximize reducer should toggle the maximize state", async () => {
        const initialMaximized = controller.state.profilerState.detailsPanelMaximized;

        const result = await controller["_reducerHandlers"].get("toggleMaximize")(
            controller.state,
            {},
        );

        expect(
            result.profilerState.detailsPanelMaximized,
            "Maximize state should be toggled",
        ).to.equal(!initialMaximized);
    });

    test("switchTab reducer should change the active tab", async () => {
        const mockPayload = { tab: "details" as const };

        const result = await controller["_reducerHandlers"].get("switchTab")(
            controller.state,
            mockPayload,
        );

        expect(result.profilerState.activeTab, "Active tab should be updated").to.equal("details");
    });

    test("openInEditor reducer should open text in a new editor", async () => {
        const textData = "SELECT * FROM TestTable";
        const mockPayload = { textData, language: "sql" };

        const openTextDocumentStub = sandbox.stub(vscode.workspace, "openTextDocument");
        const showTextDocumentStub = sandbox.stub(vscode.window, "showTextDocument");

        const mockDocument = {} as vscode.TextDocument;
        openTextDocumentStub.resolves(mockDocument);
        showTextDocumentStub.resolves({} as vscode.TextEditor);

        const result = await controller["_reducerHandlers"].get("openInEditor")(
            controller.state,
            mockPayload,
        );

        expect(openTextDocumentStub).to.have.been.calledOnce;
        expect(openTextDocumentStub).to.have.been.calledWith({
            content: textData,
            language: "sql",
        });

        expect(showTextDocumentStub).to.have.been.calledOnce;
        expect(result, "State should remain unchanged").to.equal(controller.state);

        openTextDocumentStub.restore();
        showTextDocumentStub.restore();
    });

    test("copyTextData reducer should copy text to clipboard", async () => {
        const textData = "SELECT * FROM TestTable";
        const mockPayload = { textData };

        const writeTextStub = sandbox.stub(vscode.env.clipboard, "writeText").resolves();
        const showInformationMessageStub = sandbox
            .stub(vscode.window, "showInformationMessage")
            .resolves(undefined);

        const result = await controller["_reducerHandlers"].get("copyTextData")(
            controller.state,
            mockPayload,
        );

        expect(writeTextStub).to.have.been.calledOnceWith(textData);
        expect(showInformationMessageStub).to.have.been.calledOnce;
        expect(result, "State should remain unchanged").to.equal(controller.state);

        writeTextStub.restore();
        showInformationMessageStub.restore();
    });

    test("addEvents reducer should append new events to the existing events", async () => {
        const newEvents: profiler.ProfilerEvent[] = [
            {
                eventClass: "SQL:BatchStarting",
                textData: "SELECT COUNT(*) FROM Orders",
                applicationName: "ReportApp",
                databaseName: "TestDB",
                loginName: "reportuser",
                cpu: 5,
                duration: 50,
                reads: 3,
                writes: 0,
                startTime: "2024-01-19T10:00:02Z",
                spid: 54,
            },
        ];

        const mockPayload = { events: newEvents };

        const result = await controller["_reducerHandlers"].get("addEvents")(
            controller.state,
            mockPayload,
        );

        expect(result.profilerState.events).to.have.lengthOf(3);
        expect(result.profilerState.events[2]).to.deep.equal(newEvents[0]);
    });

    test("initializeProfiler reducer should replace events", async () => {
        const newEvents: profiler.ProfilerEvent[] = [
            {
                eventClass: "SQL:StmtStarting",
                textData: "DELETE FROM OldData WHERE Created < '2020-01-01'",
                applicationName: "CleanupJob",
                databaseName: "MainDB",
                loginName: "sysadmin",
            },
        ];

        const mockPayload = { events: newEvents };

        const result = await controller["_reducerHandlers"].get("initializeProfiler")(
            controller.state,
            mockPayload,
        );

        expect(result.profilerState.events).to.have.lengthOf(1);
        expect(result.profilerState.events[0]).to.deep.equal(newEvents[0]);
        expect(result.profilerState.loadState).to.equal(ApiStatus.Loaded);
    });

    test("addEvents method should update state and add events", () => {
        const newEvents: profiler.ProfilerEvent[] = [
            {
                eventClass: "SQL:BatchStarting",
                textData: "INSERT INTO Logs VALUES ('test')",
            },
        ];

        const initialEventCount = controller.state.profilerState.events.length;
        controller.addEvents(newEvents);

        expect(controller.state.profilerState.events).to.have.lengthOf(initialEventCount + 1);
    });
});

suite("ProfilerWebviewController - Accessibility and Edge Cases", () => {
    let sandbox: sinon.SinonSandbox;
    let mockContext: vscode.ExtensionContext;
    let controller: ProfilerWebviewController;
    let vscodeWrapper: sinon.SinonStubbedInstance<VscodeWrapper>;

    setup(() => {
        sandbox = sinon.createSandbox();
        mockContext = {
            extensionUri: vscode.Uri.parse("https://localhost"),
            extensionPath: "path",
        } as unknown as vscode.ExtensionContext;

        vscodeWrapper = stubVscodeWrapper(sandbox);

        controller = new ProfilerWebviewController(
            mockContext,
            vscodeWrapper,
            "EmptySession",
            [],
        );
    });

    teardown(() => {
        sandbox.restore();
    });

    test("should handle empty events array gracefully", () => {
        expect(controller.state.profilerState.events).to.have.lengthOf(0);
        expect(controller.state.profilerState.loadState).to.equal(ApiStatus.Loaded);
    });

    test("should handle event with null/undefined textData", async () => {
        const event: profiler.ProfilerEvent = {
            eventClass: "SQL:BatchCompleted",
            textData: undefined,
            databaseName: "TestDB",
        };

        const mockPayload = { event };

        const result = await controller["_reducerHandlers"].get("selectEvent")(
            controller.state,
            mockPayload,
        );

        expect(result.profilerState.selectedEvent).to.equal(event);
        expect(result.profilerState.detailsPanelVisible).to.be.true;
    });

    test("copyTextData should handle empty string", async () => {
        const mockPayload = { textData: "" };

        const writeTextStub = sandbox.stub(vscode.env.clipboard, "writeText").resolves();
        const showInformationMessageStub = sandbox
            .stub(vscode.window, "showInformationMessage")
            .resolves(undefined);

        const result = await controller["_reducerHandlers"].get("copyTextData")(
            controller.state,
            mockPayload,
        );

        expect(writeTextStub).to.have.been.calledOnceWith("");
        expect(result).to.equal(controller.state);

        writeTextStub.restore();
        showInformationMessageStub.restore();
    });

    test("openInEditor should handle default language when not specified", async () => {
        const mockPayload = { textData: "SELECT 1" };

        const openTextDocumentStub = sandbox.stub(vscode.workspace, "openTextDocument");
        const showTextDocumentStub = sandbox.stub(vscode.window, "showTextDocument");

        openTextDocumentStub.resolves({} as vscode.TextDocument);
        showTextDocumentStub.resolves({} as vscode.TextEditor);

        await controller["_reducerHandlers"].get("openInEditor")(
            controller.state,
            mockPayload,
        );

        expect(openTextDocumentStub).to.have.been.calledWith({
            content: "SELECT 1",
            language: "sql",
        });

        openTextDocumentStub.restore();
        showTextDocumentStub.restore();
    });
});
