/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import {
    QS_ACCEPT_INLINE_SUGGESTION_ACTION,
    QS_ACCEPT_SELECTED_SUGGESTION_ACTION,
    QS_INSERT_TAB_ACTION,
    QS_SHIFT_TAB_OUTDENT_CONTEXT,
    QS_TAB_ACCEPT_INLINE_CONTEXT,
    QS_TAB_ACCEPT_SUGGESTION_CONTEXT,
    QS_TAB_INSERT_CONTEXT,
} from "../../src/webviews/pages/QueryStudio/keybindings";

suite("queryStudio editor keybindings", () => {
    test("Tab accepts normal suggestions before inline ghost text before inserting a tab", () => {
        expect(QS_ACCEPT_SELECTED_SUGGESTION_ACTION).to.equal("acceptSelectedSuggestion");
        expect(QS_TAB_ACCEPT_SUGGESTION_CONTEXT).to.equal("suggestWidgetVisible && textInputFocus");

        expect(QS_ACCEPT_INLINE_SUGGESTION_ACTION).to.equal("editor.action.inlineSuggest.commit");
        expect(QS_TAB_ACCEPT_INLINE_CONTEXT).to.equal(
            "editorTextFocus && inlineSuggestionVisible && !suggestWidgetVisible",
        );

        expect(QS_INSERT_TAB_ACTION).to.equal("tab");
        expect(QS_TAB_INSERT_CONTEXT).to.equal(
            "editorTextFocus && !suggestWidgetVisible && !inlineSuggestionVisible",
        );
    });

    test("Shift+Tab remains scoped to editor focus", () => {
        expect(QS_SHIFT_TAB_OUTDENT_CONTEXT).to.equal("editorTextFocus");
    });
});
