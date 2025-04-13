import {
  AfterViewInit,
  Component,
  OnChanges,
  OnDestroy,
  SimpleChanges,
  ViewChild,
  ViewContainerRef,
  WritableSignal,
  inject,
  input,
} from '@angular/core';
import Map from 'ol/Map';

import { fromLonLat } from 'ol/proj';

import Feature from 'ol/Feature';
import { Point } from 'ol/geom';
import VectorSource from 'ol/source/Vector';
import VectorLayer from 'ol/layer/Vector';
import Style from 'ol/style/Style';
import Icon from 'ol/style/Icon';
import {
  catchError,
  from,
  map,
  mergeMap,
  of,
  shareReplay,
  Subject,
  switchMap,
  take,
  takeUntil,
  tap,
} from 'rxjs';

import { environment } from '../../../environments/environment';
import { ObjectHandlingService } from '../../shared/object-handling.service';
import { BoletimOcorrencia } from '../../shared/schema.interface';
import Collection from 'ol/Collection';
import BaseLayer from 'ol/layer/Base';
import { ProgressBarService } from '../../shared/progressbar.service';
import { MapMarkersService } from '../../shared/map-markers.service';
import { DOCUMENT } from '@angular/common';
import { QueriesService } from '../../shared/queries.service';
import { MapSetupService } from './services/map-setup.service';
import { MapToolsService } from '../../shared/map-tools.service';

@Component({
  selector: 'app-map',
  templateUrl: './map.component.html',
  styleUrls: ['./map.component.scss'],
})
export class MapComponent implements AfterViewInit, OnChanges, OnDestroy {
  @ViewChild('popupContainer', { read: ViewContainerRef, static: true })
  popupContainer!: ViewContainerRef;

  addressCenter = input.required<{
    lon: number | null;
    lat: number | null;
    radius: number | null;
    before: string | null;
    after: string | null;
  }>();

  rubricasFormValues = input.required<
    | {
        [key: string]: boolean;
      }
    | undefined
  >();

  showIndeterminateProgressBar = input.required<WritableSignal<boolean>>();
  progressBarPercentage = input.required<WritableSignal<number>>();

  private objectHandlingService = inject(ObjectHandlingService);
  private progressBarService = inject(ProgressBarService);
  private markersService = inject(MapMarkersService);
  private queriesService = inject(QueriesService);
  private mapSetupService = inject(MapSetupService);
  private mapToolsService = inject(MapToolsService);

  private formChange$ = new Subject<void>();
  private destroy$ = new Subject<void>();

  private document = inject(DOCUMENT);

  map: Map | undefined | null;
  vectorLayer: VectorLayer = new VectorLayer({
    source: new VectorSource({}),
  });
  centerPin: Feature | undefined;

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['addressCenter']) {
      const prevValue = changes['addressCenter'].previousValue;
      const currentValue = changes['addressCenter'].currentValue;
      // Perform a deep comparison if it's an object
      if (
        !this.objectHandlingService.areObjectsEqual(prevValue, currentValue)
      ) {
        this.handleFormSubmit();
      }
    }

    if (changes['rubricasFormValues']) {
      if (this.rubricasFormValues()) {
        this.onRubricasFormChange(this.rubricasFormValues()!);
      }
    }
  }

  onRubricasFormChange(rubricasFormValues: { [key: string]: boolean }) {
    if (!this.map) {
      console.warn('Map not initialized yet!');
      return;
    }

    this.formChange$.next();

    this.progressBarPercentage().set(0);
    const values = rubricasFormValues;
    const selectedRubricas = Object.keys(values).filter(
      (rubrica) => values[rubrica],
    );

    const totalRubricas = selectedRubricas.length;
    const mapLayers = this.map.getLayers();

    // Remove unchecked rubricas
    Object.keys(values).forEach((rubrica) => {
      if (!values[rubrica]) {
        this.removeRubricaLayerFeatures(rubrica, mapLayers);
      }
    });

    if (totalRubricas === 0) {
      return;
    }

    const baseRubricaProgress = 100 / totalRubricas;

    from(selectedRubricas)
      .pipe(
        takeUntil(this.formChange$),
        takeUntil(this.destroy$),
        mergeMap((rubrica) => {
          return this.queriesService
            .getBoletinsByRubricaForPoint(
              this.addressCenter().lat!,
              this.addressCenter().lon!,
              this.addressCenter().radius!,
              this.addressCenter().before!,
              this.addressCenter().after!,
              rubrica,
            )
            .pipe(
              takeUntil(this.formChange$),
              map((boletins: BoletimOcorrencia[]) => ({ rubrica, boletins })),
            );
        }),
      )
      .subscribe({
        next: ({ rubrica, boletins }) => {
          this.generateFeaturesLayerForRubrica(
            rubrica,
            boletins,
            baseRubricaProgress,
          );
        },
        complete: () => {
          this.progressBarPercentage().set(-1);
        },
      });
  }

  removeRubricaLayerFeatures(
    rubrica: string,
    mapLayers: Collection<BaseLayer> | undefined,
  ) {
    if (!mapLayers) {
      return;
    }

    mapLayers.forEach((layer) => {
      if (layer instanceof VectorLayer && layer.get('rubrica') === rubrica) {
        layer.getSource()?.clear();
      }
    });
  }

  generateFeaturesLayerForRubrica(
    rubrica: string,
    responseData: BoletimOcorrencia[] | null,
    baseRubricaProgress: number,
  ) {
    if (!this.map) {
      console.warn('Map not initialized yet!');
      return;
    }

    if (!responseData) {
      return;
    }

    const layersByType: { [key: string]: VectorLayer } = {};

    // Check if the layer already exists
    this.map.getLayers().forEach((layer) => {
      if (layer instanceof VectorLayer) {
        layersByType[layer.get('rubrica')] = layer;
      }
    });

    if (!layersByType[rubrica]) {
      const vectorSource = new VectorSource();
      layersByType[rubrica] = new VectorLayer({
        source: vectorSource,
        style: new Style({
          image: new Icon({
            anchor: [0.5, 1],
            scale: 0.2,
            anchorXUnits: 'fraction',
            anchorYUnits: 'fraction',
            src: `${environment.baseUrl}/${this.markersService.markerChooser(rubrica)}`,
          }),
        }),
      });

      // Set the rubrica as a property of the layer
      layersByType[rubrica].set('rubrica', rubrica);

      this.map.addLayer(layersByType[rubrica]);
    } else {
    }

    const validBoletins = responseData.filter(
      (bo) => bo && bo.rubrica && bo.longitude !== null && bo.latitude !== null,
    );

    const totalFeatures = validBoletins.length;
    const progressPerFeature =
      totalFeatures > 0
        ? baseRubricaProgress / totalFeatures
        : baseRubricaProgress;

    const features = validBoletins.map((bo) => {
      this.progressBarService.addToProgressBar(
        progressPerFeature,
        this.progressBarPercentage(),
      );
      const feature = new Feature({
        geometry: new Point(fromLonLat([bo.longitude!, bo.latitude!])),
      });

      feature.set('id', bo.id);

      return feature;
    });

    layersByType[rubrica].getSource()?.addFeatures(features);
  }

  handleFormSubmit() {
    this.showIndeterminateProgressBar().set(false);

    this.mapToolsService.updateCenter(
      this.addressCenter().lon!,
      this.addressCenter().lat!,
      this.addressCenter().radius!,
      this.map,
      this.vectorLayer,
    );

    this.mapToolsService.clearFeatures(this.map, this.vectorLayer);

    if (this.rubricasFormValues()) {
      this.onRubricasFormChange(this.rubricasFormValues()!);
    }
  }

  ngAfterViewInit() {
    setTimeout(() => {
      this.map = this.mapSetupService.setupMap(
        this.map,
        this.vectorLayer,
        this.document,
        this.popupContainer,
      );
    }, 500);
  }

  ngOnDestroy() {
    this.destroy$.next();
    this.destroy$.complete();
  }
}
