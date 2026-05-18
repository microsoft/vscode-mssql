/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import { InMemoryStateCommandDiagnosticsSink } from "../../src/platform/stateCommands/stateCommandDiagnostics";
import {
    OperationDefinition,
    OperationSessionService,
} from "../../src/operations/operationSessionService";

interface Draft {
    name: string;
}

type Command = { type: "set_name"; name: string };

suite("OperationSessionService Tests", () => {
    const definition: OperationDefinition<Draft, { ok: boolean }, Command> = {
        kind: "test-operation",
        createDefaultDraft: () => ({ name: "" }),
        applyCommand: (draft, command) => ({ ...draft, name: command.name }),
        validate: (draft) =>
            draft.name
                ? []
                : [{ severity: "error", property: "name", message: "Name is required." }],
        summarize: (draft) => ({ title: "Test operation", details: { name: draft.name } }),
        redact: (draft) => draft,
        execute: async () => ({ ok: true }),
    };

    test("emits diagnostics for command application and confirmation-gated execution", async () => {
        const diagnostics = new InMemoryStateCommandDiagnosticsSink();
        const service = new OperationSessionService(diagnostics);
        const session = await service.createSession(definition, {});

        const updated = service.applyCommand(
            session.id,
            definition,
            { type: "set_name", name: "ready" },
            {},
        );
        expect(updated.status).to.equal("ready");

        const awaitingConfirmation = await service.execute(session.id, definition, {
            confirmed: false,
        });
        expect(awaitingConfirmation.status).to.equal("awaiting_confirmation");

        expect(
            diagnostics.events.some(
                (event) =>
                    event.feature === "test-operation" &&
                    event.stage === "apply_command" &&
                    event.status === "succeeded" &&
                    event.commandType === "set_name",
            ),
        ).to.equal(true);
        expect(
            diagnostics.events.some(
                (event) =>
                    event.feature === "test-operation" &&
                    event.stage === "commit" &&
                    event.status === "skipped" &&
                    event.reason === "confirmation_required",
            ),
        ).to.equal(true);
    });
});
