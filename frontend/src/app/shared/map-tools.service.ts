import { Injectable } from '@angular/core';
import VectorLayer from 'ol/layer/Vector';
import Map from 'ol/Map';
import { fromLonLat } from 'ol/proj';

@Injectable({
  providedIn: 'root',
})
export class MapToolsService {
  updateCenter(
    lon: number,
    lat: number,
    radius: number,
    map: Map | undefined | null,
    vectorLayer: VectorLayer,
  ) {
    if (!map) {
      return;
    }

    const coordinates = fromLonLat([lon, lat]);
    vectorLayer.getSource()?.clear(); // Clear previous features
    map?.getView().setCenter(coordinates);

    // If map zoom is less than 16, zoom in
    if (map?.getView().getZoom()! < 10) {
      map?.getView().setZoom(16);
    }

    // if radius, draw circle to represent the radius
    if (radius && radius !== -1) {
    }
  }

  clearFeatures(map: Map | undefined | null, vectorLayer: VectorLayer) {
    if (!map) {
      return;
    }

    vectorLayer.getSource()?.clear(); // Clear previous features
  }
}
