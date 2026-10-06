import { HttpClient } from '@angular/common/http'
import { Injectable, inject } from '@angular/core'
import { Observable, catchError, of } from 'rxjs'
import type { OfflineEvidence, TailingsDataset } from '../domain'
import { seedDataset } from '../data/seed'

interface TailingsGlobal {
  __TAILINGS_API__?: string
  /** 演示用：模拟山谷现场断链，置 true 后下一次证据上传失败，随后自动复位 */
  __forceNextUploadFail__?: boolean
}

@Injectable({ providedIn: 'root' })
export class TailingsApiService {
  private readonly http = inject(HttpClient)
  private readonly globals = globalThis as TailingsGlobal
  private readonly baseUrl = this.globals.__TAILINGS_API__ ?? '/api'
  lastFailReason = ''

  loadDataset(): Observable<TailingsDataset> {
    return this.http.get<TailingsDataset>(`${this.baseUrl}/tailings/snapshot`).pipe(catchError(() => of(structuredClone(seedDataset))))
  }

  exportPackage(payload: TailingsDataset): Observable<Blob> {
    return this.http.post(`${this.baseUrl}/tailings/export`, payload, { responseType: 'blob' }).pipe(catchError(() => of(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }))))
  }

  /**
   * 现场证据上传（无真实后端时本地模拟）。
   * 不稳定卫星链路会随机失败；__forceNextUploadFail__ 用于确定性演示“上传失败后恢复重试”。
   */
  uploadEvidence(batchId: string, evidence: OfflineEvidence): Observable<boolean> {
    const forced = this.globals.__forceNextUploadFail__ === true
    if (forced) this.globals.__forceNextUploadFail__ = false
    const flaky = !forced && evidence.attempts === 0 && Math.random() < 0.25
    if (forced || flaky) {
      this.lastFailReason = forced ? '现场链路中断（模拟）' : '卫星链路抖动丢包'
      return of(false)
    }
    this.lastFailReason = ''
    return this.http.post<boolean>(`${this.baseUrl}/tailings/batches/${batchId}/evidence`, { evidenceId: evidence.id }).pipe(
      catchError(() => of(true))
    )
  }
}
