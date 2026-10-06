import '@angular/compiler'
import assert from 'node:assert/strict'
import { createEnvironmentInjector, type EnvironmentInjector } from '@angular/core'
import { Store, provideStore } from '@ngrx/store'
import { TailingsActions } from '../../apps/tailings-monitor/src/app/store/tailings.actions'
import { persistenceMetaReducer, STORAGE_KEY, tailingsReducer, type TailingsState } from '../../apps/tailings-monitor/src/app/store/tailings.reducer'
import type { TailingsDataset } from '../../apps/tailings-monitor/src/app/domain'

// 极简 localStorage polyfill，验证可恢复持久化
const storage = new Map<string, string>()
;(globalThis as { localStorage: Storage }).localStorage = {
  get length() { return storage.size },
  clear: () => storage.clear(),
  getItem: (key: string) => storage.get(key) ?? null,
  key: (index: number) => [...storage.keys()][index] ?? null,
  removeItem: (key: string) => { storage.delete(key) },
  setItem: (key: string, value: string) => { storage.set(key, value) }
}

let passed = 0
const check = (name: string, fn: () => void): void => { fn(); passed++; console.log(`  ✓ ${name}`) }

console.log('Store 级可恢复提交')
const injector: EnvironmentInjector = createEnvironmentInjector([
  provideStore({ tailings: tailingsReducer }, { metaReducers: [persistenceMetaReducer] })
])
const store = injector.get(Store) as Store<{ tailings: TailingsState }>

const snapshot = (): TailingsState => {
  let value!: TailingsState
  store.select((state) => state.tailings).subscribe((v) => { value = v }).unsubscribe()
  return value
}

store.dispatch(TailingsActions.setOnline({ online: false }))
store.dispatch(TailingsActions.createOfflineBatch({ inspector: '高原', zone: '北沟' }))
const batchId = snapshot().dataset.offlineBatches[0].id

check('断网批次与复测、证据写入并持久化到本地', () => {
  store.dispatch(TailingsActions.addRemeasureDraft({ batchId, draft: { pointId: 'P-D01', baseReadingId: 'RD-1', value: 19.2, note: '复测' } }))
  store.dispatch(TailingsActions.addEvidenceDraft({ batchId, draft: { kind: '照片', name: 'd01.jpg', note: '' } }))
  const state = snapshot()
  assert.equal(state.dataset.offlineBatches[0].remeasures.length, 1)
  assert.equal(state.dataset.offlineBatches[0].evidence[0].uploadState, '待上传')
  assert.ok(storage.has(STORAGE_KEY))
  const saved = JSON.parse(storage.get(STORAGE_KEY)!) as TailingsDataset
  assert.equal(saved.offlineBatches[0].id, batchId)
})

check('断网时提交不会推进，证据保留待恢复', () => {
  store.dispatch(TailingsActions.submitBatchWhenOnline({ batchId }))
  assert.equal(snapshot().dataset.offlineBatches[0].status, '离线编辑中')
})

check('网络恢复后：模拟一次失败再成功，最终对账完成', () => {
  store.dispatch(TailingsActions.setOnline({ online: true }))
  store.dispatch(TailingsActions.submitBatchWhenOnline({ batchId }))
  assert.equal(snapshot().dataset.offlineBatches[0].status, '证据上传中')
  const evidenceId = snapshot().dataset.offlineBatches[0].evidence[0].id
  store.dispatch(TailingsActions.evidenceUploadAttempt({ batchId, evidenceId, success: false, failReason: '链路中断' }))
  assert.equal(snapshot().dataset.offlineBatches[0].evidence[0].uploadState, '上传失败')
  store.dispatch(TailingsActions.evidenceUploadAttempt({ batchId, evidenceId, success: true, failReason: '' }))
  store.dispatch(TailingsActions.finishBatchReconcile({ batchId }))
  const state = snapshot()
  assert.equal(state.dataset.offlineBatches[0].status, '已对账')
  assert.equal(state.dataset.offlineBatches[0].evidence[0].uploadState, '已上传')
  assert.equal(state.dataset.offlineBatches[0].evidence[0].attempts, 2)
})

check('重复 finish/retry 重放不新增审计（幂等）', () => {
  const before = snapshot().dataset.audit.length
  store.dispatch(TailingsActions.finishBatchReconcile({ batchId }))
  store.dispatch(TailingsActions.finishBatchReconcile({ batchId }))
  assert.equal(snapshot().dataset.audit.length, before)
})

check('从本地恢复出同一批次、阈值版本与对账状态', () => {
  const saved = JSON.parse(storage.get(STORAGE_KEY)!) as TailingsDataset
  assert.equal(saved.offlineBatches[0].status, '已对账')
  assert.deepEqual(
    saved.offlineBatches[0].report?.thresholdVersions.map((s) => `${s.thresholdId}V${s.version}`),
    ['T-DV4', 'T-WV3', 'T-SV5', 'T-RV2']
  )
})

check('恢复演示数据清除本地持久化', () => {
  store.dispatch(TailingsActions.resetDemo())
  assert.equal(storage.has(STORAGE_KEY), false)
  assert.equal(snapshot().dataset.offlineBatches.length, 0)
})

console.log(`\nStore 级 ${passed} 项断言通过`)
