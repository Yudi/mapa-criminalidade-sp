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
import Cluster from 'ol/source/Cluster';
import VectorLayer from 'ol/layer/Vector';
import Style from 'ol/style/Style';
import Icon from 'ol/style/Icon';
import { Circle as CircleStyle, Fill, Stroke, Text } from 'ol/style';
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

  rubricasFormValues = input.required<{ [key: string]: boolean } | undefined>();
  showIndeterminateProgressBar = input.required<WritableSignal<boolean>>();
  progressBarPercentage = input.required<WritableSignal<number>>();

  private objectHandlingService = inject(ObjectHandlingService);
  private progressBarService = inject(ProgressBarService);
  private markersService = inject(MapMarkersService);
  private queriesService = inject(QueriesService);
  private mapSetupService = inject(MapSetupService);
  private mapToolsService = inject(MapToolsService);
  private document = inject(DOCUMENT);

  private formChange$ = new Subject<void>();
  private destroy$ = new Subject<void>();

  map: Map | undefined | null;
  vectorLayer: VectorLayer = new VectorLayer({
    source: new VectorSource({}),
  });

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['addressCenter']) {
      const prevValue = changes['addressCenter'].previousValue;
      const currentValue = changes['addressCenter'].currentValue;
      if (
        !this.objectHandlingService.areObjectsEqual(prevValue, currentValue)
      ) {
        this.handleFormSubmit();
      }
    }

    if (changes['rubricasFormValues'] && this.rubricasFormValues()) {
      this.onRubricasFormChange(this.rubricasFormValues()!);
    }
  }

  onRubricasFormChange(rubricasFormValues: { [key: string]: boolean }) {
    if (!this.map) {
      console.warn('Map not initialized yet!');
      return;
    }

    this.formChange$.next();
    this.progressBarPercentage().set(0);

    const selectedRubricas = Object.keys(rubricasFormValues).filter(
      (rubrica) => rubricasFormValues[rubrica],
    );

    const totalRubricas = selectedRubricas.length;
    const mapLayers = this.map.getLayers();

    Object.keys(rubricasFormValues).forEach((rubrica) => {
      if (!rubricasFormValues[rubrica]) {
        this.removeRubricaLayerFeatures(rubrica, mapLayers);
      }
    });

    if (totalRubricas === 0) return;

    const baseRubricaProgress = 100 / totalRubricas;

    from(selectedRubricas)
      .pipe(
        takeUntil(this.formChange$),
        takeUntil(this.destroy$),
        mergeMap((rubrica) =>
          this.queriesService
            .getBoletinsByRubricaForPoint(
              this.addressCenter().lat!,
              this.addressCenter().lon!,
              this.addressCenter().radius!,
              this.addressCenter().before!,
              this.addressCenter().after!,
              rubrica,
            )
            .pipe(map((boletins) => ({ rubrica, boletins }))),
        ),
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
    mapLayers?.forEach((layer) => {
      if (layer instanceof VectorLayer && layer.get('rubrica') === rubrica) {
        layer.getSource()?.clear();
        this.map?.removeLayer(layer);
      }
    });
  }

  generateFeaturesLayerForRubrica(
    rubrica: string,
    responseData: BoletimOcorrencia[] | null,
    baseRubricaProgress: number,
  ) {
    if (!this.map || !responseData) return;

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

    const vectorSource = new VectorSource({ features });

    const clusterSource = new Cluster({
      distance: 40,
      source: vectorSource,
    });

    const clusterLayer = new VectorLayer({
      source: clusterSource,
      style: (feature) => {
        const features = feature.get('features');
        const size = features?.length || 0;

        // Define color based on size
        let fillColor = '#E2E7BC'; // default (least)
        if (size > 50) fillColor = '#8C143E';
        else if (size > 35) fillColor = '#B9534D';
        else if (size > 20) fillColor = '#D88558';
        else if (size > 10) fillColor = '#EEAA65';
        else if (size > 5) fillColor = '#F9C874';
        else if (size > 2) fillColor = '#F2DE80';

        if (size === 1) {
          return new Style({
            image: new Icon({
              anchor: [0.5, 1],
              scale: 0.2,
              anchorXUnits: 'fraction',
              anchorYUnits: 'fraction',
              src: `${environment.baseUrl}/${this.markersService.markerChooser(rubrica)}`,
            }),
          });
        } else {
          return new Style({
            image: new CircleStyle({
              radius: 16,
              fill: new Fill({ color: fillColor }),
              stroke: new Stroke({ color: '#fff', width: 2 }),
            }),
            text: new Text({
              text: size.toString(),
              fill: new Fill({ color: '#000' }),
              stroke: new Stroke({ color: '#fff', width: 3 }),
              font: '12px sans-serif',
            }),
          });
        }
      },
    });

    clusterLayer.set('rubrica', rubrica);
    this.map.addLayer(clusterLayer);
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
    this.map = this.mapSetupService.setupMap(
      this.map,
      this.vectorLayer,
      this.document,
      this.popupContainer,
    );
  }

  ngOnDestroy() {
    this.destroy$.next();
    this.destroy$.complete();
  }
}
