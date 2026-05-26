import { importProvidersFrom } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { LucideAngularModule, icons } from 'lucide-angular';

import { GamecardComponent } from './gamecard.component';

describe('GamecardComponent', () => {
  let component: GamecardComponent;
  let fixture: ComponentFixture<GamecardComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [GamecardComponent],
      providers: [importProvidersFrom(LucideAngularModule.pick(icons))],
    })
    .compileComponents();

    fixture = TestBed.createComponent(GamecardComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
