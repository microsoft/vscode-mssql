/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Privacy canaries for the B7 feature-capture stores (design 04 §18):
 * QsRunRecord trace files (digest-only default; elevated carries SQL but
 * never secrets), completions trace redaction surface, and LM prompt/
 * response classification on the diag substrate.
 */

import { expect } from "chai";
import { classifyPayload, CAPTURE_POLICIES } from "../../src/diagnostics/redaction";
import { serializeFeatureTrace } from "../../src/diagnostics/featureCapture/traceCodec";
import { inlineCompletionTraceRedaction } from "../../src/copilot/inlineCompletionDebug/traceSerializer";
import { diag } from "../../src/diagnostics/diagnosticsCore";

const CANARY = {
    sql: "SELECT canary_col FROM CANARY_TBL WHERE secret = 'CANARY-sql-91x'",
    server: "CANARY-server-7f3a",
    uri: "file:///c/CANARY-path-2b8c/query.sql",
    prompt: "CANARY-prompt-6a1f",
    response: "CANARY-response-5d4e",
    schemaText: "TABLE dbo.CANARY_SCHEMA_3c7d (secret_col int)",
};

suite("Feature capture privacy canaries", () => {
    teardown(() => diag.setCaptureMode("redacted"));
    test("completions trace redaction surface strips prompts, responses, schema text", () => {
        const event = {
            id: "E-1",
            timestamp: 1,
            result: "success",
            userPrompt: CANARY.prompt,
            systemPrompt: CANARY.prompt,
            rawResponse: CANARY.response,
            sanitizedResponse: CANARY.response,
            finalCompletionText: CANARY.response,
            schemaContextFormatted: CANARY.schemaText,
            promptMessages: [{ role: "user", content: CANARY.prompt }],
            locals: { nested: { userPrompt: CANARY.prompt } },
        };
        const trace = serializeFeatureTrace(
            [event],
            {
                extensionVersion: "canary",
                overrides: {},
                recordWhenClosed: false,
            },
            { redact: true, redaction: inlineCompletionTraceRedaction },
        );

        const serialized = JSON.stringify(trace);
        expect(serialized.includes(CANARY.prompt), "prompt leaked").to.equal(false);
        expect(serialized.includes(CANARY.response), "response leaked").to.equal(false);
        expect(serialized.includes("CANARY_SCHEMA_3c7d"), "schema text leaked").to.equal(false);
    });

    test("LM prompt/response classifications never plaintext outside elevated-with-sql", () => {
        for (const mode of ["redacted", "digest"] as const) {
            const { payload } = classifyPayload(
                {
                    prompt: { raw: CANARY.prompt, cls: "model.prompt" },
                    response: { raw: CANARY.response, cls: "model.response" },
                },
                CAPTURE_POLICIES[mode],
            );
            const serialized = JSON.stringify(payload);
            expect(serialized.includes(CANARY.prompt), `prompt leaked in ${mode}`).to.equal(false);
            expect(serialized.includes(CANARY.response), `response leaked in ${mode}`).to.equal(
                false,
            );
        }
    });
});
