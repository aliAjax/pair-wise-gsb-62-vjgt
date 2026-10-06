import { CommonModule } from '@angular/common'
import { Component, OnInit, inject } from '@angular/core'
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router'
import { MatButtonModule } from '@angular/material/button'
import { MatIconModule } from '@angular/material/icon'
import { MatSidenavModule } from '@angular/material/sidenav'
import { MatToolbarModule } from '@angular/material/toolbar'
import { Store } from '@ngrx/store'
import { TailingsActions } from './store/tailings.actions'
import { readPersistedDataset } from './store/tailings.reducer'
import { batchHasPendingEvidence } from './domain'

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, RouterOutlet, RouterLink, RouterLinkActive, MatSidenavModule, MatToolbarModule, MatButtonModule, MatIconModule],
  template: `
    <mat-sidenav-container class="app-shell">
      <mat-sidenav mode="side" opened class="side-nav">
        <div class="brand"><strong>尾</strong><div><b>尾矿库安全审阅台</b><span>监测、异常与应急联动</span></div></div>
        <nav>
          <a routerLink="/" routerLinkActive="active" [routerLinkActiveOptions]="{ exact: true }"><span>监测总览</span><small>地图与阈值版本</small></a>
          <a routerLink="/monitoring" routerLinkActive="active"><span>测点与读数</span><small>原始数据只读</small></a>
          <a routerLink="/offline" routerLinkActive="active"><span>离线巡检批次</span><small>断网复测·对账恢复</small></a>
          <a routerLink="/anomalies" routerLinkActive="active"><span>异常处置</span><small>阈值重算与会签</small></a>
          <a routerLink="/audit" routerLinkActive="active"><span>审计追溯</span><small>幂等重放留痕</small></a>
        </nav>
        <div class="side-state"><span>原始读数保护</span><b>只读且不可覆盖</b><small>离线复测独立版本化，冲突双值待核对</small></div>
      </mat-sidenav>
      <mat-sidenav-content>
        <mat-toolbar class="topbar">
          <div><span>矿山安全运营中心 / 尾矿库</span><h1>监测计划与异常处置审阅</h1></div>
          <div class="tools">
            <span class="net" [class.offline]="!(online$ | async)"><i></i>{{ (online$ | async) ? '中心在线' : '山谷断网' }}</span>
            <button mat-button (click)="reset()">恢复演示数据</button>
          </div>
        </mat-toolbar>
        <main><router-outlet /></main>
      </mat-sidenav-content>
    </mat-sidenav-container>
  `,
  styles: [`
    .app-shell { height: 100vh; background: #edf1f0; }
    .side-nav { width: 238px; border-radius: 0; background: #213a44; color: white; padding: 22px 16px; }
    .brand { display: flex; align-items: center; gap: 10px; padding-bottom: 22px; border-bottom: 1px solid #405b64; }
    .brand strong { width: 40px; height: 40px; display: grid; place-items: center; border-radius: 4px; background: #d2a53f; color: #213a44; font-size: 19px; }
    .brand b, .brand span { display: block; } .brand b { font-size: 14px; } .brand span { color: #a1b6bd; font-size: 10px; margin-top: 4px; }
    nav { display: grid; gap: 6px; padding-top: 18px; }
    nav a { color: #a9bbc1; padding: 11px 12px; display: grid; gap: 3px; border-radius: 4px; text-decoration: none; }
    nav a.active { background: #304e59; color: white; border-left: 3px solid #d2a53f; }
    nav small { color: #7f9ba3; font-size: 10px; }
    .side-state { margin-top: 30px; padding: 14px; background: #1a3039; display: grid; gap: 5px; }
    .side-state span, .side-state small { color: #87a2aa; font-size: 10px; } .side-state b { font-size: 12px; }
    .topbar { height: 78px; background: white; border-bottom: 1px solid #d9e1df; display: flex; justify-content: space-between; padding: 0 28px; }
    .topbar span { display: block; color: #74827f; font-size: 10px; } .topbar h1 { margin: 3px 0 0; font-size: 19px; }
    .tools { display: flex; align-items: center; gap: 12px; }
    .net { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; color: #2e765a; }
    .net i { width: 8px; height: 8px; border-radius: 50%; background: #3e8a6b; }
    .net.offline { color: #a43c35; } .net.offline i { background: #b84038; }
    main { min-height: calc(100vh - 78px); }
    :host ::ng-deep .mat-drawer-inner-container { overflow: hidden; }
  `]
})
export class AppComponent implements OnInit {
  private readonly store = inject(Store)
  readonly online$ = this.store.select((state: { tailings: { online: boolean } }) => state.tailings.online)

  ngOnInit(): void {
    // 可恢复提交：刷新/崩溃后先从本地恢复，再续传证据未完成的批次
    const persisted = readPersistedDataset()
    if (persisted) {
      this.store.dispatch(TailingsActions.hydrateFromStorage({ dataset: persisted }))
      const hasPending = persisted.offlineBatches.some((batch) => batch.status === '证据上传中' && batchHasPendingEvidence(batch))
      if (hasPending) this.store.dispatch(TailingsActions.resumePendingBatches())
    } else {
      this.store.dispatch(TailingsActions.loadDataset())
    }
  }

  reset(): void {
    this.store.dispatch(TailingsActions.resetDemo())
  }
}
