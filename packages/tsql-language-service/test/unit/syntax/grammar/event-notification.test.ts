/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from "node:assert/strict";
import { suite, test } from "node:test";

import { createSyntaxHarness } from "../../support/syntaxHarness.ts";
const { parse } = createSyntaxHarness("event-notification.sql");

suite("T-SQL event notification grammar", () => {
    // Verifies server and database definitions retain event lists, FAN_IN, and broker routing.
    test("parses server and database event notifications", () => {
        const snapshot = parse(`
CREATE EVENT NOTIFICATION log_ddl1 ON SERVER
FOR CREATE_TABLE, ALTER_TABLE, DROP_TABLE
TO SERVICE 'NotifyService', '8140';
CREATE EVENT NOTIFICATION log_all ON DATABASE WITH FAN_IN
FOR DDL_TABLE_EVENTS, DDL_VIEW_EVENTS
TO SERVICE 'NotifyService', '8140a771-3c4b-4479-8ac0-81008ab17984';`);

        assert.deepEqual(snapshot.diagnostics, []);
        const tree = snapshot.tree.toString();
        assert.equal((tree.match(/CreateEventNotificationStatement\(/g) ?? []).length, 2);
        assert.match(tree, /EventNotificationFanInClause\(/);
    });

    // Verifies queue scope and multi-name DROP statements preserve their structural scope.
    test("parses queue-scoped create and drop event notifications", () => {
        const snapshot = parse(`
CREATE EVENT NOTIFICATION queue_events ON QUEUE dbo.EventQueue
FOR OBJECT_CREATED TO SERVICE 'NotifyService', 'current database';
DROP EVENT NOTIFICATION queue_events, old_events ON QUEUE dbo.EventQueue;`);

        assert.deepEqual(snapshot.diagnostics, []);
        assert.match(snapshot.tree.toString(), /DropEventNotificationStatement\(/);
    });

    // Verifies the Service Broker route requires both the service and broker-instance strings.
    test("reports a missing broker instance identifier", () => {
        const snapshot = parse(
            "CREATE EVENT NOTIFICATION n ON SERVER FOR CREATE_TABLE TO SERVICE 'svc',;",
        );
        assert.ok(snapshot.diagnostics.length > 0);
    });

    // Verifies QUEUE scope cannot omit its required queue name.
    test("reports a missing queue scope name", () => {
        const snapshot = parse(
            "CREATE EVENT NOTIFICATION n ON QUEUE FOR CREATE_TABLE TO SERVICE 'svc', 'id';",
        );
        assert.ok(snapshot.diagnostics.length > 0);
    });
});
