import { ApplicationConfig, provideZoneChangeDetection } from '@angular/core'
import { provideRouter } from '@angular/router'
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async'
import { provideHttpClient } from '@angular/common/http'
import { provideEffects } from '@ngrx/effects'
import { provideStore } from '@ngrx/store'
import { appRoutes } from './app.routes'
import { persistenceMetaReducer, tailingsReducer } from './store/tailings.reducer'
import { TailingsEffects } from './store/tailings.effects'

export const appConfig: ApplicationConfig = {
  providers: [
    provideZoneChangeDetection({ eventCoalescing: true }),
    provideRouter(appRoutes),
    provideAnimationsAsync(),
    provideHttpClient(),
    provideStore({ tailings: tailingsReducer }, { metaReducers: [persistenceMetaReducer] }),
    provideEffects(TailingsEffects)
  ]
}
