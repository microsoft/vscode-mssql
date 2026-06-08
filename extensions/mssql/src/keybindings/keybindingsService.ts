/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import { applyEdits, modify, parse, ParseError, printParseErrorCode } from "jsonc-parser";

export interface KeybindingRule {
    key?: string;
    command?: string;
    when?: string;
    args?: unknown;
    mac?: string;
    linux?: string;
    win?: string;
    [key: string]: unknown;
}

export interface CommandKeybindingUpdate {
    command: string;
    key: string;
    when?: string;
}

const defaultKeybindingsText = "[\n]\n";
const keybindingsUri = vscode.Uri.from({
    scheme: "vscode-userdata",
    path: "/User/keybindings.json",
});

function getPlatformKeybinding(rule: KeybindingRule): string | undefined {
    const platformKey =
        process.platform === "darwin"
            ? rule.mac
            : process.platform === "win32"
              ? rule.win
              : rule.linux;

    return typeof platformKey === "string"
        ? platformKey
        : typeof rule.key === "string"
          ? rule.key
          : undefined;
}

function getCurrentPlatformKeyProperty(): "mac" | "win" | "linux" {
    return process.platform === "darwin" ? "mac" : process.platform === "win32" ? "win" : "linux";
}

function getFormattingOptions(text: string) {
    const eol = text.includes("\r\n") ? "\r\n" : "\n";
    return {
        insertSpaces: true,
        tabSize: 4,
        eol,
        insertFinalNewline: true,
    };
}

function normalizeKeybindingsText(text: string): string {
    return text.trim().length === 0 ? defaultKeybindingsText : text;
}

export function parseKeybindingsText(text: string): KeybindingRule[] {
    const normalizedText = normalizeKeybindingsText(text);
    const errors: ParseError[] = [];
    const parsed = parse(normalizedText, errors, { allowTrailingComma: true });

    if (errors.length > 0) {
        const error = errors[0];
        throw new Error(
            `Could not parse keybindings.json: ${printParseErrorCode(error.error)} at offset ${error.offset}.`,
        );
    }

    if (!Array.isArray(parsed)) {
        throw new Error("Could not parse keybindings.json: root value must be an array.");
    }

    return parsed as KeybindingRule[];
}

export function updateKeybindingsText(text: string, updates: CommandKeybindingUpdate[]): string {
    let workingText = normalizeKeybindingsText(text);
    const formattingOptions = getFormattingOptions(workingText);
    let rules = parseKeybindingsText(workingText);

    for (const update of updates) {
        const key = update.key.trim();
        const matchingRuleIndexes = rules
            .map((rule, index) => (rule.command === update.command ? index : -1))
            .filter((index) => index >= 0);

        if (!key) {
            for (let index = matchingRuleIndexes.length - 1; index >= 0; index--) {
                workingText = applyEdits(
                    workingText,
                    modify(workingText, [matchingRuleIndexes[index]], undefined, {
                        formattingOptions,
                    }),
                );
            }
            rules = parseKeybindingsText(workingText);
            continue;
        }

        const duplicateRuleIndexes = matchingRuleIndexes.slice(0, -1);
        for (let index = duplicateRuleIndexes.length - 1; index >= 0; index--) {
            workingText = applyEdits(
                workingText,
                modify(workingText, [duplicateRuleIndexes[index]], undefined, {
                    formattingOptions,
                }),
            );
        }
        rules = parseKeybindingsText(workingText);

        const existingRuleIndex = rules.findIndex((rule) => rule.command === update.command);
        if (existingRuleIndex >= 0) {
            const existingRule = rules[existingRuleIndex];
            const platformKeyProperty = getCurrentPlatformKeyProperty();
            const nextRule =
                typeof existingRule[platformKeyProperty] === "string"
                    ? {
                          ...existingRule,
                          [platformKeyProperty]: key,
                      }
                    : {
                          ...existingRule,
                          key,
                      };

            workingText = applyEdits(
                workingText,
                modify(workingText, [existingRuleIndex], nextRule, {
                    formattingOptions,
                }),
            );
            rules = parseKeybindingsText(workingText);
            continue;
        }

        const rule: KeybindingRule = {
            key,
            command: update.command,
        };
        if (update.when) {
            rule.when = update.when;
        }

        workingText = applyEdits(
            workingText,
            modify(workingText, [rules.length], rule, {
                isArrayInsertion: true,
                formattingOptions,
            }),
        );
        rules.push(rule);
    }

    return workingText.endsWith("\n") ? workingText : `${workingText}\n`;
}

export class KeybindingsService {
    constructor(_context: vscode.ExtensionContext) {}

    public async getCommandKeybindings(commandIds: string[]): Promise<Record<string, string>> {
        const document = await this.openKeybindingsDocument();
        const rules = parseKeybindingsText(document.getText());
        const result: Record<string, string> = {};

        for (const commandId of commandIds) {
            const matchingRules = rules
                .filter((rule) => rule.command === commandId)
                .map(getPlatformKeybinding)
                .filter((key): key is string => typeof key === "string");
            result[commandId] = matchingRules[matchingRules.length - 1] ?? "";
        }

        return result;
    }

    public async updateCommandKeybindings(updates: CommandKeybindingUpdate[]): Promise<void> {
        const document = await this.openKeybindingsDocument();
        const text = document.getText();
        const updatedText = updateKeybindingsText(text, updates);
        const fullRange = new vscode.Range(
            document.positionAt(0),
            document.positionAt(text.length),
        );
        const workspaceEdit = new vscode.WorkspaceEdit();
        workspaceEdit.replace(document.uri, fullRange, updatedText);
        const applied = await vscode.workspace.applyEdit(workspaceEdit);
        if (!applied) {
            throw new Error("Could not update keybindings.json.");
        }
        await document.save();
    }

    public async openKeybindingsFile(): Promise<void> {
        await vscode.commands.executeCommand("workbench.action.openGlobalKeybindingsFile");
    }

    private async openKeybindingsDocument(): Promise<vscode.TextDocument> {
        return vscode.workspace.openTextDocument(keybindingsUri);
    }
}
