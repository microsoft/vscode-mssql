import { Component, Input, OnChanges, AfterViewInit, ContentChild } from '@angular/core';
import { SlickGrid } from './slickgrid/SlickGrid';

@Component({
  selector: 'tab',
  styles: [`
    .pane{
      padding: 1em;
    }
  `],
  template: `
    <div *ngIf="active" class="boxRow content box">
      <ng-content></ng-content>
    </div>
  `
})
export class Tab implements OnChanges, AfterViewInit {
  @Input('tabTitle') title: string;
  @Input() active = false;
  @ContentChild(SlickGrid) slickgrid: SlickGrid;

  ngOnChanges(changes): void {
    if (this.slickgrid) {
      this.slickgrid.onResize();
    }
  }

  ngAfterViewInit(): void {
    console.log('view init');
  }
}
