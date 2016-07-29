'use string';
import { InputBoxOptions } from 'vscode';

// A class that simplifies populating values on an object from the VSCode command palette.
// Provides a wrapper around the necessary options to display, a callback to see if update
// is needed, and the setter to be called on the object
export class PropertyUpdater<T> {

    constructor(
        public options: InputBoxOptions,
        private propertyChecker: (obj: T) => boolean,
        private propertySetter: (obj: T, input: string) => void) {
    }

    public isUpdateRequired(parentObject: T): boolean {
        return this.propertyChecker(parentObject);
    }

    public updatePropery(parentObject: T, propertyValue: string): void {
        this.propertySetter(parentObject, propertyValue);
    }
}
