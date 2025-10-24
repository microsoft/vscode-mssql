# Connection Bug Fix - October 20, 2025

## Problem Summary

**Issue**: When selecting a server from the dropdown in the Data-tier Application form, connections were succeeding (confirmed by output log showing "Connected to server 'localhost\MSSQLSERVER22'") but the UI was showing a generic error "Failed to connect to server".

**Impact**: Users couldn't use the server selection dropdown feature despite connections working at the backend level.

## Root Cause Analysis

### The Bug

In `src/controllers/dataTierApplicationWebviewController.ts`, the `connectToServer()` method had a critical flaw:

```typescript
// BEFORE (Buggy Code)
const ownerUri = this.connectionManager.getUriForConnection(profile);
const result = await this.connectionManager.connect(ownerUri, profile);

if (result) {
    return {
        ownerUri, // ❌ Still undefined!
        isConnected: true,
    };
}
```

### Why It Failed

1. **Step 1**: `getUriForConnection(profile)` was called to check if connection exists

    - For **new connections**: Returns `undefined` (connection doesn't exist yet in activeConnections)
    - For **existing connections**: Returns the actual URI

2. **Step 2**: `connect(ownerUri, profile)` was called with `ownerUri = undefined`

    - `ConnectionManager.connect()` has logic (lines 1137-1139): If `fileUri` is empty/undefined, it generates a **new random URI**
    - Connection succeeds with the new URI ✅
    - Returns `true` ✅

3. **Step 3**: Return the result

    - We returned `{ownerUri: undefined, isConnected: true}` ❌
    - But the **actual connection** used a different URI that was generated internally!

4. **Step 4**: React form validation
    - Check: `if (result?.isConnected && result.ownerUri)`
    - Fails because `result.ownerUri` is `undefined` ❌
    - Shows error message even though connection succeeded

### Visual Flow Diagram

```
User selects server
       ↓
getUriForConnection(profile) → undefined (new connection)
       ↓
connect(undefined, profile)
       ↓
ConnectionManager generates new URI: "ObjectExplorer_guid123"
       ↓
Connection succeeds, returns true ✅
       ↓
BUT we return {ownerUri: undefined, isConnected: true} ❌
       ↓
React form checks: result?.isConnected && result.ownerUri
       ↓
undefined is falsy → Shows error ❌
```

## The Fix

### Code Changes

Changed the `connectToServer()` method to retrieve the actual URI **after** connection succeeds:

```typescript
// AFTER (Fixed Code)
let ownerUri = this.connectionManager.getUriForConnection(profile);
const existingConnection = ownerUri && this.connectionManager.activeConnections[ownerUri];

if (existingConnection) {
    return {
        ownerUri,
        isConnected: true,
    };
}

// Pass empty string to let connect() generate the URI
const result = await this.connectionManager.connect("", profile);

if (result) {
    // Get the actual ownerUri that was used for the connection
    ownerUri = this.connectionManager.getUriForConnection(profile); // ✅ Now gets the real URI!
    return {
        ownerUri,
        isConnected: true,
    };
}
```

### Key Changes

1. **Changed `const` to `let`**: Allow `ownerUri` to be reassigned after connection
2. **Pass empty string to `connect()`**: Explicitly let ConnectionManager generate the URI
3. **Call `getUriForConnection()` again**: After successful connection, retrieve the actual URI that was generated
4. **Updated condition check**: Check both `ownerUri` existence and `activeConnections[ownerUri]` together

## Test Coverage

### New Test Added

**Test Name**: `retrieves ownerUri after successful connection when initially undefined`

**Purpose**: Validates the exact bug scenario - when `getUriForConnection()` returns `undefined` before connection, but after successful `connect()`, we retrieve the actual generated URI.

**Test Implementation**:

```typescript
test("retrieves ownerUri after successful connection when initially undefined", async () => {
    connectionStoreStub.getRecentlyUsedConnections.returns([mockConnections[0]]);

    // First call returns undefined (connection doesn't exist yet)
    // Second call returns the actual URI (after connection is established)
    connectionManagerStub.getUriForConnection
        .onFirstCall()
        .returns(undefined)
        .onSecondCall()
        .returns("generated-owner-uri-123");

    connectionManagerStub.connect.resolves(true);

    // No active connections initially
    sandbox.stub(connectionManagerStub, "activeConnections").get(() => ({}));

    createController();

    const handler = requestHandlers.get(ConnectToServerWebviewRequest.type.method);
    const result = await handler!({ profileId: "conn1" });

    // Verify we get the actual generated URI, not undefined
    expect(result.isConnected).to.be.true;
    expect(result.ownerUri).to.equal("generated-owner-uri-123");
    expect(result.errorMessage).to.be.undefined;

    // Verify the sequence of calls
    expect(connectionManagerStub.getUriForConnection).to.have.been.calledTwice;
    expect(connectionManagerStub.connect).to.have.been.calledOnce;
    expect(connectionManagerStub.connect).to.have.been.calledWith("", mockConnections[0]);
});
```

### Updated Test

**Test Name**: `connects to server successfully when not already connected`

**Change**: Updated assertion to expect `getUriForConnection` to be called **twice** instead of once:

-   First call: Check if connection exists
-   Second call: Get the actual URI after connection succeeds

```typescript
// Updated assertion
expect(connectionManagerStub.getUriForConnection).to.have.been.calledTwice;
```

## Test Results

### Before Fix

-   **Total Tests**: 49
-   **Passing**: 48
-   **Failing**: 1 (expected `calledOnce` but was `calledTwice`)

### After Fix

-   **Total Tests**: 50 (added 1 new test)
-   **Passing**: 50 ✅
-   **Failing**: 0 ✅
-   **Pass Rate**: 100%

## Impact

### What Now Works

1. ✅ User can select server from dropdown
2. ✅ Connection succeeds (as before)
3. ✅ UI receives correct `ownerUri`
4. ✅ Form shows success status instead of error
5. ✅ Database dropdown auto-loads for the connected server
6. ✅ User can proceed with Deploy/Extract/Import/Export operations

### User Experience

**Before**:

-   Select server → "Failed to connect to server" ❌
-   (But output shows "Connected to server..." 🤔)

**After**:

-   Select server → Connection indicator turns green ● ✅
-   Database dropdown loads automatically ✅
-   Ready to perform operations ✅

## Files Changed

1. **src/controllers/dataTierApplicationWebviewController.ts**

    - Lines 486-511: Fixed `connectToServer()` method
    - Changed `const` to `let` for `ownerUri`
    - Added second call to `getUriForConnection()` after successful connection

2. **test/unit/dataTierApplicationWebviewController.test.ts**

    - Line 993: Updated existing test to expect `calledTwice`
    - Lines 996-1027: Added new test for undefined → defined URI scenario

3. **DATA_TIER_APPLICATION_UNIT_TESTS.md**
    - Updated total test count: 49 → 50
    - Added documentation for new test (#7)
    - Marked with ⭐ NEW badge and detailed explanation

## Prevention

### Why Unit Tests Didn't Catch This Initially

The original test mocked `getUriForConnection()` to always return a URI, which doesn't represent the real scenario where:

-   First call: Connection doesn't exist yet → returns `undefined`
-   Second call: After connection succeeds → returns the actual URI

### New Test Pattern

Use Sinon's `.onFirstCall()` and `.onSecondCall()` to simulate state changes:

```typescript
connectionManagerStub.getUriForConnection
    .onFirstCall()
    .returns(undefined) // Before connection
    .onSecondCall()
    .returns("actual-uri"); // After connection
```

This pattern ensures tests match real-world runtime behavior.

## Verification Steps for Manual Testing

1. Open Data-tier Application form (without active connection)
2. Click "Source Server" dropdown
3. Select any server from the list
4. **Expected**:
    - Connection indicator turns green ●
    - No error message shown
    - Database dropdown becomes enabled and loads databases
5. **Actual**: Should match expected behavior now ✅

## Related Issues

-   Original feature request: Add server selection dropdown
-   Bug report: "I manually tested the form, and when I selected a Server I get a generic error 'Failed to connect to server' while in the output I get Connected to server 'localhost\MSSQLSERVER22'"

## Conclusion

This was a classic case of **losing the return value** from an async operation. The connection succeeded, but we never captured the URI that was actually used. The fix ensures we retrieve the actual URI after connection completes, allowing the UI to properly track the connection state.

**Key Lesson**: When an operation generates a value internally (like ConnectionManager generating a URI), you must query for that value after the operation completes - don't assume you have it before the operation runs.
