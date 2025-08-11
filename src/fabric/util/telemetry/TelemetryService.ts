import TelemetryReporter from '@vscode/extension-telemetry';

// Need to accomodate multiple TelemetryService instances, one for each extension (core/sat), and to allow a single common properties object to be shared across all instances.
// So we need a way to allow the satellite extensions to get the (possibly updated) default properties in the core extension for every telemetry event
// The core extension will hold the default properties and will have updateDefaultPropertiesFunction == null. 
// Sat instances will have a copy of the core extension's, updated to be the same as the core's.
// Satellite extensions will have updateDefaultPropertiesFunction set to a function that returns the same properties from the core, so that those
// common properties are included in all telemetry events. updateDefaultPropertiesFunction will be called before every sat telemetry event is sent.
// updateDefaultPropertiesFunction function is provided by the FabricExtensionManager, via IFabricExtensionManager
// re: performance, it just assigns the object reference, so both the core and satellite extensions will be using the same object in memory.
// Testing: telem from both core and sat extensions, ismicrosoftinternal, tenantid, environment are sent, and updated when signing in with different accounts.

export class TelemetryService {
    // these are defaultProps that are common to all telemetry events, like environment, ismicrosoftinternal, tenantid, etc.
    // VSCode adds other event properties like vscodesessionid, extname, extversion, vscodemachineid, sqmid, devdeviceid, etc.
    public defaultProps: { [key: string]: string } = {};
    private updateDefaultPropertiesFunction: (() => { [key: string]: string }) | undefined;

    constructor(
        private readonly telemetryReporter: TelemetryReporter,
        options?: {
            extensionMode?: number, // only set this from core extension
            updateDefaultPropertiesFunction?: () => { [key: string]: string } // only set this from non-core extensions
        },
    ) {
        this.updateDefaultPropertiesFunction = options?.updateDefaultPropertiesFunction;
        if (options?.extensionMode) { // if we're not in satellite extension
            this.addOrUpdateDefaultProperty('extensionMode', options.extensionMode.toString());
        }
    }

    /*
     * Returns the currently configured VS Code telemetry level.
     */
    getTelemetryLevel(): string | undefined {
        return this.telemetryReporter?.telemetryLevel;
    }

    /**
     * Sends a telemetry event with the given properties and measurements
     * @param eventName The telemetry event name.
     * @param properties The list of properties and its respective value
     * @param measurements The list of measurements and its respective value
     */
    sendTelemetryEvent(eventName: string, properties?: { [key: string]: string }, measurements?: { [key: string]: number }) {
        if (this.updateDefaultPropertiesFunction) {
            this.defaultProps = this.updateDefaultPropertiesFunction();
        }
        this.telemetryReporter?.sendTelemetryEvent(eventName, { ...properties, ...this.defaultProps }, measurements);
    }

    /**
     * Sends a telemetry error event with the given properties, measurements.
     * @param error The Error object
     * @param properties The list of properties and its respective value.
     * @param measurements The list of measurements and its respective value
     */
    sendTelemetryErrorEvent(error: any, properties?: { [key: string]: string }, measurements?: { [key: string]: number }) {
        // can't process the error if we don't have one
        if (error === undefined || error === null || error === '') {
            return;
        }

        // standardize the error name to not create new gdpr classifications for every new error name
        // capture the errorname in the properties bag
        let eventName = 'extension/error';
        let concatProperties: { [key: string]: string } = properties ?? {};

        if (error instanceof Error) {
            concatProperties['exceptiontype'] = error.name ?? '';
            concatProperties['exceptionStack'] = error.stack ?? '';
        }
        else if (typeof error === 'string') {
            concatProperties['errormessage'] = error;
        }
        else {
            concatProperties['errormessage'] = error.toString();
        }
        if (this.updateDefaultPropertiesFunction) {
            this.defaultProps = this.updateDefaultPropertiesFunction();
        }

        this.telemetryReporter?.sendTelemetryErrorEvent(eventName, { ...concatProperties, ...this.defaultProps }, measurements);
    }

    /**
     * Sends an exception which includes the error stack, properties, and measurements
     * @deprecated Use sendTelemetryErrorEvent instead
     * @param error The telemetry event name.
     * @param properties The list of properties and its respective value
     * @param measurements The list of measurements and its respective value
     */
    sendTelemetryException(error: Error, properties?: { [key: string]: string }, measurements?: { [key: string]: number }) {
        this.sendTelemetryErrorEvent(error, properties, measurements);
    }

    public addOrUpdateDefaultProperty(key: string, val: string | undefined): void {
        if (this.updateDefaultPropertiesFunction) { // we're being called from a satellite extension
            throw new Error('Cannot update default properties in a satellite extension');
        }
        const commonKey = `common.${key}`;

        /* eslint-disable security/detect-object-injection */
        if (val === undefined) {
            // Remove the common prefixed key if it exists directly
            if (this.defaultProps[commonKey] !== undefined) {
                delete this.defaultProps[commonKey];
            }
        }
        else {
            // Using object spread operator to create a new object with all existing properties
            // If the property already exists in defaultProps, it will be overwritten by the new value
            // due to the order of spreading (right-most value wins for duplicate keys)
            this.defaultProps = { ...this.defaultProps, ...{ [commonKey]: val } };
        }
        /* eslint-enable security/detect-object-injection */
    }

    public async dispose(): Promise<void> {
        if (this.telemetryReporter !== undefined) {
            return await this.telemetryReporter.dispose();
        }
    }
}