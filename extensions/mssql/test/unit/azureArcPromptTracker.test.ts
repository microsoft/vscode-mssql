/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import { expect } from "chai";

import { AzureArcPromptTracker } from "../../src/integration/azureArcPromptTracker";

const day = 24 * 60 * 60 * 1000;

/** Minimal in-memory `vscode.Memento`; it's an interface, so a hand-rolled fake is acceptable. */
function makeMemento(): vscode.Memento {
    const map = new Map<string, unknown>();
    return {
        keys: () => Array.from(map.keys()),
        get: <T>(key: string, defaultValue?: T): T | undefined =>
            map.has(key) ? (map.get(key) as T) : defaultValue,
        update: async (key: string, value: unknown): Promise<void> => {
            map.set(key, value);
        },
    } as unknown as vscode.Memento;
}

suite("AzureArcPromptTracker", () => {
    let now: number;
    let tracker: AzureArcPromptTracker;

    setup(() => {
        now = 1_000 * day;
        tracker = new AzureArcPromptTracker(makeMemento(), () => now);
    });

    test("keeps the first prompt's ID and date across repeat prompts", async () => {
        const first = await tracker.recordPrompt("connection", false);
        now += 3 * day;
        const repeat = await tracker.recordPrompt("connection", true);

        expect(repeat).to.deep.equal({
            promptId: first.promptId,
            promptedAt: first.promptedAt,
            promptCount: 2,
            learnHowOpened: true,
        });
        expect(tracker.getDaysSincePrompt(repeat)).to.equal(3);
    });

    test("gives each connection its own prompt", async () => {
        const first = await tracker.recordPrompt("first", false);
        const second = await tracker.recordPrompt("second", false);

        expect(second.promptId).to.not.equal(first.promptId);
    });

    test("credits a prompt once", async () => {
        const prompt = await tracker.recordPrompt("connection", false);

        expect(await tracker.completePrompt("connection")).to.deep.equal(prompt);
        expect(await tracker.completePrompt("connection")).to.be.undefined;
    });

    test("lets a prompted connection be checked in the background once a day", async () => {
        await tracker.recordPrompt("connection", false);

        expect(await tracker.claimBackgroundCheck("connection")).to.not.be.undefined;
        now += day - 1;
        expect(await tracker.claimBackgroundCheck("connection")).to.be.undefined;
        now += 1;
        expect(await tracker.claimBackgroundCheck("connection")).to.not.be.undefined;
        expect(await tracker.claimBackgroundCheck("never-prompted")).to.be.undefined;
    });

    test("forgets a prompt after 90 days", async () => {
        await tracker.recordPrompt("connection", false);
        now += 90 * day;

        expect(await tracker.claimBackgroundCheck("connection")).to.be.undefined;
        expect(await tracker.completePrompt("connection")).to.be.undefined;
    });
});
