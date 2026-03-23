---
applyTo: "extensions/mssql/test/**"
---

# Test Code Review Instructions

## Framework Requirements

- Must use Sinon, not TypeMoq. Replace TypeMoq mocks/stubs/helpers with Sinon equivalents when possible.
- Must use chai's `expect` for assertions. For Sinon interactions, use sinon-chai (`expect(...).to.have.been...`). Avoid `sinon.assert` and Node's `assert`.

## Telemetry and Logging

Do not depend on exact call counts, call order, or call indexes (`calledOnce`, `calledTwice`, `getCall(0)`, `firstCall`). Assert the expected event payload or log message was emitted using `calledWith`, `calledWithMatch`, or equivalent matchers.

## Mocking Best Practices

- Prefer `sinon.SinonStubbedInstance<T>` with `sandbox.createStubInstance(ClassName)` over manually constructed mock objects cast via `as unknown as Type`.

```typescript
// Avoid:
const mockService = {
    connect: sandbox.stub().resolves(true),
} as unknown as MyService;
(mockService.connect as sinon.SinonStub).resolves(false);

// Prefer:
const service: sinon.SinonStubbedInstance<MyService> = sandbox.createStubInstance(MyService);
service.connect.resolves(false); // Type-safe, no cast needed
```

- **Exception:** For external library interfaces that are _interfaces only_ (e.g., `vscode.WorkspaceConfiguration`, `vscode.Webview`), `createStubInstance()` cannot be used. In these cases, it is acceptable to use a minimal plain object with `as unknown as Type`, limited strictly to the members that the test actually uses.
- Avoid `Object.defineProperty` hacks and fake/partial plain objects for concrete classes or any type where a `sinon.SinonStubbedInstance` created via `sandbox.createStubInstance()` can be used instead.
- Use `sandbox.stub(obj, 'prop').value(...)` for property stubs.

## Sandbox and Helpers

- Use a Sinon sandbox (`sinon.createSandbox()`) with proper setup/teardown.
- Keep helper closures inside setup where the sandbox is created.
- Add shared Sinon helpers to `test/unit/utils.ts` when they'll be reused.
- When introducing a Sinon helper to replace a TypeMoq helper, follow the utils.ts pattern: accept an optional sandbox, create stub instances, and return them.

## VS Code Service Stubs

If the class under test relies on VS Code services (event emitters, secret storage, etc.), stub their accessors via the sandbox (e.g., `sandbox.stub(obj, 'prop').get(() => emitter)`) or provide a real `new vscode.EventEmitter()` rather than providing a plain object.

## General

- Always await async prompt helpers (e.g., `await prompt.render()`) so sinon stubs execute before assertions.
- Nest test suites as necessary to group tests logically.
- Preserve relevant inline comments from original tests when updating.
- Maintain existing formatting conventions, line endings, and text encoding.
