/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { InputBoxOptions, QuickPickOptions } from "vscode";

// A class that simplifies populating values on an object from the VSCode command palette.
// Provides a wrapper around the necessary options to display, a callback to see if update
// is needed, and the setter to be called on the object
export class PropertyUpdater<T> {
  constructor(
    public inputBoxOptions: InputBoxOptions,
    public quickPickOptions: QuickPickOptions,
    private propertyChecker: (obj: T) => boolean,
    private propertySetter: (obj: T, input: string) => void,
  ) {}

  public static createQuickPickUpdater<T>(
    quickPickOptions: QuickPickOptions,
    propertyChecker: (obj: T) => boolean,
    propertySetter: (obj: T, input: string) => void,
  ): PropertyUpdater<T> {
    return new PropertyUpdater<T>(
      undefined,
      quickPickOptions,
      propertyChecker,
      propertySetter,
    );
  }

  public static createInputBoxUpdater<T>(
    inputBoxOptions: InputBoxOptions,
    propertyChecker: (obj: T) => boolean,
    propertySetter: (obj: T, input: string) => void,
  ): PropertyUpdater<T> {
    return new PropertyUpdater<T>(
      inputBoxOptions,
      undefined,
      propertyChecker,
      propertySetter,
    );
  }

  public isQuickPickUpdater(): boolean {
    if (this.quickPickOptions) {
      return true;
    }
    return false;
  }

  public isUpdateRequired(parentObject: T): boolean {
    return this.propertyChecker(parentObject);
  }

  public updatePropery(parentObject: T, propertyValue: string): void {
    this.propertySetter(parentObject, propertyValue);
  }
}
