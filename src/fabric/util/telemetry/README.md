# Telemetry Service for VS Code Extensions

The telemetry service provides a standardized way to collect telemetry data across VS Code extensions. It's a utility library that can be consumed by any client requiring robust telemetry capabilities. 

## Features

- Default/common properties applied events
- Strongly-typed telemetry events with TypeScript
- Activity duration tracking

## Components

The telemetry package consists of several key components:

1. **TelemetryService**: The main service class that handles sending telemetry events to Application Insights.
   - Supports default properties that can be included in all events
   - Provides methods for sending telemetry events, error events, and exceptions

2. **TelemetryEvent**: A class representing a telemetry event with strongly-typed properties and measurements.

3. **TelemetryActivity**: Extends TelemetryEvent to track the duration of activities, with start and end times.

4. **TelemetryEventNames**: Defines the default schema for all telemetry events, ensuring consistent property and measurement names.

5. **TelemetryTypeHelpers**: Provides TypeScript utility types for working with telemetry events in a type-safe manner.

## Why Use Strongly-Typed Telemetry?

Using strongly-typed telemetry events provides several advantages for development and maintenance:

1. **Compile-Time Type Safety**: Catches property and measurement name typos during development instead of discovering them in production data.

2. **Discoverability**: TypeScript's IntelliSense provides autocomplete for all valid properties and measurements for a specific event, making it easier to know what data to collect.

3. **Self-Documenting Code**: The type definitions serve as documentation for what data should be included with each event type.

4. **Schema Consistency**: Enforces consistent property names across the codebase, making aggregation and analysis of telemetry data more reliable.

5. **Refactoring Confidence**: When renaming properties or changing event schemas, TypeScript will identify all places that need updates.

6. **Data Quality**: Helps ensure all required properties are included for each event type, improving the quality of telemetry data.

### Practical Benefits:

```typescript
// Without strong typing
telemetryService.sendTelemetryEvent("myextension/feature-used", 
  { featurName: "quickAction" }); // Typo in property name! "featurName" instead of "featureName"

// With strong typing
const event = new TelemetryEvent<MyCustomTelemetryEventNames, 'myextension/feature-used'>(
  'myextension/feature-used', 
  telemetryService
);
event.addOrUpdateProperties({ 
  featurName: "quickAction" // TypeScript error: Property 'featurName' does not exist...
});
```

## Getting Started

### Initialize the Service

```typescript
import { TelemetryService } from '@vscode-fabric/util';

const telemetryService = new TelemetryService({
  aiKey: 'your-application-insights-key',
  extensionMode: vscode.ExtensionMode.Production
});
```

## Usage Examples

### Basic Event

```typescript
// Send a simple telemetry event
telemetryService.sendTelemetryEvent('eventName', 
  { property1: 'value1' },  // properties
  { measure1: 100 }         // measurements
);
```

### Strongly-Typed Event

```typescript
// Create a strongly-typed telemetry event
const event = new TelemetryEvent('activation', telemetryService);
event.addOrUpdateProperties({ succeeded: 'true' });
event.sendTelemetry();
```

### Activity Tracking

```typescript
// Track an activity with duration
const activity = new TelemetryActivity('apiclient/send-request', telemetryService);
activity.start();
// ... perform work ...
activity.end();
activity.addOrUpdateProperties({ 
  endpoint: 'https://api.example.com',
});
activity.sendTelemetry();

// Or use the helper method
await activity.doTelemetryActivity(async () => {
  // ... perform work ...
  return result;
});
```

### Error Handling

```typescript
try {
  // ... code that might throw ...
} catch (error) {
  telemetryService.sendTelemetryErrorEvent(error, {
    context: 'operation-name'
  });
}
```

### Common Properties

```typescript
// Add or update default properties that will be included in all events
telemetryService.addOrUpdateDefaultProperty('environment', 'production');
telemetryService.addOrUpdateDefaultProperty('clientVersion', '1.2.3');
```

## Creating Custom Telemetry Event Definitions

You can create your own telemetry event name definitions to use with the strongly-typed telemetry classes:

```typescript
// Define your own telemetry event schema
export type MyCustomTelemetryEventNames = {
  'myextension/feature-used': { 
    properties: 'featureName' | 'context' | 'succeeded'; 
    measurements: 'durationMs' 
  },
  'myextension/config-changed': { 
    properties: 'configName' | 'oldValue' | 'newValue'; 
    measurements: never 
  },
  'myextension/long-running-task': { 
    properties: 'taskName' | 'succeeded' | 'error'; 
    measurements: 'startTimeInMilliseconds' | 'endTimeInMilliseconds' | 'activityDurationInMilliseconds' 
  }
};

// Combine with built-in telemetry events if needed
import { TelemetryEventNames } from '@vscode-fabric/util';

export type ExtendedTelemetryEventNames = TelemetryEventNames & MyCustomTelemetryEventNames;
```

### Using Custom Telemetry Events

```typescript
// Use your custom event definitions with the TelemetryEvent class
import { TelemetryEvent, TelemetryService } from '@vscode-fabric/util';
import { MyCustomTelemetryEventNames } from './MyCustomTelemetryEventNames';

// Create a service
const telemetryService = new TelemetryService({ 
  aiKey: 'your-application-insights-key', 
  extensionMode: vscode.ExtensionMode.Production 
});

// Create a typed event
const event = new TelemetryEvent<MyCustomTelemetryEventNames, 'myextension/feature-used'>(
  'myextension/feature-used',
  telemetryService
);

// TypeScript will provide intellisense for the valid properties
event.addOrUpdateProperties({ 
  featureName: 'quickAction',
  context: 'explorer',
  succeeded: 'true'
});

// TypeScript will provide intellisense for the valid measurements
event.addOrUpdateMeasurements({
  durationMs: 250
});

event.sendTelemetry();
```

### Activity Tracking with Custom Events

```typescript
import { TelemetryActivity, TelemetryService } from '@vscode-fabric/util';
import { MyCustomTelemetryEventNames } from './MyCustomTelemetryEventNames';

// Create a typed activity
const activity = new TelemetryActivity<MyCustomTelemetryEventNames, 'myextension/long-running-task'>(
  'myextension/long-running-task',
  telemetryService
);

// Use the activity to track a long-running operation
activity.addOrUpdateProperties({ taskName: 'dataProcessing' });
activity.start();

// ... do the work ...

activity.end();
activity.addOrUpdateProperties({ succeeded: 'true' });
activity.sendTelemetry();

// Or use the helper method that automatically handles timing and errors
async function processData() {
  const activity = new TelemetryActivity<MyCustomTelemetryEventNames, 'myextension/long-running-task'>(
    'myextension/long-running-task',
    telemetryService
  );
  
  activity.addOrUpdateProperties({ taskName: 'dataProcessing' });
  
  return await activity.doTelemetryActivity(async () => {
    // ... do work ...
    return result;
  });
  // doTelemetryActivity automatically:
  // 1. Calls start() at the beginning
  // 2. Calls end() when finished
  // 3. Sets succeeded=true if successful, or succeeded=false + captures error details if it fails
  // 4. Sends the telemetry
  // 5. Re-throws any error
}
```

### Type Helpers for Custom Events

```typescript
import { EventsWithProperty, EventsWithMeasurement } from '@vscode-fabric/util';
import { MyCustomTelemetryEventNames } from './MyCustomTelemetryEventNames';

// Find all events that include the 'succeeded' property
type SucceededEvents = EventsWithProperty<MyCustomTelemetryEventNames, 'succeeded'>;
// Result: 'myextension/feature-used' | 'myextension/long-running-task'

// Find all events that track duration
type DurationEvents = EventsWithMeasurement<MyCustomTelemetryEventNames, 'durationMs'>;
// Result: 'myextension/feature-used'
```

## Best Practices

1. **Consistent naming**: Use TelemetryEventNames to ensure consistent property and measurement names.

2. **Meaningful properties**: Include enough context in properties to understand what happened.

3. **Performance measurements**: Use TelemetryActivity to track durations of important operations.

4. **Error context**: When reporting errors, include relevant context to help diagnose the issue.

5. **Privacy**: Avoid collecting personally identifiable information.
