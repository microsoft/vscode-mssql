# Profiler Embedded Details Panel Implementation

## Overview

This document describes the changes required to move the Profiler Details Panel from the VS Code Panel area (bottom panel alongside Terminal, Output, etc.) to an embedded panel within the main Profiler webview, underneath the grid.

## Requirements

1. When a user selects a row in the profiler grid, show a details panel underneath the grid
2. The panel should occupy 50% of the container area, with the grid taking the other 50%
3. The panel should be resizable via a drag handle
4. Include a maximize button that expands the panel to ~95% of the area
5. Include a close button that hides the panel and returns 100% to the grid
6. All existing functionality (Copy, Open in Editor, Text/Details tabs) must work
7. Remove the VS Code Panel area registration since it's no longer needed

## Implementation Steps

### Step 1: Update Shared Interfaces

**File: `src/sharedInterfaces/profiler.ts`**

Add `selectedEvent` to `ProfilerWebviewState`:
```typescript
export interface ProfilerWebviewState {
    // ... existing fields ...
    /** The currently selected event details for the embedded details panel */
    selectedEvent?: ProfilerSelectedEventDetails;
}
```

Add new reducers for the embedded panel actions:
```typescript
export interface ProfilerReducers {
    // ... existing reducers ...
    /** Open TextData content in a new VS Code editor (embedded details panel) */
    openInEditor: {
        textData: string;
        eventName?: string;
    };
    /** Copy text to clipboard (embedded details panel) */
    copyToClipboard: {
        text: string;
    };
    /** Close the embedded details panel */
    closeDetailsPanel: Record<string, never>;
}
```

Remove the `ProfilerDetailsPanelState` and `ProfilerDetailsPanelReducers` interfaces (no longer needed).

### Step 2: Update Profiler Webview Controller

**File: `src/profiler/profilerWebviewController.ts`**

1. Remove the `ProfilerDetailsPanelViewController` import
2. Remove the `_detailsPanelController` field
3. Remove the `setDetailsPanelController()` method

4. Update `handleRowSelection()` to return event details and update state:
```typescript
private handleRowSelection(rowId: string): ProfilerSelectedEventDetails | undefined {
    if (!this._currentSession) {
        return undefined;
    }

    const event = this._currentSession.events.findById(rowId);
    if (!event) {
        return undefined;
    }

    const viewConfig = this._currentSession.viewConfig;
    const selectedEventDetails = getProfilerConfigService().buildEventDetails(
        event,
        viewConfig,
    );

    return selectedEventDetails;
}
```

5. Update the `selectRow` reducer to update state with selected event:
```typescript
this.registerReducer("selectRow", (state, payload: { rowId: string }) => {
    const selectedEvent = this.handleRowSelection(payload.rowId);
    return {
        ...state,
        selectedEvent,
    };
});
```

6. Add new reducers for embedded panel actions:
```typescript
// Handle Open in Editor request
this.registerReducer(
    "openInEditor",
    async (state, payload: { textData: string; eventName?: string }) => {
        ProfilerTelemetry.sendOpenInEditor();
        await this.openTextInEditor(payload.textData);
        return state;
    },
);

// Handle Copy to Clipboard request
this.registerReducer("copyToClipboard", async (state, payload: { text: string }) => {
    ProfilerTelemetry.sendCopyToClipboard("textData");
    await vscode.env.clipboard.writeText(payload.text);
    void vscode.window.showInformationMessage("Copied to clipboard");
    return state;
});

// Handle close details panel request
this.registerReducer("closeDetailsPanel", (state) => {
    return {
        ...state,
        selectedEvent: undefined,
    };
});
```

7. Add helper method for opening text in editor:
```typescript
private async openTextInEditor(textData: string): Promise<void> {
    try {
        const document = await vscode.workspace.openTextDocument({
            content: textData,
            language: "sql",
        });

        await vscode.window.showTextDocument(document, {
            viewColumn: vscode.ViewColumn.One,
            preview: true,
        });
    } catch (error) {
        void vscode.window.showErrorMessage(
            `Failed to open in editor: ${error instanceof Error ? error.message : String(error)}`,
        );
    }
}
```

### Step 3: Update Profiler State Provider

**File: `src/reactviews/pages/Profiler/profilerStateProvider.tsx`**

1. Add new methods to `ProfilerRpcMethods` interface:
```typescript
export interface ProfilerRpcMethods {
    // ... existing methods ...
    /** Open TextData content in a new VS Code editor (embedded details panel) */
    openInEditor: (textData: string, eventName?: string) => void;
    /** Copy text to clipboard (embedded details panel) */
    copyToClipboard: (text: string) => void;
    /** Close the embedded details panel */
    closeDetailsPanel: () => void;
}
```

2. Add implementations:
```typescript
const openInEditor = useCallback(
    (textData: string, eventName?: string) => {
        extensionRpc?.action("openInEditor", { textData, eventName });
    },
    [extensionRpc],
);

const copyToClipboard = useCallback(
    (text: string) => {
        extensionRpc?.action("copyToClipboard", { text });
    },
    [extensionRpc],
);

const closeDetailsPanel = useCallback(() => {
    extensionRpc?.action("closeDetailsPanel", {});
}, [extensionRpc]);
```

3. Add to context provider value.

### Step 4: Update Main Profiler Component

**File: `src/reactviews/pages/Profiler/profiler.tsx`**

1. Add imports:
```typescript
import { makeStyles, shorthands } from "@fluentui/react-components";
import { Panel, PanelGroup, PanelResizeHandle, ImperativePanelHandle } from "react-resizable-panels";
import { ProfilerDetailsPanel } from "./profilerDetailsPanel";
```

2. Add state and refs:
```typescript
const selectedEvent = useProfilerSelector((s) => s.selectedEvent);
const detailsPanelRef = useRef<ImperativePanelHandle | null>(null);
const [isDetailsPanelMaximized, setIsDetailsPanelMaximized] = useState(false);
const showDetailsPanel = selectedEvent !== undefined;
```

3. Get new context methods:
```typescript
const {
    // ... existing methods ...
    openInEditor,
    copyToClipboard,
    closeDetailsPanel,
} = useProfilerContext();
```

4. Add handler functions:
```typescript
const handleOpenInEditor = useCallback(
    (textData: string, eventName?: string) => {
        openInEditor(textData, eventName);
    },
    [openInEditor],
);

const handleCopy = useCallback(
    (text: string) => {
        copyToClipboard(text);
    },
    [copyToClipboard],
);

const handleToggleMaximize = useCallback(() => {
    if (detailsPanelRef.current) {
        if (isDetailsPanelMaximized) {
            detailsPanelRef.current.resize(50);
        } else {
            detailsPanelRef.current.resize(95);
        }
        setIsDetailsPanelMaximized(!isDetailsPanelMaximized);
    }
}, [isDetailsPanelMaximized]);

const handleCloseDetailsPanel = useCallback(() => {
    setIsDetailsPanelMaximized(false);
    closeDetailsPanel();
}, [closeDetailsPanel]);
```

5. Update JSX to use PanelGroup:
```tsx
<PanelGroup direction="vertical" className={classes.panelGroup}>
    <Panel defaultSize={showDetailsPanel ? 50 : 100} minSize={10}>
        <div id="profilerGridContainer" className={classes.profilerGridContainer}>
            <SlickgridReact ... />
        </div>
    </Panel>
    {showDetailsPanel && (
        <>
            <PanelResizeHandle className={classes.resizeHandle} />
            <Panel
                ref={detailsPanelRef}
                defaultSize={50}
                minSize={10}
                className={classes.detailsPanelContainer}>
                <ProfilerDetailsPanel
                    selectedEvent={selectedEvent}
                    themeKind={themeKind}
                    isMaximized={isDetailsPanelMaximized}
                    onOpenInEditor={handleOpenInEditor}
                    onCopy={handleCopy}
                    onToggleMaximize={handleToggleMaximize}
                    onClose={handleCloseDetailsPanel}
                    isPanelView={false}
                />
            </Panel>
        </>
    )}
</PanelGroup>
```

6. Add new styles:
```typescript
const useStyles = makeStyles({
    // ... existing styles ...
    panelGroup: {
        ...shorthands.flex(1),
        width: "100%",
        height: "100%",
        minHeight: 0,
        ...shorthands.overflow("hidden"),
    },
    profilerGridContainer: {
        // ... update to include height: "100%"
    },
    resizeHandle: {
        height: "4px",
        backgroundColor: "var(--vscode-editorWidget-border)",
        cursor: "row-resize",
        "&:hover": {
            backgroundColor: "var(--vscode-focusBorder)",
        },
    },
    detailsPanelContainer: {
        display: "flex",
        flexDirection: "column",
        ...shorthands.overflow("hidden"),
        height: "100%",
    },
});
```

### Step 5: Remove VS Code Panel Registration

**File: `src/profiler/profilerController.ts`**

1. Remove `ProfilerDetailsPanelViewController` import
2. Remove `_detailsPanelController` field
3. Remove `registerDetailsPanelView()` method
4. Remove call to `registerDetailsPanelView()` in constructor
5. Remove `setDetailsPanelController()` call when creating webview controllers

### Step 6: Update package.json

**File: `package.json`**

Remove the profilerDetails panel container and view:
```json
// Remove from viewsContainers.panel:
{
    "id": "profilerDetails",
    "title": "%extension.profilerDetails%",
    "icon": "media/executionPlan_dark.svg"
}

// Remove from views:
"profilerDetails": [
    {
        "type": "webview",
        "id": "profilerDetails",
        "name": "%extension.profilerDetails%",
        "when": "mssql.profilerDetailsVisible"
    }
]
```

### Step 7: Update package.nls.json

**File: `package.nls.json`**

Remove the localization string:
```json
"extension.profilerDetails": "Profiler Event Details",
```

### Step 8: Update Bundle Script

**File: `scripts/bundle-reactviews.js`**

Remove the profilerDetails entry point:
```javascript
// Remove this line:
profilerDetails: "src/reactviews/pages/Profiler/profilerDetailsPanelIndex.tsx",
```

### Step 9: Delete Dead Code Files

Delete the following files that are no longer needed:
- `src/profiler/profilerDetailsPanelViewController.ts`
- `src/reactviews/pages/Profiler/profilerDetailsPanelIndex.tsx`
- `src/reactviews/pages/Profiler/profilerDetailsPanelPage.tsx`
- `src/reactviews/pages/Profiler/profilerDetailsPanelSelector.ts`
- `src/reactviews/pages/Profiler/profilerDetailsPanelStateProvider.tsx`
- `test/unit/profiler/profilerDetailsPanelViewController.test.ts`

### Step 10: Update Test Files

**File: `test/unit/profiler/profilerController.test.ts`**

1. Remove `ProfilerDetailsPanelViewController` import
2. Remove any `ProfilerDetailsPanelViewController.resetInstance()` calls in teardown blocks

## Verification

1. Run `yarn build` to verify compilation
2. Run `yarn test` to verify all tests pass
3. Manually test:
   - Launch profiler
   - Start a session
   - Click on a row in the grid
   - Verify details panel appears below grid at 50% height
   - Test resize handle
   - Test maximize button
   - Test close button
   - Test Copy button
   - Test Open in Editor button
   - Test Text and Details tabs

## Dependencies

The implementation uses `react-resizable-panels` which is already a dependency in the project (used by TableExplorer and other components).
