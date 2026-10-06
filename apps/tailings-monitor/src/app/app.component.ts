import { CommonModule } from '@angular/common'
import { Component, OnInit, inject } from '@angular/core'
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router'
import { MatButtonModule } from '@angular/material/button'
import { MatIconModule } from '@angular/material/icon'
import { MatSidenavModule } from '@angular/material/sidenav'
import { MatToolbarModule } from '@angular/material/toolbar'
import { Store } from '@ngrx/store'
import { TailingsActions } from './store/tailings.actions'

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, RouterOutlet, RouterLink, RouterLinkActive, MatSidenavModule, MatToolbarModule, MatButtonModule, MatIconModule],
  template: `
    <mat-sidenav-container class="app-shell">
      <mat-sidenav mode="side" opened class="side-nav">
        <div class="brand"><strong>尾</strong><div><b>尾矿库安全审阅台</b><span>监测、异常与应急联动</span></div></div>
        <nav>
          <a routerLink="/" routerLinkActive="active" [routerLinkActiveOptions]="{ exact: true }"><span>监测总览</span><small>地图与阈值</small></a>
          <a routerLink="/monitoring" routerLinkActive="active"><span>测点与读数</span><small>原始数据</small></a>
          <a routerLink="/offline" routerLinkActive="active"><span>离线巡检对账</span><small>可恢复提交</small></a>
          <a routerLink="/anomalies" routerLinkActive="active"><span>异常处置</span><small>复核与会签</small></a>
          <a routerLink="/audit" routerLinkActive="active"><span>审计追溯</span><small>历史版本</small></a>
        </nav>
        <div class="side-state"><span>对账原则</span><b>中心正式读数不覆盖</b><small>两端同改保留双方值待核对</small></div>
      </mat-sidenav>
      <mat-sidenav-content>
        <mat-toolbar class="topbar"><div><span>矿山安全运营中心 / 尾矿库</span><h1>监测计划与异常处置审阅</h1></div><button mat-button (click)="reset()">恢复演示数据</button></mat-toolbar>
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
    .side-state { margin-top: 40px; padding: 14px; background: #1a3039; display: grid; gap: 5px; }
    .side-state span, .side-state small { color: #87a2aa; font-size: 10px; } .side-state b { font-size: 12px; }
    .topbar { height: 78px; background: white; border-bottom: 1px solid #d9e1df; display: flex; justify-content: space-between; padding: 0 28px; }
    .topbar span { display: block; color: #74827f; font-size: 10px; } .topbar h1 { margin: 3px 0 0; font-size: 19px; }
    main { min-height: calc(100vh - 78px); }
    :host ::ng-deep .mat-drawer-inner-container { overflow: hidden; }
  `]
})
export class AppComponent implements OnInit {
  private readonly store = inject(Store)
  ngOnInit(): void { this.store.dispatch(TailingsActions.loadDataset()) }
  reset(): void { this.store.dispatch(TailingsActions.resetDemo()) }
}
