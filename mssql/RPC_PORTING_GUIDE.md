# Agent Instructions: Porting RPC Methods from Azure Data Studio to VS Code MSSQL

## Overview
This guide enables an AI agent to port RPC-based functionality from Azure Data Studio (ADS) to the VS Code MSSQL extension following established patterns.

## Prerequisites
- Access to both repositories:
  - Azure Data Studio: https://github.com/microsoft/azuredatastudio
  - VS Code MSSQL: https://github.com/microsoft/vscode-mssql

## Input Required
The agent needs:
1. **Functionality Name**: The feature to port (e.g., "Profiler", "QueryPlan", "Backup", "Restore")
2. **ADS Source Path**: Path in ADS repo where the functionality exists (e.g., `src/sql/workbench/services/profiler/`)

## Step-by-Step Porting Process

### Phase 1: Discovery and Analysis in Azure Data Studio Repo

#### Step 1.1: Locate the Service Interface
**Search Pattern**: `I{FunctionalityName}Service` interface
**Typical Location**: `src/sql/workbench/services/{functionality}/common/{functionality}Service.ts`

**Agent Actions**:
1. Find the interface definition (e.g., `IProfilerService`)
2. Extract all method signatures
3. Note the return types (Promise types are important)
4. Document any event emitters or notifications

**Example Interface to Extract**:
```typescript
export interface IProfilerService {
    createSession(ownerUri: string, sessionName: string, template: ProfilerSessionTemplate): Promise<boolean>;
    startSession(ownerUri: string, sessionName: string): Promise<boolean>;
    stopSession(ownerUri: string, sessionName: string): Promise<boolean>;
    // ... more methods
}
```

#### Step 1.2: Locate Request/Response Contracts
**Search Pattern**: Request and Response type definitions
**Typical Location**: `src/sql/workbench/services/{functionality}/common/{functionality}Contracts.ts` or similar

**Agent Actions**:
1. Find all `*Request` and `*Response` types
2. Find all `*Params` types
3. Extract enums used by the functionality
4. Note any notification types (e.g., `*NotificationParams`)

**Example Contracts to Extract**:
```typescript
export interface CreateSessionRequest {
    ownerUri: string;
    sessionName: string;
    template: ProfilerSessionTemplate;
}

export interface CreateSessionResponse {
    succeeded: boolean;
    errorMessage?: string;
}
```

#### Step 1.3: Locate RPC Request Definitions
**Search Pattern**: `RequestType` and `NotificationType` definitions
**Typical Location**: Same file as contracts or in a separate `*Contracts.ts` file

**Agent Actions**:
1. Find all `RequestType<TParams, TResult>` definitions
2. Find all `NotificationType<TParams>` definitions
3. Extract the RPC method names (string constants)
4. Map each RequestType to its params and response types

**Example RPC Definitions to Extract**:
```typescript
export namespace CreateXEventSessionRequest {
    export const type = new RequestType<CreateXEventSessionParams, CreateXEventSessionResponse, void, void>('profiler/createsession');
}

export namespace ProfilerEventsAvailableNotification {
    export const type = new NotificationType<ProfilerEventsAvailableParams, void>('profiler/eventsavailable');
}
```

#### Step 1.4: Locate Supporting Types
**Agent Actions**:
1. Find all interface definitions used by the contracts (e.g., `ProfilerSessionTemplate`, `ProfilerEvent`)
2. Find all enums (e.g., `ProfilingSessionType`)
3. Extract complete type definitions with all properties
4. Note any default values or constants

### Phase 2: Generate VS Code MSSQL Extension Files

#### Step 2.1: Generate `vscode-mssql.d.ts` Types
**File Location**: `mssql/typings/vscode-mssql.d.ts`

**Agent Instructions**:
1. Open the existing `vscode-mssql.d.ts` file
2. Locate the `declare module "vscode-mssql"` section
3. Add the service interface after existing service interfaces (e.g., after `IDacFxService`)
4. Add all supporting types in the following order:
   - Enums first
   - Simple interfaces
   - Complex interfaces that depend on simple ones
   - The service interface last

**Template for Service Interface**:
```typescript
export interface I{FunctionalityName}Service {
    // Method signatures from ADS IService interface
    {methodName}({params}): Promise<{ReturnType}>;
    
    // Notification registration methods
    registerOn{NotificationName}(handler: (params: {NotificationParams}) => void): void;
}
```

**Template for Types**:
```typescript
// Enums
export enum {EnumName} {
    {Value1} = {Number},
    {Value2} = {Number}
}

// Parameter interfaces
export interface {FunctionalityName}{Operation}Params {
    {property}: {type};
    // ... more properties
}

// Response interfaces
export interface {FunctionalityName}{Operation}Response {
    succeeded: boolean;
    errorMessage?: string;
    // ... more properties
}

// Event/Notification interfaces
export interface {FunctionalityName}{Event}Params {
    // ... event properties
}
```

**Important Notes**:
- Remove ADS-specific imports (like `import * as azdata`)
- Convert azdata types to plain TypeScript types
- Use `vscode.Uri` instead of ADS URI types if needed
- Keep property names exactly as they are in ADS

#### Step 2.2: Generate `{functionality}Contracts.ts`
**File Location**: `mssql/src/models/contracts/{functionality}/{functionality}Contracts.ts`

**Agent Instructions**:
1. Create the directory structure if it doesn't exist
2. Import required types:
   ```typescript
   import { RequestType, NotificationType } from "vscode-languageclient";
   import type * as mssql from "vscode-mssql";
   ```
3. Create request type definitions for each RPC method
4. Create notification type definitions for each notification
5. Use the exact RPC method names from ADS

**Template**:
```typescript
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { RequestType, NotificationType } from "vscode-languageclient";
import type * as mssql from "vscode-mssql";

// Request Types
export namespace {Operation}Request {
    export const type = new RequestType<
        mssql.{FunctionalityName}{Operation}Params,
        mssql.{FunctionalityName}{Operation}Response,
        void,
        void
    >("{rpcMethodName}");
}

// Notification Types
export namespace {Event}Notification {
    export const type = new NotificationType<
        mssql.{FunctionalityName}{Event}Params,
        void
    >("{rpcNotificationName}");
}
```

**RPC Naming Convention**:
- Request names: `{functionality}/{operation}` (e.g., `profiler/createsession`, `backup/backup`)
- Notification names: `{functionality}/{event}` (e.g., `profiler/eventsavailable`)
- Use lowercase, no spaces

#### Step 2.3: Generate `{functionality}Service.ts`
**File Location**: `mssql/src/services/{functionality}Service.ts`

**Agent Instructions**:
1. Import the SqlToolsServiceClient
2. Import all contracts
3. Import types from vscode-mssql module
4. Create a class that implements the service interface
5. Implement all methods using the RPC client
6. Implement notification registration methods

**Template**:
```typescript
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type * as mssql from "vscode-mssql";
import { SqlToolsServiceClient } from "../languageservice/serviceclient";
import * as {functionality}Contracts from "../models/contracts/{functionality}/{functionality}Contracts";

export class {FunctionalityName}Service implements mssql.I{FunctionalityName}Service {
    constructor(private _client: SqlToolsServiceClient) {}

    // Request methods
    public async {methodName}(
        {param1}: {Type1},
        {param2}: {Type2}
    ): Promise<{ReturnType}> {
        const params: mssql.{FunctionalityName}{Operation}Params = {
            {param1},
            {param2}
        };

        const response = await this._client.sendRequest(
            {functionality}Contracts.{Operation}Request.type,
            params
        );

        return response.{property}; // or process response as needed
    }

    // Notification registration methods
    public registerOn{NotificationName}(
        handler: (params: mssql.{FunctionalityName}{Event}Params) => void
    ): void {
        this._client.onNotification(
            {functionality}Contracts.{Event}Notification.type,
            handler
        );
    }
}
```

**Important Implementation Notes**:
- `SqlToolsServiceClient.sendRequest()` returns a Promise
- `SqlToolsServiceClient.onNotification()` returns `void` (not Disposable)
- Map ADS method signatures to match the RPC contract parameters
- Handle response extraction (e.g., return `response.succeeded` if that's what the interface expects)
- Use async/await for all request methods

### Phase 3: Integration

#### Step 3.1: Export Service from Main Controller
**File**: `mssql/src/controllers/mainController.ts`

**Agent Actions**:
1. Import the service class
2. Instantiate the service with `this._client` (SqlToolsServiceClient)
3. Store it as a private property
4. Create a getter to expose it

**Template**:
```typescript
import { {FunctionalityName}Service } from "../services/{functionality}Service";

export default class MainController {
    private _{functionalityName}Service: {FunctionalityName}Service;

    // In constructor or initialization:
    this._{functionalityName}Service = new {FunctionalityName}Service(this._client);

    // Getter
    public get {functionalityName}Service(): {FunctionalityName}Service {
        return this._{functionalityName}Service;
    }
}
```

#### Step 3.2: Add to Extension API
**File**: `mssql/src/extension.ts`

**Agent Actions**:
1. Locate the extension API export
2. Add the service getter to the API object

**Template**:
```typescript
const api = {
    // ... existing properties
    get {functionalityName}Service() {
        return mainController.{functionalityName}Service;
    }
};
```


## Agent Checklist

For each functionality being ported, verify:

- [ ] All types from ADS are copied to `vscode-mssql.d.ts`
- [ ] Service interface is added to `vscode-mssql.d.ts`
- [ ] All RequestType definitions created in contracts file
- [ ] All NotificationType definitions created in contracts file
- [ ] RPC method names match ADS exactly
- [ ] Service class implements the interface
- [ ] All methods map parameters correctly to RPC params
- [ ] All methods return the correct type from RPC response
- [ ] Notification handlers registered correctly
- [ ] Service is instantiated in MainController
- [ ] Service is exposed in extension API
- [ ] No ADS-specific imports remain
- [ ] Copyright headers included in all new files

## Quick Reference: File Locations

| Component | Location |
|-----------|----------|
| Type Definitions | `mssql/typings/vscode-mssql.d.ts` |
| Contracts | `mssql/src/models/contracts/{functionality}/{functionality}Contracts.ts` |
| Service Implementation | `mssql/src/services/{functionality}Service.ts` |
| Constants | `mssql/src/constants/constants.ts` |

## Agent Prompt Template

Use this template to instruct an agent:

```
Port the {functionality} service from Azure Data Studio to VS Code MSSQL extension.

ADS Repository: https://github.com/microsoft/azuredatastudio
Source Path: src/sql/workbench/services/{functionality}

Follow the RPC Porting Guide to:
1. Extract the I{FunctionalityName}Service interface from ADS
2. Extract all request/response types and RPC definitions
3. Generate vscode-mssql.d.ts type additions
4. Generate {functionality}Contracts.ts with RPC definitions
5. Generate {functionality}Service.ts implementation
6. Update mainController.ts to instantiate and expose the service
7. Update extension.ts to add service to API

Ensure all types match exactly, RPC method names are preserved, and the service correctly implements the interface following the DacFxService pattern.
```

## Example: DacFx Service

The DacFx service is a good reference example for understanding the porting pattern:

### Files Created:
- `mssql/typings/vscode-mssql.d.ts` - Contains `IDacFxService` interface and related types
- `mssql/src/models/contracts/dacFx/dacFxContracts.ts` - Contains RPC request/response definitions
- `mssql/src/services/dacFxService.ts` - Service implementation

### Key Patterns:
1. **Type Definitions**: All types are defined in `vscode-mssql.d.ts` within the `declare module "vscode-mssql"` block
2. **Contracts**: Use `RequestType` from `vscode-languageclient` with proper typing
3. **Service**: Implements the interface and uses `this._client.sendRequest()` for RPC calls
4. **Integration**: Service instantiated in `mainController.ts` and exposed via `extension.ts`

## Common Patterns and Best Practices

### Type Conversion
- **ADS `azdata.` types** → Plain TypeScript interfaces
- **ADS URIs** → `string` (or `vscode.Uri` if needed)
- **ADS Promises** → TypeScript `Promise<T>`

### Naming Conventions
- Service interface: `I{FunctionalityName}Service`
- Service class: `{FunctionalityName}Service`
- Contracts namespace: `{Operation}Request` / `{Event}Notification`
- RPC method names: lowercase with slashes (e.g., `dacfx/export`)

### Error Handling
- Services should let errors propagate to the caller
- RPC responses should include error information in the response object
- Use `ResultStatus` interface pattern: `{ success: boolean; errorMessage: string; }`

### Testing
After porting a service:
1. Build the extension
2. Test each method through the extension API
3. Verify notification handlers work correctly
4. Ensure error cases are handled properly

## Troubleshooting

### Common Issues

**Issue**: Types not found when building
- **Solution**: Ensure all types are exported from `vscode-mssql.d.ts`

**Issue**: RPC method not found
- **Solution**: Verify the method name matches exactly with ADS (case-sensitive)

**Issue**: Service not accessible from extension API
- **Solution**: Check that service is instantiated in mainController and exposed in extension.ts

**Issue**: Notification not firing
- **Solution**: Ensure `onNotification` is called on the client, not `registerNotification`

## Additional Resources

- [Azure Data Studio Repository](https://github.com/microsoft/azuredatastudio)
- [VS Code Language Server Protocol](https://microsoft.github.io/language-server-protocol/)
- [TypeScript Handbook](https://www.typescriptlang.org/docs/handbook/intro.html)
