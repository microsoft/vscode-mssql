---
type: "always_apply"
---

# VS Code MSSQL Extension - Development Guide

## Quick Reference

### Build Commands

```bash
yarn install          # Install dependencies (~60s first time, ~11s subsequent)
yarn build           # Full build (~19s) - NEVER CANCEL
yarn watch           # Development watch mode (continuous)
yarn lint src/ test/ # Lint source files only (~1.5s)
yarn test            # Run unit tests
yarn package --online # Create VSIX package (~4.5s)
```

### Pre-Commit Checklist

**ALWAYS run before committing:**

```bash
yarn build && yarn lint src/ test/ && yarn package --online
```

### Common Issues

-   **Lint fails**: Use `yarn lint src/ test/` (not `yarn lint`)
-   **Tests fail with ENOTFOUND**: Expected in sandboxed environments
-   **Watch mode stuck**: Ctrl+C and restart `yarn watch`

---

## Project Structure

```
src/
├── controllers/      # Extension controllers (MainController, webview controllers)
├── services/        # Business logic (ExecutionPlanService, CopilotService)
├── reactviews/      # React webview components
│   ├── common/      # Shared components (VscodeWebviewProvider)
│   ├── hooks/       # Custom React hooks
│   └── pages/       # Webview pages (ConnectionDialog, QueryResult, etc.)
├── models/          # Data models and contracts
├── sharedInterfaces/# Shared TypeScript interfaces (extension ↔ webview)
└── extension.ts     # Extension entry point
```

---

## Coding Standards

### Naming Conventions

-   **Files**: camelCase.ts/tsx (`mainController.ts`, `connectionFormPage.tsx`)
-   **Classes**: PascalCase (`MainController`, `ExecutionPlanService`)
-   **Interfaces**: PascalCase with `I` prefix (`IConnectionInfo`)
-   **Variables/Functions**: camelCase (`connectionManager`, `getExecutionPlan`)
-   **Private Members**: prefix with `_` (`private _connectionMgr`)
-   **Constants**: UPPER_SNAKE_CASE (`DEFAULT_PORT_NUMBER`)

### TypeScript Patterns

```typescript
// ✅ DO
async function getData(id: string): Promise<DataResult> {}
const result = await service.fetchData();
void this.runAndLogErrors(this.onNewConnection()); // Fire-and-forget

// ❌ DON'T
function process(data: any) {} // Avoid 'any'
this.someAsyncOperation(); // Floating promise (ESLint error)
```

### React Patterns

```typescript
// ✅ DO: Functional components with hooks
export const MyComponent: React.FC = () => {
    const context = useContext(MyContext);
    const [state, setState] = useState<string>("");

    useEffect(() => { /* Load data */ }, []);

    return <div>...</div>;
};

// ❌ DON'T: Class components
class MyComponent extends React.Component { } // Not allowed
```

---

## Architecture Patterns

### Extension Host Architecture

**Main Controller Pattern** - Centralized orchestration with dependency injection:

```typescript
export default class MainController implements vscode.Disposable {
    constructor(
        context: vscode.ExtensionContext,
        connectionManager?: ConnectionManager, // DI for testability
        vscodeWrapper?: VscodeWrapper,
    ) {}
}
```

**Service Layer Pattern** - Thin wrappers around SQL Tools Service:

```typescript
export class ExecutionPlanService {
    constructor(private _sqlToolsClient: SqlToolsServiceClient) {}

    async getExecutionPlan(planFile: ExecutionPlanGraphInfo): Promise<GetExecutionPlanResult> {
        try {
            return await this._sqlToolsClient.sendRequest(GetExecutionPlanRequest.type, params);
        } catch (e) {
            this._sqlToolsClient.logger.error(e);
            throw e; // Log then re-throw
        }
    }
}
```

### Webview Architecture (Three-Layer Pattern)

```
Extension Host              Webview (Browser)
┌──────────────────┐       ┌─────────────────────┐
│ Controller       │◄─RPC─►│ VscodeWebviewProvider│
│ - Lifecycle      │       │ - Context/Theme     │
│ - State          │       └─────────────────────┘
│ - Reducers       │                │
└──────────────────┘                ▼
                           ┌─────────────────────┐
                           │ StateProvider       │
                           │ - Exposes state     │
                           │ - Action methods    │
                           └─────────────────────┘
                                    │
                                    ▼
                           ┌─────────────────────┐
                           │ Page Component      │
                           │ - Renders UI        │
                           └─────────────────────┘
```

**Controller (Extension Side)**:

```typescript
export class MyFeatureController extends ReactWebviewPanelController<State, Reducers> {
    constructor(context: vscode.ExtensionContext, vscodeWrapper: VscodeWrapper) {
        super(context, vscodeWrapper, "myFeature", "myFeature", initialState, options);
        this.registerReducer("loadData", this.handleLoadData.bind(this));
    }

    private async handleLoadData(state: State): Promise<State> {
        // Return new state (immutable)
        return { ...state, data: await this.loadData() };
    }
}
```

**State Provider (Webview Side)**:

```typescript
export const MyFeatureStateProvider: React.FC = ({ children }) => {
    const webviewState = useVscodeWebview<MyFeatureState, MyFeatureReducers>();

    return (
        <MyFeatureContext.Provider value={{
            state: webviewState?.state,
            loadData: () => webviewState?.extensionRpc.action("loadData", {}),
        }}>
            {children}
        </MyFeatureContext.Provider>
    );
};
```

**Entry Point**:

```typescript
ReactDOM.createRoot(document.getElementById("root")!).render(
    <VscodeWebviewProvider2>
        <MyFeatureStateProvider>
            <MyFeaturePage />
        </MyFeatureStateProvider>
    </VscodeWebviewProvider2>
);
```

---

## Creating a New Webview

### Step 1: Define Shared Interfaces

`src/sharedInterfaces/myFeature.ts`:

```typescript
export interface MyFeatureState {
    isLoading: boolean;
    data: MyData[];
}

export interface MyFeatureReducers {
    loadData: () => void;
    selectItem: (payload: { itemId: string }) => void;
}
```

### Step 2: Create Controller

`src/controllers/myFeatureController.ts` - Extends `ReactWebviewPanelController`

### Step 3: Create React Components

`src/reactviews/pages/MyFeature/`:

-   `index.tsx` - Entry point
-   `myFeatureStateProvider.tsx` - State provider
-   `myFeaturePage.tsx` - Main component

### Step 4: Register Command

In `src/controllers/mainController.ts`:

```typescript
this.registerCommand("mssql.showMyFeature", async () => {
    const controller = new MyFeatureController(this._context, this._vscodeWrapper);
    await controller.revealToForeground();
});
```

---

## Communication Patterns

### Extension → Webview (Notifications)

```typescript
// Extension
await this.sendNotification(StateChangeNotification.type<State>(), newState);

// Webview
extensionRpc.onNotification(StateChangeNotification.type<State>(), (params) => {
    setState(params);
});
```

### Webview → Extension (Reducers)

```typescript
// Webview
extensionRpc.action("formAction", { event: formEvent });

// Extension
this.registerReducer("formAction", async (state, payload) => {
    return { ...state, formData: payload.event }; // Immutable update
});
```

---

## State Management

### Immutable State Updates

```typescript
// ✅ DO: Return new state
return { ...state, field: newValue };
return { ...state, nested: { ...state.nested, field: newValue } };
return { ...state, items: state.items.map((i) => (i.id === id ? { ...i, updated: true } : i)) };

// ❌ DON'T: Mutate state
state.field = newValue; // ❌
state.items.push(newItem); // ❌
```

### Progressive Updates

```typescript
private async handleLongOperation(state: State): Promise<State> {
    await this.updateState({ ...state, isLoading: true, progress: 0 });
    await this.updateState({ ...state, progress: 50 });
    return { ...state, isLoading: false, progress: 100, result: data };
}
```

---

## Component Patterns

### Component Organization

```typescript
export const MyComponent: React.FC = () => {
    // 1. Context hooks
    const context = useContext(MyContext);

    // 2. State hooks
    const [localState, setLocalState] = useState<string>("");

    // 3. Memoized values
    const filtered = useMemo(() => context.state.items.filter(i => i.visible), [context.state.items]);

    // 4. Callbacks
    const handleClick = useCallback(() => context.doSomething(localState), [context, localState]);

    // 5. Effects
    useEffect(() => { context.loadData(); }, []);

    // 6. Render
    return <div>...</div>;
};
```

### Fluent UI Styling

```typescript
import { makeStyles, tokens } from "@fluentui/react-components";

const useStyles = makeStyles({
    container: {
        backgroundColor: tokens.colorNeutralBackground1,
        color: tokens.colorNeutralForeground1,
        padding: tokens.spacingHorizontalL,
        borderRadius: tokens.borderRadiusMedium,
    },
});

export const MyComponent: React.FC = () => {
    const classes = useStyles();
    return <div className={classes.container}>...</div>;
};
```

---

## Error Handling & Logging

### Service Layer

```typescript
async getExecutionPlan(planFile: ExecutionPlanGraphInfo): Promise<GetExecutionPlanResult> {
    try {
        return await this._sqlToolsClient.sendRequest(GetExecutionPlanRequest.type, params);
    } catch (e) {
        this._sqlToolsClient.logger.error(e);
        throw e; // Re-throw after logging
    }
}
```

### Controller Layer

```typescript
private runAndLogErrors<T>(promise: Promise<T>): Promise<T> {
    return promise.catch((err) => {
        this._vscodeWrapper.showErrorMessage(LocalizedConstants.msgError + err);
        return undefined;
    });
}

// Usage
void this.runAndLogErrors(this.onNewConnection());
```

### Telemetry

```typescript
import { sendActionEvent, sendErrorEvent } from "../telemetry/telemetry";

sendActionEvent(
    TelemetryViews.ConnectionPrompt,
    TelemetryActions.Connect,
    { authenticationType: "SqlLogin" },
    { duration: 1234 },
);

sendErrorEvent(
    TelemetryViews.ConnectionPrompt,
    TelemetryActions.CreateConnectionResult,
    new Error(result.errorMessage),
    false,
    result.errorNumber?.toString(),
);
```

---

## Testing Patterns

### Unit Tests (Mocha + Sinon + Chai)

```typescript
import * as sinon from "sinon";
import { expect } from "chai";

suite("MyFeature Tests", () => {
    let sandbox: sinon.SinonSandbox;

    setup(() => {
        sandbox = sinon.createSandbox();
    });

    teardown(() => {
        sandbox.restore();
    });

    test("should do something", () => {
        const stub = sandbox.stub(MyClass.prototype, "method");
        stub.returns(42);

        const result = new MyClass().method();

        expect(result).to.equal(42);
        expect(stub.calledOnce).to.be.true;
    });
});
```

**DO**: Use Sinon sandbox pattern, `expect` from Chai, `sinon-chai` for assertions
**DON'T**: Use TypeMoq for new tests (legacy, prefer Sinon)

---

## File Organization

### Where to Put New Code

**New Controller**: `src/controllers/myFeatureController.ts`

-   Extends `ReactWebviewPanelController` or `ReactWebviewViewController`

**New Service**: `src/services/myFeatureService.ts`

-   Communicates with SQL Tools Service

**New React Page**: `src/reactviews/pages/MyFeature/`

```
MyFeature/
├── index.tsx
├── myFeaturePage.tsx
├── myFeatureStateProvider.tsx
└── components/
    └── myComponent.tsx
```

**New Shared Interface**: `src/sharedInterfaces/myFeature.ts`

-   Shared between extension and webview

**New Model/Contract**: `src/models/contracts/myFeature.ts`

-   Request/response types for SQL Tools Service

---

## Technology Stack

### Required Versions

-   **Node.js**: v20.19.4+
-   **Yarn**: v1.22+ (classic)
-   **TypeScript**: 5.8.3
-   **VS Code Engine**: ^1.98.0

### DO Use

-   React 18.3+ (functional components only)
-   Fluent UI @fluentui/react-components 9.64+
-   Context API + useReducer (no Redux)
-   axios 1.12+
-   Mocha + Sinon + Chai
-   esbuild 0.25+

### DON'T Use

-   Class components in React
-   Redux or MobX
-   Webpack (use esbuild)
-   Jest (use Mocha)
-   TypeMoq for new tests (use Sinon)

### Package Management

```bash
yarn add package-name      # Add dependency
yarn add -D package-name   # Add dev dependency
yarn remove package-name   # Remove dependency
```

**DON'T** manually edit `package.json` for dependencies.

---

## Build Process

### Build Steps

1. **Prepare**: Copy assets, generate localized strings
2. **Extension TypeScript**: Compile `src/` (excluding `reactviews`) → `out/`
3. **Extension Bundle**: Bundle with esbuild → `dist/extension.js`
4. **Webviews TypeScript**: Compile `src/reactviews/` (strict mode)
5. **Webviews Bundle**: Bundle each page separately → `dist/views/*.js`

### Watch Mode

```bash
yarn watch  # Runs 4 parallel watch processes
```

-   `watch:extension` - TypeScript compilation
-   `watch:extension-bundle` - esbuild bundling
-   `watch:webviews` - TypeScript compilation (strict)
-   `watch:webviews-bundle` - esbuild bundling

---

## Common Pitfalls & Solutions

| Problem                                                  | Solution                                                                   |
| -------------------------------------------------------- | -------------------------------------------------------------------------- |
| Lint fails with "Definition for rule not found"          | Use `yarn lint src/ test/` (not `yarn lint`)                               |
| Watch mode not detecting changes                         | Stop (Ctrl+C) and restart `yarn watch`                                     |
| Tests fail with "ENOTFOUND update.code.visualstudio.com" | Expected in sandboxed environments                                         |
| Webview not updating when state changes                  | Use `setState` from `VscodeWebviewProvider` context                        |
| RPC messages not being received                          | Check webview is ready before sending messages                             |
| "Cannot find module" errors                              | Check `tsconfig.extension.json` or `tsconfig.react.json` includes/excludes |

---

## Summary

**Key Principles**:

1. **Follow established patterns** - Consistency is critical
2. **Use TypeScript strictly** - Catch errors early
3. **Test thoroughly** - Write and run tests
4. **Validate before committing** - Run all checks
5. **Use dependency injection** - For testability
6. **Immutable state updates** - Always return new state objects
7. **Functional components only** - No class components in React

**Always reference this guide** when working on the extension to ensure consistency and quality.
