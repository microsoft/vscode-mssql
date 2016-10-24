/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
import { NgModule }      from '@angular/core';
import { BrowserModule } from '@angular/platform-browser';
import { FormsModule }   from '@angular/forms';
import { HttpModule, JsonpModule } from '@angular/http';

import { SlickGrid } from './slickgrid/SlickGrid';

import { AppComponent }  from './components/app.component';
import { ScrollDirective } from './directives/scroll.directive';
import { MouseDownDirective } from './directives/mousedown.directive';

/**
 * Top level angular module, no actual content here
 */

@NgModule({
  imports: [
              BrowserModule,
              HttpModule,
              JsonpModule,
              FormsModule
           ],
  declarations: [ AppComponent, SlickGrid, ScrollDirective, MouseDownDirective],
  bootstrap:    [ AppComponent ]
})
export class AppModule { }
