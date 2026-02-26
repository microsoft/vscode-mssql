/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import {
    ProfilerConfigService,
    getProfilerConfigService,
} from "../../../src/profiler/profilerConfigService";
import {
    EventRow,
    EngineType,
    ViewTemplate,
    TEMPLATE_ID_STANDARD_ONPREM,
} from "../../../src/profiler/profilerTypes";

suite("ProfilerConfigService Tests", () => {
    let configService: ProfilerConfigService;

    setup(() => {
        configService = getProfilerConfigService();
    });

    suite("singleton pattern", () => {
        test("should return the same instance", () => {
            const instance1 = ProfilerConfigService.instance;
            const instance2 = ProfilerConfigService.instance;
            expect(instance1).to.equal(instance2);
        });

        test("getProfilerConfigService should return the singleton instance", () => {
            const instance1 = getProfilerConfigService();
            const instance2 = ProfilerConfigService.instance;
            expect(instance1).to.equal(instance2);
        });
    });

    suite("getTemplates", () => {
        test("should return all available templates", () => {
            const templates = configService.getTemplates();
            expect(templates).to.be.an("array");
            expect(templates.length).to.be.greaterThan(0);
        });

        test("should return templates with required properties", () => {
            const templates = configService.getTemplates();
            templates.forEach((template) => {
                expect(template).to.have.property("id");
                expect(template).to.have.property("name");
                expect(template).to.have.property("engineType");
                expect(template).to.have.property("defaultView");
                expect(template).to.have.property("createStatement");
            });
        });

        test("should include Standard_OnPrem template", () => {
            const templates = configService.getTemplates();
            const standardTemplate = templates.find((t) => t.id === TEMPLATE_ID_STANDARD_ONPREM);
            expect(standardTemplate).to.exist;
            expect(standardTemplate?.name).to.include("Standard");
        });
    });

    suite("getTemplatesForEngine", () => {
        test("should return templates for Standalone engine type", () => {
            const templates = configService.getTemplatesForEngine(EngineType.Standalone);
            expect(templates).to.be.an("array");
            templates.forEach((template) => {
                expect(template.engineType).to.equal(EngineType.Standalone);
            });
        });

        test("should return templates for AzureSQLDB engine type", () => {
            const templates = configService.getTemplatesForEngine(EngineType.AzureSQLDB);
            expect(templates).to.be.an("array");
            templates.forEach((template) => {
                expect(template.engineType).to.equal(EngineType.AzureSQLDB);
            });
        });

        test("should return empty array for non-existent engine type", () => {
            const templates = configService.getTemplatesForEngine("NonExistent" as EngineType);
            expect(templates).to.be.an("array");
            expect(templates.length).to.equal(0);
        });
    });

    suite("getTemplate", () => {
        test("should return a specific template by ID", () => {
            const template = configService.getTemplate(TEMPLATE_ID_STANDARD_ONPREM);
            expect(template).to.exist;
            expect(template?.id).to.equal(TEMPLATE_ID_STANDARD_ONPREM);
        });

        test("should return undefined for non-existent template", () => {
            const template = configService.getTemplate("NonExistentTemplate");
            expect(template).to.be.undefined;
        });
    });

    suite("getViews", () => {
        test("should return all available views", () => {
            const views = configService.getViews();
            expect(views).to.be.an("array");
            expect(views.length).to.be.greaterThan(0);
        });

        test("should return views with required properties", () => {
            const views = configService.getViews();
            views.forEach((view) => {
                expect(view).to.have.property("id");
                expect(view).to.have.property("name");
                expect(view).to.have.property("columns");
                expect(view.columns).to.be.an("array");
            });
        });

        test("should include Standard View", () => {
            const views = configService.getViews();
            const standardView = views.find((v) => v.id === "Standard View");
            expect(standardView).to.exist;
        });
    });

    suite("getView", () => {
        test("should return a specific view by ID", () => {
            const view = configService.getView("Standard View");
            expect(view).to.exist;
            expect(view?.id).to.equal("Standard View");
        });

        test("should return undefined for non-existent view", () => {
            const view = configService.getView("NonExistentView");
            expect(view).to.be.undefined;
        });
    });

    suite("getViewsForSession", () => {
        test("should return views compatible with a session template", () => {
            // Get the first template
            const templates = configService.getTemplates();
            if (templates.length > 0) {
                const views = configService.getViewsForSession(templates[0].id!);
                expect(views).to.be.an("array");
            }
        });

        test("should return empty array for non-existent session", () => {
            const views = configService.getViewsForSession("NonExistent");
            expect(views).to.be.an("array");
        });
    });

    suite("getSessionsForView", () => {
        test("should return sessions compatible with a view", () => {
            const views = configService.getViews();
            if (views.length > 0) {
                const sessions = configService.getSessionsForView(views[0].id!);
                expect(sessions).to.be.an("array");
            }
        });

        test("should return empty array for non-existent view", () => {
            const sessions = configService.getSessionsForView("NonExistent");
            expect(sessions).to.be.an("array");
        });
    });

    suite("getDefaultViewForTemplate", () => {
        test("should return default view for a template", () => {
            const view = configService.getDefaultViewForTemplate(TEMPLATE_ID_STANDARD_ONPREM);
            expect(view).to.exist;
        });

        test("should return undefined for non-existent template", () => {
            const view = configService.getDefaultViewForTemplate("NonExistent");
            expect(view).to.be.undefined;
        });
    });

    suite("convertEventToViewRow", () => {
        const createTestEvent = (overrides: Partial<EventRow> = {}): EventRow => ({
            id: "test-uuid-123",
            eventNumber: 1,
            timestamp: new Date(),
            eventClass: "SQL:BatchCompleted",
            textData: "SELECT * FROM users",
            databaseName: "TestDB",
            spid: 55,
            duration: 1000,
            cpu: 10,
            reads: 100,
            writes: 5,
            additionalData: {
                client_app_name: "TestApp",
                server_principal_name: "testuser",
                session_id: "55",
            },
            ...overrides,
        });

        test("should convert event to view row with mapped fields", () => {
            const view = configService.getView("Standard View");
            expect(view).to.exist;

            const event = createTestEvent();
            const viewRow = configService.convertEventToViewRow(event, view!);

            expect(viewRow).to.have.property("id", event.id);
            expect(viewRow).to.have.property("eventNumber", event.eventNumber);
        });

        test("should include all view columns in the result", () => {
            const view = configService.getView("Standard View");
            expect(view).to.exist;

            const event = createTestEvent();
            const viewRow = configService.convertEventToViewRow(event, view!);

            view!.columns.forEach((col) => {
                expect(viewRow).to.have.property(col.field);
            });
        });

        test("should map eventClass field correctly", () => {
            const view: ViewTemplate = {
                id: "TestView",
                name: "Test View",
                columns: [
                    {
                        field: "EventClass",
                        header: "Event",
                        eventsMapped: ["eventClass", "name"],
                    },
                ],
            };

            const event = createTestEvent({ eventClass: "RPC:Completed" });
            const viewRow = configService.convertEventToViewRow(event, view);

            expect(viewRow.EventClass).to.equal("RPC:Completed");
        });

        test("should map additionalData fields correctly", () => {
            const view: ViewTemplate = {
                id: "TestView",
                name: "Test View",
                columns: [
                    {
                        field: "ApplicationName",
                        header: "Application",
                        eventsMapped: ["client_app_name"],
                    },
                ],
            };

            const event = createTestEvent({
                additionalData: {
                    client_app_name: "MyApplication",
                },
            });
            const viewRow = configService.convertEventToViewRow(event, view);

            expect(viewRow.ApplicationName).to.equal("MyApplication");
        });

        test("should handle missing mapped fields gracefully", () => {
            const view: ViewTemplate = {
                id: "TestView",
                name: "Test View",
                columns: [
                    {
                        field: "MissingField",
                        header: "Missing",
                        eventsMapped: ["non_existent_field"],
                    },
                ],
            };

            const event = createTestEvent();
            const viewRow = configService.convertEventToViewRow(event, view);

            expect(viewRow.MissingField).to.be.undefined;
        });

        test("should format timestamp correctly", () => {
            const view: ViewTemplate = {
                id: "TestView",
                name: "Test View",
                columns: [
                    {
                        field: "StartTime",
                        header: "Start Time",
                        eventsMapped: ["timestamp"],
                    },
                ],
            };

            const testTimestamp = new Date("2024-01-15T10:30:00.000Z");
            const event = createTestEvent({ timestamp: testTimestamp });
            const viewRow = configService.convertEventToViewRow(event, view);

            // Should be formatted as ISO string without T and Z
            expect(viewRow.StartTime).to.include("2024-01-15");
            expect(viewRow.StartTime).to.include("10:30:00");
        });
    });

    suite("convertEventsToViewRows", () => {
        test("should convert multiple events to view rows", () => {
            const view = configService.getView("Standard View");
            expect(view).to.exist;

            const events: EventRow[] = [
                {
                    id: "uuid-1",
                    eventNumber: 1,
                    timestamp: new Date(),
                    eventClass: "Event1",
                    textData: "SELECT 1",
                    databaseName: "DB1",
                    spid: 50,
                    duration: 100,
                    cpu: 5,
                    reads: 10,
                    writes: 1,
                    additionalData: {},
                },
                {
                    id: "uuid-2",
                    eventNumber: 2,
                    timestamp: new Date(),
                    eventClass: "Event2",
                    textData: "SELECT 2",
                    databaseName: "DB2",
                    spid: 51,
                    duration: 200,
                    cpu: 10,
                    reads: 20,
                    writes: 2,
                    additionalData: {},
                },
            ];

            const viewRows = configService.convertEventsToViewRows(events, view!);

            expect(viewRows).to.be.an("array");
            expect(viewRows).to.have.length(2);
            expect(viewRows[0].id).to.equal("uuid-1");
            expect(viewRows[1].id).to.equal("uuid-2");
        });

        test("should return empty array for empty events", () => {
            const view = configService.getView("Standard View");
            expect(view).to.exist;

            const viewRows = configService.convertEventsToViewRows([], view!);

            expect(viewRows).to.be.an("array");
            expect(viewRows).to.have.length(0);
        });
    });

    suite("getSlickGridColumns", () => {
        test("should return SlickGrid column definitions from a view", () => {
            const view = configService.getView("Standard View");
            expect(view).to.exist;

            const columns = configService.getSlickGridColumns(view!);

            expect(columns).to.be.an("array");
            expect(columns.length).to.be.greaterThan(0);
        });

        test("should include required column properties", () => {
            const view = configService.getView("Standard View");
            expect(view).to.exist;

            const columns = configService.getSlickGridColumns(view!);

            columns.forEach((col) => {
                expect(col).to.have.property("id");
                expect(col).to.have.property("name");
                expect(col).to.have.property("field");
            });
        });

        test("should set default sortable and resizable values", () => {
            const view: ViewTemplate = {
                id: "TestView",
                name: "Test View",
                columns: [
                    {
                        field: "TestField",
                        header: "Test",
                        eventsMapped: ["test"],
                    },
                ],
            };

            const columns = configService.getSlickGridColumns(view);

            expect(columns[0].sortable).to.equal(true);
            expect(columns[0].resizable).to.equal(true);
            expect(columns[0].minWidth).to.equal(50);
        });

        test("should filter out non-visible columns", () => {
            const view: ViewTemplate = {
                id: "TestView",
                name: "Test View",
                columns: [
                    {
                        field: "VisibleField",
                        header: "Visible",
                        visible: true,
                        eventsMapped: ["visible"],
                    },
                    {
                        field: "HiddenField",
                        header: "Hidden",
                        visible: false,
                        eventsMapped: ["hidden"],
                    },
                ],
            };

            const columns = configService.getSlickGridColumns(view);

            expect(columns).to.have.length(1);
            expect(columns[0].field).to.equal("VisibleField");
        });
    });

    suite("generateCreateStatement", () => {
        test("should replace {sessionName} placeholder in create statement", () => {
            const template = configService.getTemplate(TEMPLATE_ID_STANDARD_ONPREM);
            expect(template).to.exist;

            const statement = configService.generateCreateStatement(template!, "MyTestSession");

            expect(statement).to.include("MyTestSession");
            expect(statement).to.not.include("{sessionName}");
        });

        test("should replace multiple occurrences of {sessionName}", () => {
            const template = {
                id: "test",
                name: "Test",
                engineType: EngineType.Standalone,
                defaultView: "Standard View",
                createStatement:
                    "CREATE EVENT SESSION [{sessionName}] ON SERVER; ALTER EVENT SESSION [{sessionName}] ON SERVER STATE = START;",
                eventsCaptured: [],
            };

            const statement = configService.generateCreateStatement(template, "TestSession");

            expect(statement).to.equal(
                "CREATE EVENT SESSION [TestSession] ON SERVER; ALTER EVENT SESSION [TestSession] ON SERVER STATE = START;",
            );
        });
    });

    suite("buildEventDetails", () => {
        const createViewTemplate = (): ViewTemplate => ({
            id: "TestView",
            name: "Test View",
            columns: [
                {
                    field: "eventClass",
                    header: "Event Class",
                    visible: true,
                    eventsMapped: ["name"],
                },
                {
                    field: "timestamp",
                    header: "Timestamp",
                    visible: true,
                    eventsMapped: ["timestamp"],
                },
                {
                    field: "textData",
                    header: "Text Data",
                    visible: true,
                    eventsMapped: ["sql_text", "statement"],
                },
            ],
        });

        const createEventRow = (overrides: Partial<EventRow> = {}): EventRow => ({
            id: "test-event-id",
            eventNumber: 1,
            timestamp: new Date("2024-01-01T12:00:00Z"),
            eventClass: "sql_statement_completed",
            textData: "SELECT * FROM Users",
            databaseName: "TestDB",
            spid: 55,
            duration: 1000,
            cpu: 100,
            reads: 50,
            writes: 10,
            additionalData: {},
            ...overrides,
        });

        test("should build properties from view columns", () => {
            const view = createViewTemplate();
            const event = createEventRow();

            const result = configService.buildEventDetails(event, view);

            expect(result.rowId).to.equal("test-event-id");
            expect(result.eventName).to.equal("sql_statement_completed");
            expect(result.textData).to.equal("SELECT * FROM Users");

            // Should have properties for each view column
            expect(result.properties).to.have.length(3);
            expect(result.properties[0].label).to.equal("Event Class");
            expect(result.properties[0].value).to.equal("sql_statement_completed");
            expect(result.properties[1].label).to.equal("Timestamp");
            expect(result.properties[2].label).to.equal("Text Data");
            expect(result.properties[2].value).to.equal("SELECT * FROM Users");
        });

        test("should include additional data not in view columns", () => {
            const view = createViewTemplate();
            const event = createEventRow({
                additionalData: {
                    custom_field: "custom_value",
                    another_field: "another_value",
                },
            });

            const result = configService.buildEventDetails(event, view);

            // Should include the additional data fields
            const customFieldProp = result.properties.find((p) => p.label === "custom_field");
            expect(customFieldProp).to.exist;
            expect(customFieldProp?.value).to.equal("custom_value");

            const anotherFieldProp = result.properties.find((p) => p.label === "another_field");
            expect(anotherFieldProp).to.exist;
            expect(anotherFieldProp?.value).to.equal("another_value");
        });

        test("should not duplicate fields already covered by view columns", () => {
            const view = createViewTemplate();
            const event = createEventRow({
                additionalData: {
                    // These are mapped by view columns, should not be duplicated
                    name: "duplicate_name",
                    sql_text: "duplicate_sql",
                    // This is not mapped, should be included
                    unmapped_field: "unmapped_value",
                },
            });

            const result = configService.buildEventDetails(event, view);

            // Count occurrences of each label
            const labels = result.properties.map((p) => p.label);

            // View columns should appear once
            expect(labels.filter((l) => l === "Event Class")).to.have.length(1);
            expect(labels.filter((l) => l === "Text Data")).to.have.length(1);

            // Unmapped field should appear
            expect(labels).to.include("unmapped_field");

            // Mapped fields from additionalData should not appear as separate properties
            expect(labels).to.not.include("name");
            expect(labels).to.not.include("sql_text");
        });

        test("should handle missing or null values", () => {
            const view = createViewTemplate();
            const event = createEventRow({
                textData: "",
                additionalData: {
                    empty_field: "",
                },
            });

            const result = configService.buildEventDetails(event, view);

            // textData should be empty string when empty
            expect(result.textData).to.equal("");

            // Properties with empty values should have empty string values
            const textDataProp = result.properties.find((p) => p.label === "Text Data");
            expect(textDataProp?.value).to.equal("");
        });

        test("should use empty string as fallback for eventName", () => {
            const view = createViewTemplate();
            const event = createEventRow({
                eventClass: "",
            });

            const result = configService.buildEventDetails(event, view);

            expect(result.eventName).to.equal("");
        });

        test("should handle empty textData", () => {
            const view = createViewTemplate();
            const event = createEventRow({
                textData: "",
            });

            const result = configService.buildEventDetails(event, view);

            expect(result.textData).to.equal("");
        });

        test("should handle event with no additional data", () => {
            const view = createViewTemplate();
            const event = createEventRow({
                additionalData: {},
            });

            const result = configService.buildEventDetails(event, view);

            // Should only have view column properties
            expect(result.properties).to.have.length(3);
        });

        test("should handle empty view columns", () => {
            const view: ViewTemplate = {
                id: "EmptyView",
                name: "Empty View",
                columns: [],
            };
            const event = createEventRow({
                additionalData: {
                    some_field: "some_value",
                },
            });

            const result = configService.buildEventDetails(event, view);

            // Should include additional data even with no view columns
            expect(result.properties).to.have.length(1);
            expect(result.properties[0].label).to.equal("some_field");
            expect(result.properties[0].value).to.equal("some_value");
        });
    });
});
