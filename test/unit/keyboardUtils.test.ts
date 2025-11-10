/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import * as sinon from "sinon";
import {
    getShortcutInfo,
    parseWebviewKeyboardShortcutConfig,
    eventMatchesShortcut,
} from "../../src/reactviews/common/keyboardUtils";
import {
    WebviewAction,
    WebviewKeyCombination,
    WebviewKeyBindingConfiguration,
} from "../../src/sharedInterfaces/webview";
import * as utils from "../../src/reactviews/common/utils";

suite("keyboardUtils Tests", () => {
    let isMacStub: sinon.SinonStub;

    setup(() => {
        // Mock navigator.platform for isMac() function
        // Default to non-Mac platform
        isMacStub = sinon.stub(utils, "isMac").returns(false);
    });

    teardown(() => {
        isMacStub.restore();
    });
    suite("getShortcutInfo", () => {
        test("should return empty label and combination for undefined", () => {
            const result = getShortcutInfo(undefined);
            expect(result.label).to.equal("");
            expect(result.keyCombination).to.deep.equal({});
        });

        test("should return empty label and combination for empty string", () => {
            const result = getShortcutInfo("");
            expect(result.label).to.equal("");
            expect(result.keyCombination).to.deep.equal({});
        });

        test("should parse single letter key", () => {
            const result = getShortcutInfo("a");
            expect(result.label).to.equal("A");
            expect(result.keyCombination.key).to.equal("a");
            expect(result.keyCombination.code).to.equal("KeyA");
        });

        test("should parse single digit key", () => {
            const result = getShortcutInfo("5");
            expect(result.label).to.equal("5");
            expect(result.keyCombination.key).to.equal("5");
            expect(result.keyCombination.code).to.equal("Digit5");
        });

        test("should parse Ctrl+key combination", () => {
            const result = getShortcutInfo("ctrl+c");
            expect(result.label).to.equal("Ctrl+C");
            expect(result.keyCombination.key).to.equal("c");
            expect(result.keyCombination.code).to.equal("KeyC");
            expect(result.keyCombination.ctrlKey).to.equal(true);
        });

        test("should parse Shift+key combination", () => {
            const result = getShortcutInfo("shift+a");
            expect(result.label).to.equal("Shift+A");
            expect(result.keyCombination.key).to.equal("a");
            expect(result.keyCombination.shiftKey).to.equal(true);
        });

        test("should parse Alt+key combination", () => {
            const result = getShortcutInfo("alt+f4");
            expect(result.label).to.equal("Alt+F4");
            expect(result.keyCombination.key).to.equal("F4");
            expect(result.keyCombination.altKey).to.equal(true);
        });

        test("should parse Meta+key combination", () => {
            const result = getShortcutInfo("meta+r");
            expect(result.label).to.equal("Meta+R");
            expect(result.keyCombination.key).to.equal("r");
            expect(result.keyCombination.metaKey).to.equal(true);
        });

        test("should parse Cmd+key combination", () => {
            const result = getShortcutInfo("cmd+p");
            expect(result.keyCombination.key).to.equal("p");
            expect(result.keyCombination.metaKey).to.equal(true);
        });

        test("should parse multiple modifiers", () => {
            const result = getShortcutInfo("ctrl+shift+alt+x");
            expect(result.keyCombination.key).to.equal("x");
            expect(result.keyCombination.ctrlKey).to.equal(true);
            expect(result.keyCombination.shiftKey).to.equal(true);
            expect(result.keyCombination.altKey).to.equal(true);
        });

        test("should parse special keys - Enter", () => {
            const result = getShortcutInfo("enter");
            expect(result.label).to.equal("Enter");
            expect(result.keyCombination.key).to.equal("Enter");
            expect(result.keyCombination.code).to.equal("Enter");
        });

        test("should parse special keys - Escape", () => {
            const result = getShortcutInfo("escape");
            expect(result.label).to.equal("Esc");
            expect(result.keyCombination.key).to.equal("Escape");
        });

        test("should parse special keys - Tab", () => {
            const result = getShortcutInfo("tab");
            expect(result.label).to.equal("Tab");
            expect(result.keyCombination.key).to.equal("Tab");
        });

        test("should parse special keys - Space", () => {
            const result = getShortcutInfo("space");
            expect(result.label).to.equal("Space");
            expect(result.keyCombination.key).to.equal(" ");
            expect(result.keyCombination.code).to.equal("Space");
        });

        test("should parse arrow keys", () => {
            const upResult = getShortcutInfo("up");
            expect(upResult.keyCombination.key).to.equal("ArrowUp");
            expect(upResult.keyCombination.code).to.equal("ArrowUp");

            const downResult = getShortcutInfo("down");
            expect(downResult.keyCombination.key).to.equal("ArrowDown");

            const leftResult = getShortcutInfo("left");
            expect(leftResult.keyCombination.key).to.equal("ArrowLeft");

            const rightResult = getShortcutInfo("right");
            expect(rightResult.keyCombination.key).to.equal("ArrowRight");
        });

        test("should parse function keys", () => {
            const f1Result = getShortcutInfo("f1");
            expect(f1Result.label).to.equal("F1");
            expect(f1Result.keyCombination.key).to.equal("F1");

            const f12Result = getShortcutInfo("f12");
            expect(f12Result.label).to.equal("F12");
            expect(f12Result.keyCombination.key).to.equal("F12");
        });

        test("should handle case insensitivity", () => {
            const result = getShortcutInfo("CTRL+SHIFT+A");
            expect(result.keyCombination.key).to.equal("a");
            expect(result.keyCombination.ctrlKey).to.equal(true);
            expect(result.keyCombination.shiftKey).to.equal(true);
        });

        test("should handle extra spaces", () => {
            const result = getShortcutInfo("ctrl + shift + a");
            expect(result.keyCombination.key).to.equal("a");
            expect(result.keyCombination.ctrlKey).to.equal(true);
            expect(result.keyCombination.shiftKey).to.equal(true);
        });

        test("should return empty for invalid shortcut", () => {
            const result = getShortcutInfo("invalidkey");
            expect(result.label).to.equal("");
            expect(result.keyCombination).to.deep.equal({});
        });

        test("should return empty for modifier only", () => {
            const result = getShortcutInfo("ctrl");
            expect(result.label).to.equal("");
            expect(result.keyCombination).to.deep.equal({});
        });

        suite("platform-specific ctrlcmd modifier", () => {
            test("should resolve to Cmd on Mac", () => {
                isMacStub.returns(true);
                const result = getShortcutInfo("ctrlcmd+p");
                expect(result.label).to.equal("⌘+P");
                expect(result.keyCombination.key).to.equal("p");
                expect(result.keyCombination.metaKey).to.equal(true);
                expect(result.keyCombination.ctrlKey).to.be.undefined;
            });

            test("should resolve to Ctrl on Windows/Linux", () => {
                isMacStub.returns(false);
                const result = getShortcutInfo("ctrlcmd+p");
                expect(result.label).to.equal("Ctrl+P");
                expect(result.keyCombination.key).to.equal("p");
                expect(result.keyCombination.ctrlKey).to.equal(true);
                expect(result.keyCombination.metaKey).to.be.undefined;
            });

            test("should resolve ctrlcmd with other modifiers on Mac", () => {
                isMacStub.returns(true);
                const result = getShortcutInfo("ctrlcmd+shift+a");
                expect(result.label).to.equal("⌘+Shift+A");
                expect(result.keyCombination.metaKey).to.equal(true);
                expect(result.keyCombination.shiftKey).to.equal(true);
                expect(result.keyCombination.ctrlKey).to.be.undefined;
            });

            test("should resolve ctrlcmd with other modifiers on Windows/Linux", () => {
                isMacStub.returns(false);
                const result = getShortcutInfo("ctrlcmd+shift+a");
                expect(result.label).to.equal("Ctrl+Shift+A");
                expect(result.keyCombination.ctrlKey).to.equal(true);
                expect(result.keyCombination.shiftKey).to.equal(true);
                expect(result.keyCombination.metaKey).to.be.undefined;
            });
        });

        suite("platform-specific display labels", () => {
            test("should show ⌘ for cmd on Mac", () => {
                isMacStub.returns(true);
                const result = getShortcutInfo("cmd+c");
                expect(result.label).to.equal("⌘+C");
            });

            test("should show Meta for cmd on Windows/Linux", () => {
                isMacStub.returns(false);
                const result = getShortcutInfo("cmd+c");
                expect(result.label).to.equal("Meta+C");
            });

            test("should show Option for option on Mac", () => {
                isMacStub.returns(true);
                const result = getShortcutInfo("option+x");
                expect(result.label).to.equal("Option+X");
            });

            test("should show Alt for option on Windows/Linux", () => {
                isMacStub.returns(false);
                const result = getShortcutInfo("option+x");
                expect(result.label).to.equal("Alt+X");
            });
        });
    });

    suite("parseWebviewKeyboardShortcutConfig", () => {
        test("should parse configuration with defaults", () => {
            const config: WebviewKeyBindingConfiguration = {
                [WebviewAction.ResultGridCopySelection]: "ctrl+c",
            } as WebviewKeyBindingConfiguration;

            const result = parseWebviewKeyboardShortcutConfig(config);

            expect(result[WebviewAction.ResultGridCopySelection].label).to.equal("Ctrl+C");
            expect(result[WebviewAction.ResultGridCopySelection].keyCombination.ctrlKey).to.equal(
                true,
            );
            // Should include default for SelectAll
            expect(result[WebviewAction.ResultGridSelectAll]).to.exist;
        });

        test("should override defaults", () => {
            const config: WebviewKeyBindingConfiguration = {
                [WebviewAction.ResultGridSelectAll]: "ctrl+shift+a",
            } as WebviewKeyBindingConfiguration;

            const result = parseWebviewKeyboardShortcutConfig(config);

            expect(result[WebviewAction.ResultGridSelectAll].keyCombination.ctrlKey).to.equal(true);
            expect(result[WebviewAction.ResultGridSelectAll].keyCombination.shiftKey).to.equal(
                true,
            );
        });
    });

    suite("eventMatchesShortcut", () => {
        function createKeyboardEvent(options: {
            key: string;
            code?: string;
            ctrlKey?: boolean;
            shiftKey?: boolean;
            altKey?: boolean;
            metaKey?: boolean;
        }): KeyboardEvent {
            return {
                key: options.key,
                code: options.code || "",
                ctrlKey: options.ctrlKey || false,
                shiftKey: options.shiftKey || false,
                altKey: options.altKey || false,
                metaKey: options.metaKey || false,
            } as KeyboardEvent;
        }

        test("should return false for undefined combo", () => {
            const event = createKeyboardEvent({ key: "a" });
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            expect(eventMatchesShortcut(event, undefined as any)).to.equal(false);
        });

        test("should match simple key press", () => {
            const event = createKeyboardEvent({ key: "a", code: "KeyA" });
            const combo: WebviewKeyCombination = { key: "a", code: "KeyA" };
            expect(eventMatchesShortcut(event, combo)).to.equal(true);
        });

        test("should match by code", () => {
            const event = createKeyboardEvent({ key: "a", code: "KeyA" });
            const combo: WebviewKeyCombination = { code: "KeyA" };
            expect(eventMatchesShortcut(event, combo)).to.equal(true);
        });

        test("should match by key when code not provided", () => {
            const event = createKeyboardEvent({ key: "a" });
            const combo: WebviewKeyCombination = { key: "a" };
            expect(eventMatchesShortcut(event, combo)).to.equal(true);
        });

        test("should match Ctrl+key", () => {
            const event = createKeyboardEvent({ key: "c", code: "KeyC", ctrlKey: true });
            const combo: WebviewKeyCombination = { key: "c", code: "KeyC", ctrlKey: true };
            expect(eventMatchesShortcut(event, combo)).to.equal(true);
        });

        test("should not match when Ctrl is pressed but not required", () => {
            const event = createKeyboardEvent({ key: "c", code: "KeyC", ctrlKey: true });
            const combo: WebviewKeyCombination = { key: "c", code: "KeyC" };
            expect(eventMatchesShortcut(event, combo)).to.equal(false);
        });

        test("should not match when Ctrl is required but not pressed", () => {
            const event = createKeyboardEvent({ key: "c", code: "KeyC" });
            const combo: WebviewKeyCombination = { key: "c", code: "KeyC", ctrlKey: true };
            expect(eventMatchesShortcut(event, combo)).to.equal(false);
        });

        test("should match Shift+key", () => {
            const event = createKeyboardEvent({ key: "a", code: "KeyA", shiftKey: true });
            const combo: WebviewKeyCombination = { key: "a", code: "KeyA", shiftKey: true };
            expect(eventMatchesShortcut(event, combo)).to.equal(true);
        });

        test("should not match when Shift is pressed but not required", () => {
            const event = createKeyboardEvent({ key: "a", code: "KeyA", shiftKey: true });
            const combo: WebviewKeyCombination = { key: "a", code: "KeyA" };
            expect(eventMatchesShortcut(event, combo)).to.equal(false);
        });

        test("should match Alt+key", () => {
            const event = createKeyboardEvent({ key: "f4", altKey: true });
            const combo: WebviewKeyCombination = { key: "f4", altKey: true };
            expect(eventMatchesShortcut(event, combo)).to.equal(true);
        });

        test("should not match when Alt is pressed but not required", () => {
            const event = createKeyboardEvent({ key: "f4", altKey: true });
            const combo: WebviewKeyCombination = { key: "f4" };
            expect(eventMatchesShortcut(event, combo)).to.equal(false);
        });

        test("should match Meta+key", () => {
            const event = createKeyboardEvent({ key: "r", metaKey: true });
            const combo: WebviewKeyCombination = { key: "r", metaKey: true };
            expect(eventMatchesShortcut(event, combo)).to.equal(true);
        });

        test("should not match when Meta is pressed but not required", () => {
            const event = createKeyboardEvent({ key: "r", metaKey: true });
            const combo: WebviewKeyCombination = { key: "r" };
            expect(eventMatchesShortcut(event, combo)).to.equal(false);
        });

        test("should match multiple modifiers", () => {
            const event = createKeyboardEvent({
                key: "x",
                code: "KeyX",
                ctrlKey: true,
                shiftKey: true,
                altKey: true,
            });
            const combo: WebviewKeyCombination = {
                key: "x",
                code: "KeyX",
                ctrlKey: true,
                shiftKey: true,
                altKey: true,
            };
            expect(eventMatchesShortcut(event, combo)).to.equal(true);
        });

        test("should not match when one modifier is missing", () => {
            const event = createKeyboardEvent({
                key: "x",
                code: "KeyX",
                ctrlKey: true,
                shiftKey: true,
            });
            const combo: WebviewKeyCombination = {
                key: "x",
                code: "KeyX",
                ctrlKey: true,
                shiftKey: true,
                altKey: true,
            };
            expect(eventMatchesShortcut(event, combo)).to.equal(false);
        });

        test("should not match when extra modifier is pressed", () => {
            const event = createKeyboardEvent({
                key: "x",
                code: "KeyX",
                ctrlKey: true,
                shiftKey: true,
                altKey: true,
            });
            const combo: WebviewKeyCombination = {
                key: "x",
                code: "KeyX",
                ctrlKey: true,
                shiftKey: true,
            };
            expect(eventMatchesShortcut(event, combo)).to.equal(false);
        });

        test("should not match when key is different", () => {
            const event = createKeyboardEvent({ key: "a", code: "KeyA" });
            const combo: WebviewKeyCombination = { key: "b", code: "KeyB" };
            expect(eventMatchesShortcut(event, combo)).to.equal(false);
        });

        test("should not match when code is different", () => {
            const event = createKeyboardEvent({ key: "a", code: "KeyA" });
            const combo: WebviewKeyCombination = { code: "KeyB" };
            expect(eventMatchesShortcut(event, combo)).to.equal(false);
        });

        test("should handle case insensitive key matching for single characters", () => {
            const event = createKeyboardEvent({ key: "A", code: "KeyA" });
            const combo: WebviewKeyCombination = { key: "a", code: "KeyA" };
            expect(eventMatchesShortcut(event, combo)).to.equal(true);
        });

        test("should match special keys", () => {
            const enterEvent = createKeyboardEvent({ key: "Enter", code: "Enter" });
            const enterCombo: WebviewKeyCombination = { key: "Enter", code: "Enter" };
            expect(eventMatchesShortcut(enterEvent, enterCombo)).to.equal(true);

            const escapeEvent = createKeyboardEvent({ key: "Escape", code: "Escape" });
            const escapeCombo: WebviewKeyCombination = { key: "Escape", code: "Escape" };
            expect(eventMatchesShortcut(escapeEvent, escapeCombo)).to.equal(true);
        });

        test("should return false when combo has neither key nor code", () => {
            const event = createKeyboardEvent({ key: "a", code: "KeyA" });
            const combo: WebviewKeyCombination = { ctrlKey: true };
            expect(eventMatchesShortcut(event, combo)).to.equal(false);
        });

        test("should treat undefined modifiers as must not be pressed", () => {
            // combo with no modifiers specified should only match when no modifiers are pressed
            const event1 = createKeyboardEvent({ key: "c", code: "KeyC" });
            const combo: WebviewKeyCombination = { key: "c", code: "KeyC" };
            expect(eventMatchesShortcut(event1, combo)).to.equal(true);

            // Should NOT match when any modifier is pressed
            const event2 = createKeyboardEvent({ key: "c", code: "KeyC", ctrlKey: true });
            expect(eventMatchesShortcut(event2, combo)).to.equal(false);

            const event3 = createKeyboardEvent({ key: "c", code: "KeyC", shiftKey: true });
            expect(eventMatchesShortcut(event3, combo)).to.equal(false);

            const event4 = createKeyboardEvent({ key: "c", code: "KeyC", altKey: true });
            expect(eventMatchesShortcut(event4, combo)).to.equal(false);

            const event5 = createKeyboardEvent({ key: "c", code: "KeyC", metaKey: true });
            expect(eventMatchesShortcut(event5, combo)).to.equal(false);
        });

        test("should match when specified modifiers are true and unspecified are false", () => {
            const event = createKeyboardEvent({
                key: "c",
                code: "KeyC",
                ctrlKey: true,
                shiftKey: false,
                altKey: false,
                metaKey: false,
            });
            const combo: WebviewKeyCombination = { key: "c", code: "KeyC", ctrlKey: true };
            expect(eventMatchesShortcut(event, combo)).to.equal(true);
        });
    });
});
