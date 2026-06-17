import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, map } from 'rxjs';
import { environment } from '../../environments/environment';
import {
  GRAPHQL_REQUEST_TIMEOUT_CODE,
  GraphQLRequest,
  GraphQLResponse,
} from '@mapa-criminalidade/shared-types';
import {
  RequestTimeoutError,
  RequestTimeoutService,
} from './request-timeout.service';

@Injectable({
  providedIn: 'root',
})
export class GraphqlClientService {
  private readonly http = inject(HttpClient);
  private readonly requestTimeoutService = inject(RequestTimeoutService);

  request<TData, TVariables = Record<string, unknown>>(
    request: GraphQLRequest<TVariables>
  ): Observable<TData> {
    return this.http
      .post<GraphQLResponse<TData>>(
        `${environment.apiUrl}/graphql`,
        request,
        { withCredentials: true }
      )
      .pipe(
        map((response) => {
          if (response.errors?.length) {
            if (
              response.errors.some(
                (error) =>
                  error.extensions?.['code'] === GRAPHQL_REQUEST_TIMEOUT_CODE
              )
            ) {
              this.requestTimeoutService.notify();
              throw new RequestTimeoutError();
            }

            throw new Error(
              response.errors.map((error) => error.message).join('; ')
            );
          }

          if (!response.data) {
            throw new Error('GraphQL response did not include data');
          }

          return response.data;
        })
      );
  }
}
