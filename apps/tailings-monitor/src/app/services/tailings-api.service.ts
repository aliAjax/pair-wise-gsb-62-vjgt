import { HttpClient } from '@angular/common/http'
import { Injectable, inject } from '@angular/core'
import { Observable, catchError, of } from 'rxjs'
import type { TailingsDataset } from '../domain'
import { seedDataset } from '../data/seed'

export interface ExportEnvelope {
  exportedAt: string
  thresholdVersions: Record<string, unknown>
  batches: unknown[]
  points: unknown[]
  thresholds: unknown[]
  readings: unknown[]
  officialRevisions: unknown[]
  anomalies: unknown[]
  audit: unknown[]
}

@Injectable({ providedIn: 'root' })
export class TailingsApiService {
  private readonly http = inject(HttpClient)
  private readonly baseUrl = (globalThis as { __TAILINGS_API__?: string }).__TAILINGS_API__ ?? '/api'

  loadDataset(): Observable<TailingsDataset> {
    return this.http.get<TailingsDataset>(`${this.baseUrl}/tailings/snapshot`).pipe(catchError(() => of(structuredClone(seedDataset))))
  }

  exportPackage(payload: ExportEnvelope): Observable<Blob> {
    return this.http.post(`${this.baseUrl}/tailings/export`, payload, { responseType: 'blob' }).pipe(
      catchError(() => of(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })))
    )
  }
}
