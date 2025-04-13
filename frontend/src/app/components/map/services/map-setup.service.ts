import { Injectable } from '@angular/core';
import TileLayer from 'ol/layer/Tile';
import VectorLayer from 'ol/layer/Vector';
import Map from 'ol/Map';
import Overlay from 'ol/Overlay';
import { fromLonLat } from 'ol/proj';
import { OSM } from 'ol/source';
import View from 'ol/View';

@Injectable({
  providedIn: 'root',
})
export class MapSetupService {
  setupMap(
    map: Map | undefined | null,
    vectorLayer: VectorLayer,
    document: Document,
  ) {
    // Marco Zero, Praça da Sé, São Paulo
    const defaultCoordinates = [-46.63394714, -23.5503953];

    const rasterLayer = new TileLayer({
      source: new OSM(),
    });

    const popup = document.getElementById('popup');

    if (!popup) {
      return;
    }

    map = new Map({
      view: new View({
        center: fromLonLat(defaultCoordinates),
        zoom: 16,
        maxZoom: 19,
        projection: 'EPSG:3857',
      }),
      layers: [rasterLayer, vectorLayer!],
      target: 'ol-map-tab',
    });

    const popupOverlay = new Overlay({
      element: popup || undefined,
      autoPan: true,
    });

    map.addOverlay(popupOverlay);

    map.on('singleclick', (event) => {
      map?.forEachFeatureAtPixel(
        event.pixel,
        (feature) => {
          popup.innerHTML = `<span>${feature.get('name')}</span><br>${feature.get('description') || ''}`;
          popup.hidden = false;

          feature.get('maps')
            ? `<br><a href="https://goo.gl/maps/${feature.get('maps')}" target="_blank">Mais informações</a>`
            : '';

          popupOverlay.setPosition(event.coordinate);
        },
        { hitTolerance: 6 },
      );
    });

    map.on('movestart', () => {
      popup.hidden = true;
    });

    map.on('pointermove', (e) => {
      const pixel = map!.getEventPixel(e.originalEvent);
      const hit = map!.hasFeatureAtPixel(pixel);
      const target: any = map!.getTarget();
      const element = document.getElementById(target);

      if (element) {
        element.style.cursor = hit ? 'pointer' : '';
      }
    });

    return map;
  }
}
