/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
import { Pipe, PipeTransform } from '@angular/core';

@Pipe({
    name: 'nl2br',
    pure: true
})
export class Nl2BrPipe implements PipeTransform {

    private entityMap = {
        '&':  '&amp;',
        '<':  '&lt;',
        '>':  '&gt;',
        '"':  '&quot;',
        '\'': '&apos;',
        '/':  '&#x2F;',
        '`':  '&#x60;',
        '=':  '&@x3D'
    };
    private mapToEnity(key: string): string {
        return this.entityMap[key];
    }

    /**
     * Converts newlines (of all flavors) to br tags. It also performs a HTML escape as per
     * Mustache.js's escape HTML method such that this can be used for any InnerHtml bindings.
     */
    public transform(str: string): any {
        // Escape all HTML
        str = str.replace(/[&<>"'`=\/]/g, this.mapToEnity);

        // Replace all newlines with a br tag
        return str.replace(/([^>\r\n]?)(\r\n|\n\r|\r|\n)/g, '$1<br />$2');
    }
}
