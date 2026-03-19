# Agents

1. Long lists of any kind in react view should be virtualized. Use @tanstack/react-virtual to implement it. For fluent data grid based virtualization use "@fluentui-contrib/react-data-grid-react-window". While implementing such lists please make sure they are screen reader friendly by adding aria props and make sure they are keyboard navigation friendly (arrow keys).
2. Please avoid creating one-off components in the UI. Try to use fluent components and if not present create a generic common component in "common" folder first.
3. Make sure all components created in "common" folder are accessible by both screen readers and keyboard.
4. Please localize all the display strings. If the display string has parameters, please use parameterized localized strings instead of breaking them.
5. Please do parse display string to manipulate them, it won't work on translated versions.
6. Please do not hard code colors. Use vscode or fluent tokens to apply colors.
7. Please avoid overloading context with all state variables. Instead prefer localized state of central context or suggest breaking the central context into smaller contexts.
8. Use targeted selector to select from webview state. This keeps the re-renders scoped to targeted state.
9. Avoid spamming the webviewRPC channel. Use lodash's debounce to debounce requests. For throttling use lodash's throttle.
10. Avoid using (setTimouts, 0) to sync stuff. Usually setTimeouts are delayed for a minimum of 1 second during webview initialization and series of them could stall the webview rendering. Use requestAnimationFrame or queueMicrotask if possible.
11. Avoid using gray colors on dark theme. It doesn't have good enough contrast for visibility. Strongly prefer readability and contrast of style.
