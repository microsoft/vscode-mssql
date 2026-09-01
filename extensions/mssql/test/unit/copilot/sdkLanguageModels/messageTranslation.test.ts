/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import { expect } from "chai";
import {
    textOfMessage,
    translateForAnthropic,
    translateForOpenAI,
} from "../../../../src/copilot/sdkLanguageModels/messageTranslation";

suite("SDK language model message translation", () => {
    test("Anthropic translation extracts system text and formats remaining messages", () => {
        const translated = translateForAnthropic([
            vscode.LanguageModelChatMessage.User("system rules"),
            vscode.LanguageModelChatMessage.User("complete this"),
            vscode.LanguageModelChatMessage.Assistant("prior answer"),
        ]);

        expect(translated.system).to.equal("system rules");
        expect(translated.messages).to.deep.equal([
            { role: "user", content: "complete this" },
            { role: "assistant", content: "prior answer" },
        ]);
    });

    test("Anthropic translation synthesizes a placeholder user turn after system extraction", () => {
        const translated = translateForAnthropic([
            vscode.LanguageModelChatMessage.User("system rules"),
        ]);

        expect(translated.system).to.equal("system rules");
        expect(translated.messages).to.deep.equal([{ role: "user", content: "Please respond." }]);
    });

    test("OpenAI translation includes the first user message as a system message", () => {
        const translated = translateForOpenAI([
            vscode.LanguageModelChatMessage.User("system rules"),
            vscode.LanguageModelChatMessage.User("complete this"),
            vscode.LanguageModelChatMessage.Assistant("prior answer"),
        ]);

        expect(translated).to.deep.equal([
            { role: "system", content: "system rules" },
            { role: "user", content: "complete this" },
            { role: "assistant", content: "prior answer" },
        ]);
    });

    test("non-text content parts cause a clear error", () => {
        const message = new vscode.LanguageModelChatMessage(
            vscode.LanguageModelChatMessageRole.User,
            [new vscode.LanguageModelToolResultPart("tool", [])],
        );

        expect(() => textOfMessage(message, "Test provider")).to.throw(
            "Test provider only handles text content.",
        );
    });

    test("long content is passed through unmodified", () => {
        const content = "x".repeat(51 * 1024);
        const translated = translateForOpenAI([
            vscode.LanguageModelChatMessage.User("system rules"),
            vscode.LanguageModelChatMessage.User(content),
        ]);

        expect(translated[1]).to.deep.equal({ role: "user", content });
    });
});
