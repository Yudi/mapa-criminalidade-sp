import { AfterViewInit, Component, OnDestroy, inject } from '@angular/core';
import Map from 'ol/Map';
import View from 'ol/View';
import TileLayer from 'ol/layer/Tile';
import OSM from 'ol/source/OSM';
import { useGeographic } from 'ol/proj';

import Feature from 'ol/Feature';
import { Point } from 'ol/geom';
import { fromLonLat } from 'ol/proj';
import { HttpClient } from '@angular/common/http';
import VectorSource from 'ol/source/Vector';
import VectorLayer from 'ol/layer/Vector';
import Style from 'ol/style/Style';
import Icon from 'ol/style/Icon';
import { take } from 'rxjs';
@Component({
  selector: 'app-map',
  imports: [],
  templateUrl: './map.component.html',
  styleUrl: './map.component.scss',
})
export class MapComponent implements AfterViewInit, OnDestroy {
  map: Map | undefined | null;

  vectorSource: VectorSource | undefined;
  vectorLayer: VectorLayer | undefined;

  private http = inject(HttpClient);
  addressLookup() {
    let address = 'Rua+Augusta';

    const response = this.http.get(
      `https://nominatim.openstreetmap.org/search?format=json&q=${address},S%C3%A3o+Paulo,Brazil`,
    );

    response.pipe(take(1)).subscribe((data: any) => {
      if (!data || data.length === 0 || !data[0].lat || !data[0].lon) {
        return;
      }

      const lat = parseFloat(data[0].lat);
      const lon = parseFloat(data[0].lon);

      this.updateCenter(lat, lon);
    });
  }

  updateCenter(lat: number, lon: number) {
    const coordinates = fromLonLat([lon, lat]);
    const feature = new Feature(new Point(coordinates));
    this.map?.getView().setCenter(coordinates);
  }

  ngAfterViewInit() {
    useGeographic();
    const rasterLayer = new TileLayer({
      source: new OSM(),
    });

    setTimeout(() => {
      this.map = new Map({
        view: new View({
          center: [-46.63394714, -23.5503953],
          zoom: 17,
          maxZoom: 19,
          projection: 'EPSG:3857',
        }),
        layers: [rasterLayer],
        target: 'ol-map-tab',
      });

      this.vectorSource = new VectorSource();

      this.vectorLayer = new VectorLayer({
        source: this.vectorSource,
        style: new Style({
          image: new Icon({
            src: 'https://cdn.jsdelivr.net/gh/pointhi/leaflet-color-markers@master/img/marker-icon-2x-blue.png',
            anchor: [0.5, 1],
          }),
        }),
      });
    }, 500);
  }

  ngOnDestroy() {
    // Remove map on leave if it exists
    if (this.map) {
      this.map.setTarget(undefined);
      this.map = null;
    }
  }
}
