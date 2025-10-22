/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from "assert";
import * as os from "os";
import { QueryHistoryNode, EmptyHistoryNode } from "../../src/queryHistory/queryHistoryNode";
import * as LocalizedConstants from "../../src/constants/locConstants";

suite("Query History Node Tests", () => {
    test("QueryHistoryNode should have accessibilityInformation", () => {
        // Arrange
        const label = "SELECT * FROM table";
        const tooltip = "Connection info\n\nTimestamp\n\nQuery";
        const queryString = "SELECT * FROM table";
        const ownerUri = "file:///test.sql";
        const timeStamp = new Date();
        const connectionLabel = "(server|database)";
        const isSuccess = true;

        // Act
        const node = new QueryHistoryNode(
            label,
            tooltip,
            queryString,
            ownerUri,
            timeStamp,
            connectionLabel,
            isSuccess,
        );

        // Assert
        assert.ok(node.accessibilityInformation, "accessibilityInformation should be defined");
        assert.ok(
            node.accessibilityInformation.label.includes(tooltip),
            "accessibilityInformation label should include tooltip content",
        );
        assert.ok(
            node.accessibilityInformation.label.includes(LocalizedConstants.querySuccess),
            "accessibilityInformation label should include query status",
        );
    });

    test("QueryHistoryNode should include success status in accessibility label", () => {
        // Arrange
        const label = "SELECT * FROM table";
        const tooltip = "Connection info";
        const queryString = "SELECT * FROM table";
        const ownerUri = "file:///test.sql";
        const timeStamp = new Date();
        const connectionLabel = "(server|database)";
        const isSuccess = true;

        // Act
        const node = new QueryHistoryNode(
            label,
            tooltip,
            queryString,
            ownerUri,
            timeStamp,
            connectionLabel,
            isSuccess,
        );

        // Assert
        const expectedLabel = `${tooltip}${os.EOL}${os.EOL}${LocalizedConstants.querySuccess}`;
        assert.strictEqual(
            node.accessibilityInformation.label,
            expectedLabel,
            "accessibilityInformation label should match expected format for successful query",
        );
    });

    test("QueryHistoryNode should include failure status in accessibility label", () => {
        // Arrange
        const label = "SELECT * FROM table";
        const tooltip = "Connection info";
        const queryString = "SELECT * FROM table";
        const ownerUri = "file:///test.sql";
        const timeStamp = new Date();
        const connectionLabel = "(server|database)";
        const isSuccess = false;

        // Act
        const node = new QueryHistoryNode(
            label,
            tooltip,
            queryString,
            ownerUri,
            timeStamp,
            connectionLabel,
            isSuccess,
        );

        // Assert
        const expectedLabel = `${tooltip}${os.EOL}${os.EOL}${LocalizedConstants.queryFailed}`;
        assert.strictEqual(
            node.accessibilityInformation.label,
            expectedLabel,
            "accessibilityInformation label should match expected format for failed query",
        );
    });

    test("QueryHistoryNode accessibility label should match tooltip", () => {
        // Arrange
        const label = "SELECT * FROM table";
        const tooltip = "Connection info";
        const queryString = "SELECT * FROM table";
        const ownerUri = "file:///test.sql";
        const timeStamp = new Date();
        const connectionLabel = "(server|database)";
        const isSuccess = true;

        // Act
        const node = new QueryHistoryNode(
            label,
            tooltip,
            queryString,
            ownerUri,
            timeStamp,
            connectionLabel,
            isSuccess,
        );

        // Assert - accessibility label and tooltip should have the same content
        assert.strictEqual(
            node.accessibilityInformation.label,
            node.tooltip,
            "accessibilityInformation label should match tooltip content",
        );
    });

    test("EmptyHistoryNode should have accessibilityInformation", () => {
        // Act
        const node = new EmptyHistoryNode();

        // Assert
        assert.ok(node.accessibilityInformation, "accessibilityInformation should be defined");
        assert.strictEqual(
            node.accessibilityInformation.label,
            LocalizedConstants.msgNoQueriesAvailable,
            "accessibilityInformation label should match the empty message",
        );
    });
});
