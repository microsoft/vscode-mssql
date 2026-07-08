/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export const QS_ACCEPT_SELECTED_SUGGESTION_ACTION = "acceptSelectedSuggestion";
export const QS_ACCEPT_INLINE_SUGGESTION_ACTION = "editor.action.inlineSuggest.commit";
export const QS_INSERT_TAB_ACTION = "tab";
export const QS_OUTDENT_ACTION = "outdent";

export const QS_TAB_ACCEPT_SUGGESTION_CONTEXT = "suggestWidgetVisible && textInputFocus";
export const QS_TAB_ACCEPT_INLINE_CONTEXT =
    "editorTextFocus && inlineSuggestionVisible && !suggestWidgetVisible";
export const QS_TAB_INSERT_CONTEXT =
    "editorTextFocus && !suggestWidgetVisible && !inlineSuggestionVisible";
export const QS_SHIFT_TAB_OUTDENT_CONTEXT = "editorTextFocus";
