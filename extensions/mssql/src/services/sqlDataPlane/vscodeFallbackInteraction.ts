/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * The production FallbackInteraction (TSQ2 §8.2): a modal warning for the
 * prompt policy, an information toast for the auto policy. Kept separate from
 * providerSuggestions.ts (which stays vscode-free so the decision matrix is
 * unit-testable) and shared by every consumer so the fallback UX is identical
 * across Query Studio, Object Explorer, and any future connect path.
 */

import * as vscode from "vscode";
import { FallbackInteraction } from "./providerSuggestions";

export function vscodeFallbackInteraction(): FallbackInteraction {
    return {
        // Modal: this decision blocks the connection, so it must be deliberate.
        // A non-modal toast can be dismissed/missed, which would abort the open.
        prompt: (message, actions) =>
            Promise.resolve(vscode.window.showWarningMessage(message, { modal: true }, ...actions)),
        notify: (message) => void vscode.window.showInformationMessage(message),
    };
}
