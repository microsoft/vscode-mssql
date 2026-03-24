---
applyTo: "extensions/mssql/src/reactviews/**"
---

# Webview Code Review Instructions

## Component Patterns

- Long lists must be virtualized. Use `@tanstack/react-virtual` or `@fluentui-contrib/react-data-grid-react-window` for fluent data grids. Ensure virtualized lists are screen reader friendly (aria props) and keyboard navigable (arrow keys).
- Avoid one-off components. Use Fluent UI components; if not available, create a generic component in the `common` folder. All `common` components must be accessible by screen readers and keyboard.
- Localize all display strings. Use parameterized localized strings instead of breaking them. Never parse display strings to manipulate them — it won't work on translated versions.
- Do not hard code colors. Use VS Code or Fluent tokens.
- Avoid overloading context with all state variables. Prefer local component state (`useState`) over a single large central context. Break large contexts into smaller, focused ones.
- Use targeted selectors to select from webview state to keep re-renders scoped.
- Avoid spamming the webviewRPC channel. Use lodash `debounce`/`throttle`.
- Avoid gray colors on dark theme — insufficient contrast. Aim for WCAG 2.1 AA 4.5:1 contrast ratio for text.
- Use targeted imports, not wildcard (`*`) imports. Prefer `import { Button } from "@fluentui/react-components"` over `import * as Fluent from "@fluentui/react-components"`.

## Avoid `setTimeout()` in Webviews

**Critical**: Chrome throttles `setTimeout` to a minimum of 1 second when the webview tab is hidden or backgrounded, causing delays and unpredictable behavior during initialization.

### For UI Synchronization

Use `requestAnimationFrame` instead of `setTimeout(cb, 0)`:

```typescript
// BAD: Throttled when webview is hidden
setTimeout(() => {
    updateUIState();
}, 0);

// GOOD: Syncs with browser paint loop
requestAnimationFrame(() => {
    updateUIState();
});
```

### For Non-Visual or RPC Work

Use `queueMicrotask` for immediate execution after the current call stack:

```typescript
// BAD: Unnecessary overhead and potential throttling
setTimeout(() => {
    sendRpcMessage();
}, 0);

// GOOD: Runs immediately after current call stack, not throttled
queueMicrotask(() => {
    sendRpcMessage();
});
```

### Quick Reference

| Use Case                  | Recommended API         | Why                        |
| ------------------------- | ----------------------- | -------------------------- |
| UI updates / animations   | `requestAnimationFrame` | Syncs with paint loop      |
| RPC calls / state updates | `queueMicrotask`        | Immediate, not throttled   |
| Actual intentional delays | `setTimeout`            | Only for true timed delays |

### Checklist

- No `setTimeout(..., 0)` or short timeout patterns in UI code
- `requestAnimationFrame` used for visual/rendering sync
- `queueMicrotask` used for non-visual immediate execution
- No `setTimeout` during webview initialization/startup
- Consider hidden/backgrounded webview behavior for timing-sensitive code
