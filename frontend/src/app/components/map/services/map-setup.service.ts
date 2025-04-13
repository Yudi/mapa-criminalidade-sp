import { inject, Injectable } from '@angular/core';
import TileLayer from 'ol/layer/Tile';
import VectorLayer from 'ol/layer/Vector';
import Map from 'ol/Map';
import Overlay from 'ol/Overlay';
import { fromLonLat } from 'ol/proj';
import { OSM } from 'ol/source';
import View from 'ol/View';
import { QueriesService } from '../../../shared/queries.service';
import { take, tap } from 'rxjs';

@Injectable({
  providedIn: 'root',
})
export class MapSetupService {
  private queriesService = inject(QueriesService);
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
          this.queriesService
            .getBoletimById(feature.get('id'))
            .pipe(
              take(1),
              tap((boletim) => {
                if (boletim) {
                  popup.innerHTML = `
                  <div class="popup-content">
                  <h3>${boletim.natureza_apurada}</h3>
                  <p><strong>Endereço:</strong> ${boletim.logradouro}, ${boletim.numero_logradouro}, ${boletim.bairro}, ${boletim.cidade}</p>
                  <p><strong>Local:</strong> ${boletim.descr_subtipolocal}</p>
                  <p><strong>Conduta:</strong> ${boletim.descr_conduta}</p>
                  <p><strong>Data ocorrência:</strong> ${boletim.data_ocorrencia_bo} ${boletim.hora_ocorrencia_bo}</p>
                  <p><strong>Data registro:</strong> ${boletim.data_registro}</p>
                  </div>
                  `;
                }
                popup.hidden = false;
              }),
            )
            .subscribe();

          popupOverlay.setPosition(event.coordinate);
        },
        { hitTolerance: 2 },
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
