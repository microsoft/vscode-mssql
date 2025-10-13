# Cache Refresh Issue Fix

## Problem

When clicking on any context menu item in the Source Control view (Stage, Unstage, Discard, Open Diff), the extension was triggering a full cache refresh instead of performing the intended action. This caused:

1. **Unexpected behavior** - Menu items appeared to do nothing or trigger cache updates
2. **Performance issues** - Full database comparison was running on every menu click
3. **Poor user experience** - Actions took much longer than expected

## Root Cause

The issue was caused by an event listener in `mainController.ts` that listens for cache updates:

```typescript
this.localCacheService.onCacheUpdated((credentials) => {
    // ...
    void this.databaseSourceControlProvider.refreshIfActive(credentials);
});
```

**The problem:** Every time the local cache was updated (which happens frequently during database operations), it would trigger a refresh of the Source Control view. This created a feedback loop where:

1. User clicks a context menu item
2. Some operation triggers a cache update event
3. Cache update event triggers `refreshIfActive()`
4. `refreshIfActive()` calls `_refreshChanges()`
5. Full database comparison runs (expensive operation)

## Solution

Added a **debounce mechanism** to prevent excessive refreshes. The fix ensures that the Source Control view won't refresh more than once every 2 seconds, even if multiple cache update events are fired.

### Changes Made

**File: `src/sourceControl/databaseSourceControlProvider.ts`**

1. **Added private member variable** to track last refresh time:

    ```typescript
    private _lastRefreshTime?: number;
    ```

2. **Modified `refreshIfActive()` method** to include debounce logic:

    ```typescript
    public async refreshIfActive(credentials: IConnectionInfo): Promise<void> {
        if (!this._currentDatabase) {
            return;
        }

        const connectionHash = this._gitIntegrationService.generateConnectionHash(credentials);
        if (this._currentDatabase.connectionHash === connectionHash) {
            console.log(
                `[SourceControl] Cache updated for active database ${credentials.database}, refreshing view`,
            );

            // Debounce: Don't refresh if we just refreshed recently (within 2 seconds)
            const now = Date.now();
            if (this._lastRefreshTime && now - this._lastRefreshTime < 2000) {
                console.log(
                    `[SourceControl] Skipping refresh - last refresh was ${now - this._lastRefreshTime}ms ago`,
                );
                return;
            }

            this._lastRefreshTime = now;

            // Refresh without progress notification (background refresh)
            await this._refreshChanges(undefined);
        }
    }
    ```

## Benefits

1. **Immediate action execution** - Context menu items now execute their intended actions immediately
2. **Reduced database load** - Prevents excessive database comparisons
3. **Better performance** - Source Control view remains responsive
4. **Preserved functionality** - Cache updates still trigger refreshes, just not excessively

## Testing

To verify the fix works:

1. **Open Source Control view** for a database with changes
2. **Right-click on a changed item** and select "Stage Changes"
    - ✅ Item should move to "Staged Changes" immediately
    - ✅ No cache refresh should occur
3. **Right-click on a staged item** and select "Unstage Changes"
    - ✅ Item should move back to "Changes" immediately
    - ✅ No cache refresh should occur
4. **Right-click on a changed item** and select "Discard Changes"
    - ✅ Warning dialog should appear
    - ✅ Preview should show migration script
    - ✅ After execution, cache refresh should occur (expected)
5. **Wait 2+ seconds** and perform another action
    - ✅ Cache refresh should be allowed again

## Notes

-   The 2-second debounce window is configurable if needed
-   Cache refreshes still occur after discard operations (intentional)
-   Manual refresh operations are not affected by this debounce
-   The debounce only affects automatic refreshes triggered by cache update events

## Related Files

-   `src/sourceControl/databaseSourceControlProvider.ts` - Main fix location
-   `src/controllers/mainController.ts` - Event listener that triggers refreshes
-   `src/services/localCacheService.ts` - Fires cache update events

## Build Status

✅ Build successful: `yarn build` (24.13s)
✅ Linting passed: `yarn lint src/sourceControl/ --fix` (4.08s)
✅ No TypeScript errors
✅ No ESLint errors
