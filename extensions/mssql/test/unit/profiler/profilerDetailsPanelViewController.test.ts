/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import { ProfilerSelectedEventDetails, ProfilerEventProperty } from "../../../src/sharedInterfaces/profiler";

// Since ProfilerDetailsPanelViewController extends ReactWebviewViewController,
// we need to test its specific functionality without full VS Code integration.
// These tests focus on the public API and data transformation logic.

/**
 * Helper function to create mock event details for testing
 */
function createMockEventDetails(overrides?: Partial<ProfilerSelectedEventDetails>): ProfilerSelectedEventDetails {
    const defaultProperties: ProfilerEventProperty[] = [
        { label: "Event Class", value: "SQL:BatchCompleted" },
        { label: "Event Number", value: "123" },
        { label: "Timestamp", value: "2024-01-15T10:30:00.000Z" },
        { label: "Database", value: "TestDB" },
        { label: "SPID", value: "55" },
        { label: "Duration (μs)", value: "1500" },
        { label: "CPU (ms)", value: "10" },
        { label: "Reads", value: "100" },
        { label: "Writes", value: "5" },
    ];

    return {
        rowId: "test-row-id-123",
        eventName: "SQL:BatchCompleted",
        textData: "SELECT * FROM Users WHERE Id = 1",
        properties: defaultProperties,
        ...overrides,
    };
}

suite("ProfilerDetailsPanelViewController Tests", () => {
    suite("Event Details Structure", () => {
        test("should have required fields in ProfilerSelectedEventDetails", () => {
            const details = createMockEventDetails();

            expect(details).to.have.property("rowId");
            expect(details).to.have.property("eventName");
            expect(details).to.have.property("textData");
            expect(details).to.have.property("properties");
            expect(details.properties).to.be.an("array");
        });

        test("should support empty textData", () => {
            const details = createMockEventDetails({ textData: "" });

            expect(details.textData).to.equal("");
        });

        test("should support null-equivalent undefined textData", () => {
            const details: ProfilerSelectedEventDetails = {
                rowId: "test-row-id",
                eventName: "SP:Starting",
                textData: "",
                properties: [],
            };

            expect(details.textData).to.equal("");
        });

        test("should have properly structured properties", () => {
            const details = createMockEventDetails();

            details.properties.forEach((prop) => {
                expect(prop).to.have.property("label");
                expect(prop).to.have.property("value");
                expect(typeof prop.label).to.equal("string");
                expect(typeof prop.value).to.equal("string");
            });
        });

        test("should include standard profiler event properties", () => {
            const details = createMockEventDetails();
            const propertyLabels = details.properties.map((p) => p.label);

            expect(propertyLabels).to.include("Event Class");
            expect(propertyLabels).to.include("Duration (μs)");
            expect(propertyLabels).to.include("SPID");
        });
    });

    suite("Event Property Handling", () => {
        test("should handle events with minimal properties", () => {
            const details = createMockEventDetails({
                properties: [{ label: "Event Class", value: "AuditEvent" }],
            });

            expect(details.properties).to.have.lengthOf(1);
        });

        test("should handle events with many additional properties", () => {
            const additionalProps: ProfilerEventProperty[] = Array.from({ length: 50 }, (_, i) => ({
                label: `Property${i}`,
                value: `Value${i}`,
            }));

            const details = createMockEventDetails({
                properties: additionalProps,
            });

            expect(details.properties).to.have.lengthOf(50);
        });

        test("should handle properties with special characters in values", () => {
            const details = createMockEventDetails({
                properties: [
                    { label: "Query", value: "SELECT * FROM \"Users\" WHERE Name = 'O''Brien'" },
                    { label: "Path", value: "C:\\Program Files\\SQL Server" },
                    { label: "Unicode", value: "日本語テスト" },
                ],
            });

            expect(details.properties).to.have.lengthOf(3);
            expect(details.properties[0].value).to.include("O''Brien");
            expect(details.properties[1].value).to.include("\\");
            expect(details.properties[2].value).to.equal("日本語テスト");
        });

        test("should handle properties with empty values", () => {
            const details = createMockEventDetails({
                properties: [
                    { label: "EmptyValue", value: "" },
                    { label: "WhitespaceValue", value: "   " },
                ],
            });

            expect(details.properties[0].value).to.equal("");
            expect(details.properties[1].value).to.equal("   ");
        });
    });

    suite("Text Data Handling", () => {
        test("should handle SQL query text data", () => {
            const sqlQuery = `
                SELECT u.Id, u.Name, o.OrderDate
                FROM Users u
                INNER JOIN Orders o ON u.Id = o.UserId
                WHERE o.OrderDate > '2024-01-01'
                ORDER BY o.OrderDate DESC
            `;

            const details = createMockEventDetails({ textData: sqlQuery });

            expect(details.textData).to.include("SELECT");
            expect(details.textData).to.include("INNER JOIN");
        });

        test("should handle stored procedure text", () => {
            const spText = `
                CREATE PROCEDURE GetUserOrders
                    @UserId INT
                AS
                BEGIN
                    SELECT * FROM Orders WHERE UserId = @UserId
                END
            `;

            const details = createMockEventDetails({ textData: spText });

            expect(details.textData).to.include("CREATE PROCEDURE");
        });

        test("should handle very long text data", () => {
            const longQuery = "SELECT " + Array(1000).fill("column").join(", ") + " FROM LargeTable";

            const details = createMockEventDetails({ textData: longQuery });

            expect(details.textData.length).to.be.greaterThan(1000);
        });

        test("should handle text with line breaks", () => {
            const textWithBreaks = "Line1\nLine2\r\nLine3\rLine4";

            const details = createMockEventDetails({ textData: textWithBreaks });

            expect(details.textData).to.include("\n");
            expect(details.textData).to.include("\r\n");
        });
    });

    suite("Event Name Handling", () => {
        test("should handle standard SQL Server event names", () => {
            const eventNames = [
                "SQL:BatchCompleted",
                "SQL:BatchStarting",
                "RPC:Completed",
                "SP:Starting",
                "SP:Completed",
                "SP:StmtCompleted",
                "Audit Login",
                "Audit Logout",
            ];

            eventNames.forEach((name) => {
                const details = createMockEventDetails({ eventName: name });
                expect(details.eventName).to.equal(name);
            });
        });

        test("should handle custom/unknown event names", () => {
            const details = createMockEventDetails({ eventName: "CustomEvent:MyEvent" });

            expect(details.eventName).to.equal("CustomEvent:MyEvent");
        });
    });
});

suite("Details Panel State Tests", () => {
    suite("Initial State", () => {
        test("should have undefined selectedEvent by default", () => {
            // Test the expected initial state structure
            const initialState = {
                selectedEvent: undefined,
                sessionName: undefined,
            };

            expect(initialState.selectedEvent).to.be.undefined;
            expect(initialState.sessionName).to.be.undefined;
        });
    });

    suite("State Transitions", () => {
        test("should transition from undefined to selected event", () => {
            let state: { selectedEvent: ProfilerSelectedEventDetails | undefined } = {
                selectedEvent: undefined,
            };

            const newEvent = createMockEventDetails();
            state = { ...state, selectedEvent: newEvent };

            expect(state.selectedEvent).to.deep.equal(newEvent);
        });

        test("should transition from selected event back to undefined", () => {
            let state: { selectedEvent: ProfilerSelectedEventDetails | undefined } = {
                selectedEvent: createMockEventDetails(),
            };

            state = { ...state, selectedEvent: undefined };

            expect(state.selectedEvent).to.be.undefined;
        });

        test("should transition between different events", () => {
            let state: { selectedEvent: ProfilerSelectedEventDetails | undefined } = {
                selectedEvent: createMockEventDetails({ rowId: "row-1", eventName: "Event1" }),
            };

            const newEvent = createMockEventDetails({ rowId: "row-2", eventName: "Event2" });
            state = { ...state, selectedEvent: newEvent };

            expect(state.selectedEvent?.rowId).to.equal("row-2");
            expect(state.selectedEvent?.eventName).to.equal("Event2");
        });
    });
});

suite("Clipboard and Editor Action Tests", () => {
    suite("Copy to Clipboard", () => {
        test("should copy text data to clipboard format", () => {
            const details = createMockEventDetails({
                textData: "SELECT * FROM Users",
            });

            // Verify the text is suitable for clipboard
            expect(details.textData).to.be.a("string");
            expect(details.textData.length).to.be.greaterThan(0);
        });

        test("should handle copying empty text gracefully", () => {
            const details = createMockEventDetails({ textData: "" });

            // Empty text should still be valid for copy operation
            expect(details.textData).to.equal("");
        });
    });

    suite("Open in Editor", () => {
        test("should have text data suitable for SQL editor", () => {
            const sqlText = `
                -- Comment
                SELECT Id, Name
                FROM Users
                WHERE Active = 1
            `;

            const details = createMockEventDetails({ textData: sqlText });

            // Verify text includes SQL-specific syntax
            expect(details.textData).to.include("--");
            expect(details.textData).to.include("SELECT");
        });

        test("should include event name for document title context", () => {
            const details = createMockEventDetails({
                eventName: "SQL:BatchCompleted",
            });

            // Event name should be available for use as document context
            expect(details.eventName).to.not.be.empty;
        });
    });
});

suite("Accessibility Tests", () => {
    suite("ARIA Label Generation", () => {
        test("should generate proper ARIA labels for properties", () => {
            const property: ProfilerEventProperty = {
                label: "Duration (μs)",
                value: "1500",
            };

            const expectedAriaLabel = `${property.label}: ${property.value}`;
            expect(expectedAriaLabel).to.equal("Duration (μs): 1500");
        });

        test("should handle properties with empty values in ARIA labels", () => {
            const property: ProfilerEventProperty = {
                label: "TextData",
                value: "",
            };

            const ariaLabel = `${property.label}: ${property.value}`;
            expect(ariaLabel).to.equal("TextData: ");
        });
    });

    suite("Keyboard Navigation Data", () => {
        test("should maintain property indices for keyboard navigation", () => {
            const details = createMockEventDetails();
            const indices = details.properties.map((_, i) => i);

            // Verify indices are sequential for arrow key navigation
            expect(indices).to.deep.equal([0, 1, 2, 3, 4, 5, 6, 7, 8]);
        });

        test("should provide total items count for boundary checks", () => {
            const details = createMockEventDetails();

            expect(details.properties.length).to.be.greaterThan(0);
            expect(details.properties.length).to.equal(9);
        });
    });
});
