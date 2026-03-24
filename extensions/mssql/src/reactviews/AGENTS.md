# AGENTS

1. Long lists of any kind in reactviews should be virtualized. Use @tanstack/react-virtual to implement it. For fluent data grid based virtualization use "@fluentui-contrib/react-data-grid-react-window". While implementing such lists please make sure they are screen reader friendly by adding aria props and make sure they are keyboard navigation friendly (arrow keys).
2. Please avoid creating one-off components in the UI. Try to use fluent components and if not present create a generic common component in "common" folder first. Make sure all components created in "common" folder are accessible by both screen readers and keyboard.
3. Please localize all the display strings. If the display string has parameters, please use parameterized localized strings instead of breaking them.
4. Please do not parse display strings to manipulate them; it won't work on translated versions.
5. Please do not hard code colors. Use vscode or fluent tokens to apply colors.
6. Please avoid overloading context with all state variables. Instead, prefer local component state over a single large central context, or consider breaking the central context into multiple smaller, more focused contexts. For example, prefer `useState` in a component over adding to a shared context when the state is only used by that component and its children.
7. Use targeted selector to select from webview state. This keeps the re-renders scoped to targeted state.
8. Avoid spamming the webviewRPC channel. Use lodash's `debounce` to debounce requests. For throttling use lodash's `throttle`.
9. Avoid using `setTimeout(..., 0)` to sync stuff. Usually `setTimeout` calls are delayed for a minimum of 1 second during webview initialization and a series of them could stall the webview rendering. Use requestAnimationFrame or queueMicrotask if possible.
10. Avoid using gray colors on dark theme. It doesn't have good enough contrast for visibility (aim for at least WCAG 2.1 AA 4.5:1 contrast ratio for text). Strongly prefer readability and contrast over style.
11. Use targeted imports instead of wildcard (`*`) imports to avoid increasing the bundle size. For example, prefer `import { Button } from "@fluentui/react-components"` over `import * as Fluent from "@fluentui/react-components"`.
