/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
import { Pipe, PipeTransform } from '@angular/core';
import { Tab } from './../components/tab.component';

/**
 * Defines a custom pipe filter for filtering tabs that should not be shown via the show field.
 * See tabs.ts for usage.
 */

@Pipe({
    name: 'tabFilter',
    pure: false
})
export class TabFilter implements PipeTransform {
    /**
     * Defines the transform function called by angular.
     */
    transform(items: Tab[]): any {
        return items.filter(item => item.show);
    }
}
