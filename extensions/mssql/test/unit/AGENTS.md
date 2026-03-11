## Instructions for writing good unit tests:

### Rules & Expectations

- You must not edit application/source files unless writing effective unit tests demands it. Confirm before editing files outside of /test/unit, and justify why you need to make those changes.
- You must use Sinon, not TypeMoq. If easily possible, replace TypeMoq mocks/stubs/helpers with Sinon equivalents.
- You must use chai's `expect` for assertions; when checking Sinon interactions, use sinon-chai. Avoid `sinon.assert` and Node's `assert` in favor of `expect(...).to.have.been...` helpers.
- You must avoid Object.defineProperty hacks and (if possible) fake/partial plain objects; use sandbox.createStubInstance(type) and sandbox.stub(obj, 'prop').value(...).
- You must avoid unnecessary casts, like `myVar as unknown as MyType` when myVar is already a sinon-stubbed instance of MyType.
- When mocking classes, prefer `sinon.SinonStubbedInstance<T>` typed variables with `sandbox.createStubInstance(ClassName)` over manually constructed mock objects cast via `as unknown as Type`. This maintains type safety and eliminates the need for unsafe casts like `(mockObj.method as sinon.SinonStub).resolves(...)` when configuring stub behavior.

    ```typescript
    // Avoid:
    const mockService = {
        connect: sandbox.stub().resolves(true),
        disconnect: sandbox.stub().resolves(),
    } as unknown as MyService;
    (mockService.connect as sinon.SinonStub).resolves(false); // Unsafe cast

    // Prefer:
    const service: sinon.SinonStubbedInstance<MyService> = sandbox.createStubInstance(MyService);
    service.connect.resolves(false); // Type-safe, no cast needed
    ```

    **Exception:** For external library interfaces (e.g., VS Code's `vscode.WorkspaceConfiguration`, `vscode.Webview`, `vscode.WebviewPanel`), `createStubInstance()` cannot be used since they are interfaces, not classes. In these cases, the `as unknown as Type` cast is acceptable. Stub only the methods actually used by the code under test.

- Use a Sinon sandbox (setup/teardown with sinon.createSandbox()); keep helper closures (e.g., createServer) inside setup where the
  sandbox is created.
- Add shared Sinon helpers to test/unit/utils.ts when they’ll be reused.
- If updating preexisting tests, preserve relevant inline comments from the original tests.
- When introducing a Sinon helper to replace a TypeMoq helper (e.g., capabilities mock), follow the utils.ts pattern: accept an optional
  sandbox, create stub instances, and return them.
- Maintain existing formatting conventions, line endings, and text encoding.
- Nest test suites as necessary to group tests in a logical manner.
- Always await async prompt helpers (for example, `await prompt.render()`) so sinon stubs execute before assertions.
- Critical: if the class under test relies on VS Code services (event emitters, secret storage, etc.), stub their accessors via the sandbox (e.g., `sandbox.stub(obj, 'prop').get(() => emitter)` or provide a real `new vscode.EventEmitter()`) rather than providing a plain object.

### Process

- Write tests following the rules and expectations defined above.
- Validate the tests written by running the test suite you've edited.
- Don't commit your changes unless directly instructed. If you do create git commits, follow these rules:
    - Choose a concise commit message
    - Orgnize the contents of each commit with test files that make sense together. It's okay for each .test.ts file to have its own commit if they're not related.

### Testing

Use the provided command format: yarn test -- --grep <test suite name>.
