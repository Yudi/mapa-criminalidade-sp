import { HttpClient, HttpEventType } from '@angular/common/http';
import { Service, inject } from '@angular/core';
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
import {
  applyIncrementalPatch,
  IncrementalPayload,
  MultipartGraphqlParser,
} from './graphql-incremental';

export interface GraphqlProgress<TData> {
  data: Partial<TData>;
  complete: boolean;
  errors: NonNullable<GraphQLResponse<TData>['errors']>;
}

@Service()
export class GraphqlClientService {
  private readonly http = inject(HttpClient);
  private readonly requestTimeoutService = inject(RequestTimeoutService);

  request<TData, TVariables = Record<string, unknown>>(
    request: GraphQLRequest<TVariables>
  ): Observable<TData> {
    return this.http
      .post<GraphQLResponse<TData>>(`${environment.apiUrl}/graphql`, request)
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

  /** Emits the initial data and each deferred patch; unsubscribe cancels the request. */
  requestDeferred<TData, TVariables = Record<string, unknown>>(
    request: GraphQLRequest<TVariables>
  ): Observable<GraphqlProgress<TData>> {
    return new Observable<GraphqlProgress<TData>>((subscriber) => {
      const parser = new MultipartGraphqlParser<TData>();
      let receivedLength = 0;
      let data: Partial<TData> | undefined;
      let errors: GraphqlProgress<TData>['errors'] = [];
      let complete = false;

      const acceptPart = (part: IncrementalPayload<TData>) => {
        if (part.data !== undefined) data = part.data;
        for (const patch of part.incremental ?? []) {
          if (patch.data) {
            if (data === undefined || !patch.path) {
              throw new Error('GraphQL patch arrived before initial data');
            }
            data = applyIncrementalPatch(data, patch.path, patch.data);
          }
          errors = [...errors, ...(patch.errors ?? [])];
        }
        errors = [...errors, ...(part.errors ?? [])];
        if (
          errors.some(
            (error) => error.extensions?.['code'] === GRAPHQL_REQUEST_TIMEOUT_CODE
          )
        ) {
          this.requestTimeoutService.notify();
        }
        if (data === undefined) {
          if (errors.length) {
            throw new Error(errors.map((error) => error.message).join('; '));
          }
          throw new Error('GraphQL response did not include data');
        }
        complete = part.hasNext === false || !parser.isMultipart;
        subscriber.next({ data, complete, errors });
      };

      const acceptText = (text: string) => {
        const addition = text.slice(receivedLength);
        receivedLength = text.length;
        for (const part of parser.append(addition)) acceptPart(part);
      };

      const subscription = this.http.request(
        'POST',
        `${environment.apiUrl}/graphql`,
        {
          body: request,
          headers: { Accept: 'multipart/mixed, application/json' },
          observe: 'events',
          reportProgress: true,
          responseType: 'text',
        }
      ).subscribe({
        next: (event) => {
          try {
            if (event.type === HttpEventType.ResponseHeader) {
              parser.setContentType(event.headers.get('content-type'));
            } else if (event.type === HttpEventType.DownloadProgress) {
              if (event.partialText !== undefined) acceptText(event.partialText);
            } else if (event.type === HttpEventType.Response) {
              parser.setContentType(event.headers.get('content-type'));
              if (parser.isMultipart) {
                acceptText(event.body ?? '');
                if (!parser.isClosed || !complete) {
                  throw new Error('Incomplete GraphQL multipart response');
                }
              } else {
                acceptPart(
                  JSON.parse(event.body ?? '') as IncrementalPayload<TData>
                );
              }
            }
          } catch (error) {
            subscriber.error(error);
          }
        },
        error: (error: unknown) => subscriber.error(error),
        complete: () => subscriber.complete(),
      });
      return () => subscription.unsubscribe();
    });
  }
}
