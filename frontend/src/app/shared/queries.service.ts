import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { of, take, tap } from 'rxjs';
import { environment } from '../../environments/environment';
import { BoletimOcorrencia } from './schema.interface';
import Observable from 'ol/Observable';

@Injectable({
  providedIn: 'root',
})
export class QueriesService {
  private http = inject(HttpClient);
  queryAddress(street: string, city: string, state: string) {
    return this.http
      .get<
        {
          lat: number;
          lon: number;
        }[]
      >(
        `https://nominatim.openstreetmap.org/search?format=json&street=${street}&city=${city}&state=${state}&country=Brazil`,
      )
      .pipe(take(1));
  }

  queryDatabase(
    lat: number,
    lon: number,
    radius: number,
    before: string,
    after: string,
  ) {
    if (!lat || !lon || !radius) {
      return of(null);
    }
    return this.http.get<BoletimOcorrencia[]>(
      environment.apiUrl +
        `/boletins-ocorrencia/query-point?lat=${lat}&lon=${lon}&radius=${radius}&before=${before}&after=${after}`,
    );
  }
}
