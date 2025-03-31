/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { NgModule, ValueProvider } from "@angular/core";
import { BrowserModule } from "@angular/platform-browser";
import { FormsModule } from "@angular/forms";

import { SlickGrid } from "angular2-slickgrid";

import { AppComponent } from "./components/app.component";
import { ScrollDirective } from "./directives/scroll.directive";
import { MouseDownDirective } from "./directives/mousedown.directive";
import { ContextMenu } from "./components/contextmenu.component";
import { MessagesContextMenu } from "./components/messagescontextmenu.component";

/**
 * Top level angular module, no actual content here
 */
const WINDOW_PROVIDER: ValueProvider = {
    provide: Window,
    useValue: window,
};

@NgModule({
    imports: [BrowserModule, FormsModule],
    providers: [WINDOW_PROVIDER],
    declarations: [
        AppComponent,
        SlickGrid,
        ScrollDirective,
        MouseDownDirective,
        ContextMenu,
        MessagesContextMenu,
    ],
    bootstrap: [AppComponent],
})
export class AppModule {}
