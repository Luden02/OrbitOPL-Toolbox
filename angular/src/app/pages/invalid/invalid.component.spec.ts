import { importProvidersFrom } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { LucideAngularModule, icons } from 'lucide-angular';

import { InvalidComponent } from './invalid.component';

describe('InvalidComponent', () => {
  let component: InvalidComponent;
  let fixture: ComponentFixture<InvalidComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [InvalidComponent],
      providers: [importProvidersFrom(LucideAngularModule.pick(icons))],
    })
    .compileComponents();

    fixture = TestBed.createComponent(InvalidComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
