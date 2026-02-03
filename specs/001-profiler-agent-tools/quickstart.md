# Quickstart: Profiler Agent Tools

**Feature**: 1-profiler-agent-tools  
**Date**: February 2, 2026

## Overview

This guide provides the minimal steps to implement the Profiler Agent Tools feature following the established patterns in the MSSQL extension.

---

## Prerequisites

1. Development environment set up per [DEVELOPMENT.md](../../extensions/mssql/DEVELOPMENT.md)
2. `yarn install` completed in `extensions/mssql/`
3. Understanding of existing Copilot tools in `src/copilot/tools/`

---

## Implementation Order

### Step 1: Add Constants

**File**: `extensions/mssql/src/constants/constants.ts`

```typescript
// Add after existing copilot tool names (~line 223)
export const copilotProfilerListSessionsToolName = "mssql_profiler_list_sessions";
export const copilotProfilerGetSessionSummaryToolName = "mssql_profiler_get_session_summary";
export const copilotProfilerQueryEventsToolName = "mssql_profiler_query_events";
export const copilotProfilerGetEventDetailToolName = "mssql_profiler_get_event_detail";
```

### Step 2: Create Tool Files

Create four new files in `extensions/mssql/src/copilot/tools/`:

1. `profilerListSessionsTool.ts`
2. `profilerGetSessionSummaryTool.ts`
3. `profilerQueryEventsTool.ts`
4. `profilerGetEventDetailTool.ts`

### Step 3: Implement Tools

Each tool follows the same pattern:

```typescript
// profilerListSessionsTool.ts
import * as vscode from "vscode";
import { ToolBase } from "./toolBase";
import { ProfilerSessionManager } from "../../profiler/profilerSessionManager";
import * as Constants from "../../constants/constants";

export interface ListSessionsParams {
    // No params
}

export interface ListSessionsResult {
    success: boolean;
    message?: string;
    sessions: Array<{
        sessionId: string;
        sessionName: string;
        state: string;
        templateName: string;
        connectionLabel: string;
        eventCount: number;
        createdAt: string;
    }>;
}

export class ProfilerListSessionsTool extends ToolBase<ListSessionsParams> {
    public readonly toolName = Constants.copilotProfilerListSessionsToolName;

    constructor(private _sessionManager: ProfilerSessionManager) {
        super();
    }

    async call(
        _options: vscode.LanguageModelToolInvocationOptions<ListSessionsParams>,
        _token: vscode.CancellationToken,
    ): Promise<string> {
        const sessions = this._sessionManager.getAllSessions();
        
        const result: ListSessionsResult = {
            success: true,
            sessions: sessions.map(s => ({
                sessionId: s.id,
                sessionName: s.sessionName,
                state: s.state,
                templateName: s.templateName,
                connectionLabel: this.getConnectionLabel(s),
                eventCount: s.eventCount,
                createdAt: new Date(s.createdAt).toISOString(),
            })),
        };

        if (sessions.length === 0) {
            result.message = "No profiler sessions are currently available.";
        }

        return JSON.stringify(result);
    }

    private getConnectionLabel(session: any): string {
        // Extract server name from session context
        return session.ownerUri || "Unknown";
    }
}
```

### Step 4: Register Tools

**File**: `extensions/mssql/src/controllers/mainController.ts`

```typescript
// Add imports at top
import { ProfilerListSessionsTool } from "../copilot/tools/profilerListSessionsTool";
import { ProfilerGetSessionSummaryTool } from "../copilot/tools/profilerGetSessionSummaryTool";
import { ProfilerQueryEventsTool } from "../copilot/tools/profilerQueryEventsTool";
import { ProfilerGetEventDetailTool } from "../copilot/tools/profilerGetEventDetailTool";

// In registerLanguageModelTools() method, add:
this._context.subscriptions.push(
    vscode.lm.registerTool(
        Constants.copilotProfilerListSessionsToolName,
        new ProfilerListSessionsTool(this._profilerSessionManager),
    ),
);
// ... repeat for other tools
```

### Step 5: Write Unit Tests

**File**: `extensions/mssql/test/unit/copilot/tools/profilerListSessionsTool.test.ts`

```typescript
import { expect } from "chai";
import * as sinon from "sinon";
import { ProfilerListSessionsTool } from "../../../../src/copilot/tools/profilerListSessionsTool";
import { stubTelemetry } from "../../utils";

suite("ProfilerListSessionsTool Tests", () => {
    let sandbox: sinon.SinonSandbox;
    let mockSessionManager: any;

    setup(() => {
        sandbox = sinon.createSandbox();
        stubTelemetry(sandbox);
        mockSessionManager = {
            getAllSessions: sandbox.stub(),
        };
    });

    teardown(() => {
        sandbox.restore();
    });

    test("should return empty array when no sessions exist", async () => {
        mockSessionManager.getAllSessions.returns([]);
        const tool = new ProfilerListSessionsTool(mockSessionManager);
        
        const result = await tool.call({ input: {} } as any, {} as any);
        const parsed = JSON.parse(result);
        
        expect(parsed.success).to.be.true;
        expect(parsed.sessions).to.be.an("array").with.length(0);
        expect(parsed.message).to.include("No profiler sessions");
    });

    test("should return session list when sessions exist", async () => {
        mockSessionManager.getAllSessions.returns([{
            id: "test-id",
            sessionName: "Test Session",
            state: "running",
            templateName: "Standard",
            ownerUri: "server1",
            eventCount: 100,
            createdAt: Date.now(),
        }]);
        const tool = new ProfilerListSessionsTool(mockSessionManager);
        
        const result = await tool.call({ input: {} } as any, {} as any);
        const parsed = JSON.parse(result);
        
        expect(parsed.success).to.be.true;
        expect(parsed.sessions).to.have.length(1);
        expect(parsed.sessions[0].sessionName).to.equal("Test Session");
    });
});
```

---

## Build & Verify

```bash
cd extensions/mssql

# Build
yarn build

# Lint (only modified files)
yarn lint src/copilot/tools/profiler*.ts test/unit/copilot/tools/profiler*.ts

# Test
yarn test --grep "Profiler"

# Package (verify VSIX builds)
yarn package
```

---

## Key Patterns to Follow

### 1. Error Handling
Return `{ success: false, message: "..." }` for user errors, throw for unexpected errors (caught by ToolBase).

### 2. Text Truncation
Use helper function for consistent truncation:
```typescript
function truncateText(text: string, maxLength: number = 512): string {
    if (text.length <= maxLength) return text;
    return text.substring(0, maxLength - 15) + "... [truncated]";
}
```

### 3. Filtering
Delegate to FilteredBuffer:
```typescript
const filteredBuffer = new FilteredBuffer(session.events);
filteredBuffer.setFilter(params.filters);
const events = filteredBuffer.getFilteredRange(0, limit);
```

### 4. Response Size
Keep responses under 4KB by:
- Limiting event count (max 200)
- Truncating text fields
- Returning only essential fields in list views

---

## Testing Checklist

- [ ] Unit tests for each tool
- [ ] Tests for empty session list
- [ ] Tests for session not found
- [ ] Tests for filtering
- [ ] Tests for text truncation
- [ ] Tests for event not found
- [ ] Integration test with real Copilot (manual)

---

## Files Modified/Created

| File | Action | Purpose |
|------|--------|---------|
| `src/constants/constants.ts` | Modified | Tool name constants |
| `src/copilot/tools/profilerListSessionsTool.ts` | Created | List sessions tool |
| `src/copilot/tools/profilerGetSessionSummaryTool.ts` | Created | Summary tool |
| `src/copilot/tools/profilerQueryEventsTool.ts` | Created | Query tool |
| `src/copilot/tools/profilerGetEventDetailTool.ts` | Created | Detail tool |
| `src/controllers/mainController.ts` | Modified | Tool registration |
| `test/unit/copilot/tools/profiler*.test.ts` | Created | Unit tests |
