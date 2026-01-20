/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import {
    ProfilerConfigService,
    getProfilerConfigService,
} from "../../../src/profiler/profilerConfigService";
import { EventRow, ViewTemplate } from "../../../src/profiler/profilerTypes";

suite("ProfilerConfigService Tests", () => {
    let configService: ProfilerConfigService;

    setup(() => {
        configService = getProfilerConfigService();
    });

    suite("buildEventDetails", () => {
        const testViewTemplate: ViewTemplate = {
            id: "Standard",
            name: "Standard View",
            columns: [
                { field: "eventClass", header: "Event Class", width: 150, eventsMapped: ["name"] },
                {
                    field: "textData",
                    header: "Text Data",
                    width: 400,
                    eventsMapped: ["batch_text", "statement"],
                },
                {
                    field: "databaseName",
                    header: "Database",
                    width: 100,
                    eventsMapped: ["database_name"],
                },
                { field: "spid", header: "SPID", width: 60, eventsMapped: ["session_id"] },
                { field: "duration", header: "Duration", width: 80, eventsMapped: ["duration"] },
                { field: "cpu", header: "CPU", width: 60, eventsMapped: ["cpu_time"] },
                { field: "reads", header: "Reads", width: 80, eventsMapped: ["logical_reads"] },
                { field: "writes", header: "Writes", width: 80, eventsMapped: ["writes"] },
                {
                    field: "timestamp",
                    header: "Timestamp",
                    width: 180,
                    eventsMapped: ["timestamp"],
                },
            ],
        };

        function createTestEvent(overrides: Partial<EventRow> = {}): EventRow {
            return {
                id: "event-123",
                eventNumber: 1,
                timestamp: new Date("2024-01-15T10:30:00Z").getTime(),
                eventClass: "sql_batch_completed",
                textData: "SELECT * FROM Users WHERE Id = 1",
                databaseName: "TestDatabase",
                spid: 55,
                duration: 1500,
                cpu: 20,
                reads: 150,
                writes: 10,
                additionalData: {},
                ...overrides,
            };
        }

        test("should build event details with all columns from view template", () => {
            const event = createTestEvent();
            const details = configService.buildEventDetails(event, testViewTemplate);

            expect(details.rowId).to.equal("event-123");
            expect(details.eventName).to.equal("sql_batch_completed");
            expect(details.textData).to.equal("SELECT * FROM Users WHERE Id = 1");
            expect(details.properties).to.have.length(testViewTemplate.columns.length);
        });

        test("should include event class property", () => {
            const event = createTestEvent({ eventClass: "sql_statement_completed" });
            const details = configService.buildEventDetails(event, testViewTemplate);

            const eventClassProp = details.properties.find((p) => p.label === "Event Class");
            expect(eventClassProp).to.exist;
            expect(eventClassProp!.value).to.equal("sql_statement_completed");
        });

        test("should include text data property", () => {
            const event = createTestEvent({ textData: "INSERT INTO Logs VALUES (1)" });
            const details = configService.buildEventDetails(event, testViewTemplate);

            const textDataProp = details.properties.find((p) => p.label === "Text Data");
            expect(textDataProp).to.exist;
            expect(textDataProp!.value).to.equal("INSERT INTO Logs VALUES (1)");
        });

        test("should include database name property", () => {
            const event = createTestEvent({ databaseName: "ProductionDB" });
            const details = configService.buildEventDetails(event, testViewTemplate);

            const dbProp = details.properties.find((p) => p.label === "Database");
            expect(dbProp).to.exist;
            expect(dbProp!.value).to.equal("ProductionDB");
        });

        test("should include numeric properties as strings", () => {
            const event = createTestEvent({
                spid: 100,
                duration: 5000,
                cpu: 50,
                reads: 1000,
                writes: 25,
            });
            const details = configService.buildEventDetails(event, testViewTemplate);

            const spidProp = details.properties.find((p) => p.label === "SPID");
            expect(spidProp).to.exist;
            expect(spidProp!.value).to.equal("100");

            const durationProp = details.properties.find((p) => p.label === "Duration");
            expect(durationProp).to.exist;
            expect(durationProp!.value).to.equal("5000");

            const cpuProp = details.properties.find((p) => p.label === "CPU");
            expect(cpuProp).to.exist;
            expect(cpuProp!.value).to.equal("50");

            const readsProp = details.properties.find((p) => p.label === "Reads");
            expect(readsProp).to.exist;
            expect(readsProp!.value).to.equal("1000");

            const writesProp = details.properties.find((p) => p.label === "Writes");
            expect(writesProp).to.exist;
            expect(writesProp!.value).to.equal("25");
        });

        test("should handle missing optional properties gracefully", () => {
            const event = createTestEvent({
                textData: undefined,
                databaseName: undefined,
                duration: undefined,
            });
            const details = configService.buildEventDetails(event, testViewTemplate);

            // Should still have all properties from the view template
            expect(details.properties).to.have.length(testViewTemplate.columns.length);

            // Missing values should be empty strings
            const textDataProp = details.properties.find((p) => p.label === "Text Data");
            expect(textDataProp!.value).to.equal("");

            const dbProp = details.properties.find((p) => p.label === "Database");
            expect(dbProp!.value).to.equal("");
        });

        test("should use event.id for rowId", () => {
            const event = createTestEvent({ id: "custom-row-id-456" });
            const details = configService.buildEventDetails(event, testViewTemplate);

            expect(details.rowId).to.equal("custom-row-id-456");
        });

        test("should default eventName to 'Unknown Event' when eventClass is missing", () => {
            const event = createTestEvent({ eventClass: undefined });
            const details = configService.buildEventDetails(event, testViewTemplate);

            expect(details.eventName).to.equal("Unknown Event");
        });

        test("should include additional data not covered by view columns", () => {
            const event = createTestEvent({
                additionalData: {
                    custom_field: "custom_value",
                    another_field: "another_value",
                },
            });
            const details = configService.buildEventDetails(event, testViewTemplate);

            // Should include properties for additional data
            const customProp = details.properties.find((p) => p.label === "custom_field");
            expect(customProp).to.exist;
            expect(customProp!.value).to.equal("custom_value");

            const anotherProp = details.properties.find((p) => p.label === "another_field");
            expect(anotherProp).to.exist;
            expect(anotherProp!.value).to.equal("another_value");
        });

        test("should not duplicate fields already in view columns", () => {
            const event = createTestEvent({
                additionalData: {
                    batch_text: "Should be skipped - covered by textData column",
                    statement: "Should also be skipped",
                },
            });
            const details = configService.buildEventDetails(event, testViewTemplate);

            // Count occurrences of Text Data label
            const textDataLabels = details.properties.filter((p) => p.label === "Text Data");
            expect(textDataLabels).to.have.length(1);

            // Should not include batch_text or statement as separate properties
            const batchTextProp = details.properties.find((p) => p.label === "batch_text");
            expect(batchTextProp).to.not.exist;

            const statementProp = details.properties.find((p) => p.label === "statement");
            expect(statementProp).to.not.exist;
        });

        test("should work with minimal view template", () => {
            const minimalView: ViewTemplate = {
                id: "Minimal",
                name: "Minimal View",
                columns: [
                    { field: "eventClass", header: "Event", width: 100, eventsMapped: ["name"] },
                ],
            };
            const event = createTestEvent();
            const details = configService.buildEventDetails(event, minimalView);

            expect(details.properties).to.have.length(1);
            expect(details.properties[0].label).to.equal("Event");
            expect(details.properties[0].value).to.equal("sql_batch_completed");
        });

        test("should handle event with mapped field values", () => {
            // Test that eventsMapped values are used to get column values
            const event = createTestEvent({
                textData: undefined,
                additionalData: {
                    batch_text: "Query from batch_text field",
                },
            });
            const details = configService.buildEventDetails(event, testViewTemplate);

            // The textData column has eventsMapped: ['batch_text', 'statement']
            // So it should find the value from additionalData.batch_text
            const textDataProp = details.properties.find((p) => p.label === "Text Data");
            expect(textDataProp).to.exist;
            expect(textDataProp!.value).to.equal("Query from batch_text field");
        });
    });

    suite("convertEventToViewRow", () => {
        const testViewTemplate: ViewTemplate = {
            id: "Test",
            name: "Test View",
            columns: [
                { field: "eventClass", header: "Event", width: 100, eventsMapped: ["name"] },
                { field: "textData", header: "SQL", width: 300, eventsMapped: ["batch_text"] },
                { field: "duration", header: "Duration", width: 80, eventsMapped: ["duration"] },
            ],
        };

        function createTestEvent(): EventRow {
            return {
                id: "event-1",
                eventNumber: 1,
                timestamp: Date.now(),
                eventClass: "sql_batch_completed",
                textData: "SELECT 1",
                databaseName: "TestDB",
                spid: 55,
                duration: 1000,
                cpu: 10,
                reads: 100,
                writes: 5,
                additionalData: {},
            };
        }

        test("should convert event to view row format", () => {
            const event = createTestEvent();
            const viewRow = configService.convertEventToViewRow(event, testViewTemplate);

            expect(viewRow.id).to.equal("event-1");
            expect(viewRow.eventClass).to.equal("sql_batch_completed");
            expect(viewRow.textData).to.equal("SELECT 1");
            expect(viewRow.duration).to.equal(1000); // Numbers stay as numbers
        });

        test("should handle missing values", () => {
            const event = createTestEvent();
            event.textData = undefined;
            event.duration = undefined;

            const viewRow = configService.convertEventToViewRow(event, testViewTemplate);

            expect(viewRow.textData).to.be.null;
            expect(viewRow.duration).to.be.null;
        });
    });

    suite("getSlickGridColumns", () => {
        test("should convert view template columns to SlickGrid format", () => {
            const viewTemplate: ViewTemplate = {
                id: "Test",
                name: "Test View",
                columns: [
                    {
                        field: "eventClass",
                        header: "Event",
                        width: 150,
                        eventsMapped: ["name"],
                        sortable: true,
                    },
                    {
                        field: "textData",
                        header: "SQL Text",
                        width: 400,
                        eventsMapped: ["batch_text"],
                        visible: true,
                    },
                    {
                        field: "hidden",
                        header: "Hidden Column",
                        width: 100,
                        eventsMapped: [],
                        visible: false,
                    },
                ],
            };

            const columns = configService.getSlickGridColumns(viewTemplate);

            // Should filter out hidden columns
            expect(columns).to.have.length(2);

            expect(columns[0].id).to.equal("eventClass");
            expect(columns[0].name).to.equal("Event");
            expect(columns[0].field).to.equal("eventClass");
            expect(columns[0].width).to.equal(150);
            expect(columns[0].sortable).to.be.true;

            expect(columns[1].id).to.equal("textData");
            expect(columns[1].name).to.equal("SQL Text");
            expect(columns[1].field).to.equal("textData");
            expect(columns[1].width).to.equal(400);
        });

        test("should default sortable to true", () => {
            const viewTemplate: ViewTemplate = {
                id: "Test",
                name: "Test View",
                columns: [{ field: "test", header: "Test", width: 100, eventsMapped: [] }],
            };

            const columns = configService.getSlickGridColumns(viewTemplate);
            expect(columns[0].sortable).to.be.true;
        });
    });

    suite("singleton", () => {
        test("should return same instance", () => {
            const instance1 = getProfilerConfigService();
            const instance2 = getProfilerConfigService();

            expect(instance1).to.equal(instance2);
        });

        test("should return ProfilerConfigService instance", () => {
            const instance = getProfilerConfigService();
            expect(instance).to.be.instanceOf(ProfilerConfigService);
        });
    });
});
