import { AfterViewInit, Component, ElementRef, Input, OnChanges, SimpleChanges, ViewChild } from '@angular/core'
import * as turf from '@turf/turf'
import maplibregl, { LngLatLike, Map, Marker } from 'maplibre-gl'
import type { MonitoringPoint } from '../domain'

@Component({
  selector: 'app-spatial-map',
  standalone: true,
  template: `
    <div class="map-panel">
      <div class="map-head"><div><b>测点分布与巡检路线</b><span>路线长度 {{ routeLength.toFixed(1) }} km · 地图可缩放</span></div><span class="legend"><i class="normal"></i>正常 <i class="warning"></i>预警 <i class="danger"></i>异常</span></div>
      <div #mapContainer class="map"></div>
    </div>
  `,
  styles: [`
    .map-panel { background: white; border: 1px solid #d9e1df; }
    .map-head { display: flex; justify-content: space-between; padding: 12px 14px; border-bottom: 1px solid #e2e7e6; }
    .map-head b, .map-head span { display: block; } .map-head span { color: #74827f; font-size: 10px; margin-top: 3px; }
    .legend { display: flex !important; align-items: center; gap: 6px; margin: 0 !important; }
    .legend i { width: 8px; height: 8px; border-radius: 50%; display: inline-block; } .normal { background: #3e8a6b; } .warning { background: #c28d27; } .danger { background: #b84038; }
    .map { height: 420px; }
  `]
})
export class SpatialMapComponent implements AfterViewInit, OnChanges {
  @Input({ required: true }) points: MonitoringPoint[] = []
  @ViewChild('mapContainer', { static: true }) mapContainer!: ElementRef<HTMLDivElement>
  routeLength = 0
  private map?: Map

  ngAfterViewInit(): void {
    this.map = new maplibregl.Map({
      container: this.mapContainer.nativeElement,
      style: {
        version: 8,
        sources: {},
        layers: [{ id: 'background', type: 'background', paint: { 'background-color': '#dfe8e5' } }]
      },
      center: [112.843, 40.116] as LngLatLike,
      zoom: 11.5,
      attributionControl: false
    })
    this.map.on('load', () => this.renderPoints())
  }

  ngOnChanges(_changes: SimpleChanges): void { this.renderPoints() }

  private renderPoints(): void {
    if (!this.map) return
    document.querySelectorAll('.point-marker').forEach((element) => element.remove())
    this.points.forEach((point) => {
      const color = point.status === '异常' ? '#b84038' : point.status === '预警' ? '#c28d27' : '#3e8a6b'
      const element = document.createElement('div')
      element.className = 'point-marker'
      element.style.cssText = `width:16px;height:16px;border-radius:50%;background:${color};border:3px solid white;box-shadow:0 1px 5px rgba(0,0,0,.35)`
      new Marker({ element }).setLngLat([point.longitude, point.latitude]).setPopup(new maplibregl.Popup({ offset: 12 }).setHTML(`<strong>${point.name}</strong><br>${point.currentValue} ${point.unit} · ${point.status}`)).addTo(this.map!)
    })
    if (this.points.length > 1) {
      const line = turf.lineString(this.points.map((point) => [point.longitude, point.latitude]))
      this.routeLength = turf.length(line, { units: 'kilometers' })
      const sourceId = 'inspection-route'
      const data = { type: 'Feature' as const, properties: {}, geometry: line.geometry }
      if (this.map.getSource(sourceId)) (this.map.getSource(sourceId) as maplibregl.GeoJSONSource).setData(data)
      else {
        this.map.addSource(sourceId, { type: 'geojson', data })
        this.map.addLayer({ id: 'inspection-route-line', type: 'line', source: sourceId, paint: { 'line-color': '#315d6e', 'line-width': 2, 'line-dasharray': [2, 2] } })
      }
    }
  }
}
