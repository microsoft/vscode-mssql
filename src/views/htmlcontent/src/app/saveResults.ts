import { Component } from '@angular/core';

@Component({
  selector: 'save-button',
  template: `
    <button (click)="save()">Save</button>
    {{clickMessage}}`
})
export class Save {
  clickMessage = '' ;

  public save(): void {
    this.clickMessage = 'Saved results as csv';
  }
}
