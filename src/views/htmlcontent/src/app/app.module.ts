/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
import { NgModule }      from '@angular/core';
import { BrowserModule } from '@angular/platform-browser';
import { FormsModule }   from '@angular/forms';

import { AppComponent }  from './app.component';
import { SlickGrid } from './slickgrid/SlickGrid';
import { NavigatorComponent } from './navigation.component';
import { HttpModule, JsonpModule } from '@angular/http';
import { Tab } from './tab';
import { Tabs } from './tabs';

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
  declarations: [ AppComponent, SlickGrid, NavigatorComponent, Tab, Tabs ],
  bootstrap:    [ AppComponent ]
})
export class AppModule { }
