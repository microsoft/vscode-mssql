/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Keep styles for lazy experiences eager so switching views never waits on a stylesheet request.
import "../../index.css";
import "../ExecutionPlan/executionPlanEagerStyles";

// Monaco editor styles used by the results text view.
import "monaco-editor/esm/vs/editor/standalone/browser/standalone-tokens.css";
import "monaco-editor/esm/vs/base/browser/ui/aria/aria.css";
import "monaco-editor/esm/vs/editor/browser/widget/codeEditor/editor.css";
import "monaco-editor/esm/vs/base/browser/ui/scrollbar/media/scrollbars.css";
import "monaco-editor/esm/vs/editor/browser/viewParts/blockDecorations/blockDecorations.css";
import "monaco-editor/esm/vs/editor/browser/viewParts/currentLineHighlight/currentLineHighlight.css";
import "monaco-editor/esm/vs/editor/browser/viewParts/decorations/decorations.css";
import "monaco-editor/esm/vs/editor/browser/viewParts/glyphMargin/glyphMargin.css";
import "monaco-editor/esm/vs/editor/browser/viewParts/indentGuides/indentGuides.css";
import "monaco-editor/esm/vs/editor/browser/viewParts/lineNumbers/lineNumbers.css";
import "monaco-editor/esm/vs/base/browser/ui/mouseCursor/mouseCursor.css";
import "monaco-editor/esm/vs/editor/browser/viewParts/viewLines/viewLines.css";
import "monaco-editor/esm/vs/editor/browser/viewParts/linesDecorations/linesDecorations.css";
import "monaco-editor/esm/vs/editor/browser/viewParts/margin/margin.css";
import "monaco-editor/esm/vs/editor/browser/viewParts/marginDecorations/marginDecorations.css";
import "monaco-editor/esm/vs/editor/browser/viewParts/minimap/minimap.css";
import "monaco-editor/esm/vs/editor/browser/viewParts/overlayWidgets/overlayWidgets.css";
import "monaco-editor/esm/vs/editor/browser/viewParts/rulers/rulers.css";
import "monaco-editor/esm/vs/editor/browser/viewParts/scrollDecoration/scrollDecoration.css";
import "monaco-editor/esm/vs/editor/browser/viewParts/selections/selections.css";
import "monaco-editor/esm/vs/editor/browser/viewParts/viewCursors/viewCursors.css";
import "monaco-editor/esm/vs/editor/browser/viewParts/whitespace/whitespace.css";
import "monaco-editor/esm/vs/editor/browser/gpu/css/media/decorationCssRuleExtractor.css";
import "monaco-editor/esm/vs/editor/browser/controller/editContext/textArea/textAreaEditContext.css";
import "monaco-editor/esm/vs/editor/browser/controller/editContext/native/nativeEditContext.css";
import "monaco-editor/esm/vs/editor/browser/viewParts/gpuMark/gpuMark.css";
import "monaco-editor/esm/vs/editor/browser/services/hoverService/hover.css";
import "monaco-editor/esm/vs/base/browser/ui/hover/hoverWidget.css";
import "monaco-editor/esm/vs/editor/browser/widget/markdownRenderer/browser/renderedMarkdown.css";
import "monaco-editor/esm/vs/base/browser/ui/contextview/contextview.css";
import "monaco-editor/esm/vs/base/browser/ui/selectBox/selectBox.css";
import "monaco-editor/esm/vs/base/browser/ui/list/list.css";
import "monaco-editor/esm/vs/base/browser/ui/dnd/dnd.css";
import "monaco-editor/esm/vs/base/browser/ui/selectBox/selectBoxCustom.css";
import "monaco-editor/esm/vs/base/browser/ui/actionbar/actionbar.css";
import "monaco-editor/esm/vs/base/browser/ui/dropdown/dropdown.css";
import "monaco-editor/esm/vs/platform/actions/browser/menuEntryActionViewItem.css";
import "monaco-editor/esm/vs/editor/standalone/browser/quickInput/standaloneQuickInput.css";
import "monaco-editor/esm/vs/base/browser/ui/toggle/toggle.css";
import "monaco-editor/esm/vs/platform/quickinput/browser/media/quickInput.css";
import "monaco-editor/esm/vs/base/browser/ui/button/button.css";
import "monaco-editor/esm/vs/base/browser/ui/countBadge/countBadge.css";
import "monaco-editor/esm/vs/base/browser/ui/progressbar/progressbar.css";
import "monaco-editor/esm/vs/base/browser/ui/inputbox/inputBox.css";
import "monaco-editor/esm/vs/base/browser/ui/findinput/findInput.css";
import "monaco-editor/esm/vs/base/browser/ui/iconLabel/iconlabel.css";
import "monaco-editor/esm/vs/base/browser/ui/keybindingLabel/keybindingLabel.css";
import "monaco-editor/esm/vs/base/browser/ui/tree/media/tree.css";
import "monaco-editor/esm/vs/base/browser/ui/sash/sash.css";
import "monaco-editor/esm/vs/base/browser/ui/splitview/splitview.css";
import "monaco-editor/esm/vs/base/browser/ui/table/table.css";
import "monaco-editor/esm/vs/editor/browser/widget/diffEditor/components/accessibleDiffViewer.css";
import "monaco-editor/esm/vs/base/browser/ui/toolbar/toolbar.css";
import "monaco-editor/esm/vs/editor/browser/widget/diffEditor/style.css";
import "monaco-editor/esm/vs/editor/browser/widget/multiDiffEditor/style.css";
