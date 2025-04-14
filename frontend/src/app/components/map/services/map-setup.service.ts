import { inject, Injectable, ViewChild, ViewContainerRef } from '@angular/core';
import TileLayer from 'ol/layer/Tile';
import VectorLayer from 'ol/layer/Vector';
import Map from 'ol/Map';
import Overlay from 'ol/Overlay';
import { fromLonLat } from 'ol/proj';
import { OSM } from 'ol/source';
import View from 'ol/View';
import { QueriesService } from '../../../shared/queries.service';
import { forkJoin, take, tap, map as rxjsMap } from 'rxjs';
import { PopupComponent } from '../components/popup/popup.component';
import { BoletimOcorrencia } from '../../../shared/schema.interface';

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
          const features = feature.get('features') || [feature]; // cluster or single

          // If it's a cluster (more than 1 feature) and zoom is not max, zoom in
          const view = map.getView();
          const currentZoom = view.getZoom() ?? 0;
          const maxZoom = view.getMaxZoom() ?? 19;

          if (features.length > 1 && currentZoom < maxZoom) {
            view.animate({
              center: event.coordinate,
              zoom: currentZoom + 2 > maxZoom ? maxZoom : currentZoom + 2,
              duration: 300,
            });
            return;
          }

          // If it's a single feature or already max zoom, show popup(s)
          const ids = features.map((f: any) => f.get('id'));

          if (ids.length === 1) {
            this.queriesService
              .getBoletimById(ids[0])
              .pipe(take(1))
              .subscribe((boletim) => {
                if (!boletim) return;
                popupComponentRef.instance.boletins = [boletim];
                popupOverlay.setPosition(event.coordinate);
                popupElement.style.display = 'block';
                popupComponentRef.changeDetectorRef.detectChanges();
              });
          } else {
            forkJoin<BoletimOcorrencia[]>(
              ids.map((id: number) =>
                this.queriesService.getBoletimById(id).pipe(take(1)),
              ),
            )
              .pipe(rxjsMap((boletins) => boletins.filter(Boolean)))
              .subscribe((boletins) => {
                if (!boletins.length) return;
                popupComponentRef.instance.boletins = boletins;

                popupOverlay.setPosition(event.coordinate);
                popupElement.style.display = 'block';
                popupComponentRef.changeDetectorRef.detectChanges();
              });
          }
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
