import { inject, Injectable, ViewChild, ViewContainerRef } from '@angular/core';
import TileLayer from 'ol/layer/Tile';
import VectorLayer from 'ol/layer/Vector';
import Map from 'ol/Map';
import Overlay from 'ol/Overlay';
import { fromLonLat } from 'ol/proj';
import { OSM } from 'ol/source';
import View from 'ol/View';
import { QueriesService } from '../../../shared/queries.service';
import { take, tap } from 'rxjs';
import { PopupComponent } from '../components/popup/popup.component';

@Injectable({
  providedIn: 'root',
})
export class MapSetupService {
  private queriesService = inject(QueriesService);

  setupMap(
    map: Map | undefined | null,
    vectorLayer: VectorLayer,
    document: Document,
    popupContainer: ViewContainerRef,
  ) {
    // Marco Zero, Praça da Sé, São Paulo
    const defaultCoordinates = [-46.63394714, -23.5503953];

    const rasterLayer = new TileLayer({
      source: new OSM(),
    });

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

    // Create and attach popup component
    const popupComponentRef = popupContainer.createComponent(PopupComponent);
    const popupElement = popupComponentRef.location
      .nativeElement as HTMLDivElement;
    popupElement.className = 'ol-popup';
    popupElement.style.display = 'none';

    const popupOverlay = new Overlay({
      element: popupElement,
      autoPan: true,
    });

    map.addOverlay(popupOverlay);
    popupComponentRef.instance.close.subscribe(() => {
      popupOverlay.setPosition(undefined);
    });

    map.on('singleclick', (event) => {
      map.forEachFeatureAtPixel(
        event.pixel,
        (feature) => {
          this.queriesService
            .getBoletimById(feature.get('id'))
            .pipe(take(1))
            .subscribe((boletim) => {
              console.debug('Boletim:', boletim);
              if (!boletim) {
                return;
              }
              popupComponentRef.instance.boletim = boletim;
              popupOverlay.setPosition(event.coordinate);
              console.log('Overlay Position:', event.coordinate);
              popupElement.style.display = 'block';
              popupComponentRef.changeDetectorRef.detectChanges();
            });
        },
        { hitTolerance: 2 },
      );
    });

    map.on('pointermove', (e) => {
      const pixel = map.getEventPixel(e.originalEvent);
      const hit = map.hasFeatureAtPixel(pixel);
      const element = document.getElementById(map.getTarget() as string);
      if (element) element.style.cursor = hit ? 'pointer' : '';
    });

    return map;
  }

  hidePopup() {
    const popupElement: HTMLDivElement | null =
      document.querySelector('.ol-popup');
    if (popupElement) {
      popupElement.style.display = 'none';
    }
  }
}
