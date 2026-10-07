import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import {
  HttpEventType,
  HttpHeaders,
  HttpHeaderResponse,
  provideHttpClient,
  withXhr,
} from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { GRAPHQL_REQUEST_TIMEOUT_CODE } from '@mapa-criminalidade/shared-types';
import { environment } from '../../environments/environment';
import { GraphqlClientService } from './graphql-client.service';
import {
  RequestTimeoutError,
  RequestTimeoutService,
} from './request-timeout.service';

describe('GraphqlClientService', () => {
  let httpTesting: HttpTestingController;
  let service: GraphqlClientService;
  let requestTimeoutService: { notify: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    requestTimeoutService = { notify: vi.fn() };

    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withXhr()),
        provideHttpClientTesting(),
        {
          provide: RequestTimeoutService,
          useValue: requestTimeoutService,
        },
      ],
    });

    httpTesting = TestBed.inject(HttpTestingController);
    service = TestBed.inject(GraphqlClientService);
  });

  afterEach(() => {
    httpTesting.verify();
  });

  it('notifies the user when GraphQL reports a database timeout', () => {
    let receivedError: unknown;

    service.request<{ value: string }>({ query: '{ value }' }).subscribe({
      error: (error: unknown) => {
        receivedError = error;
      },
    });

    httpTesting.expectOne(`${environment.apiUrl}/graphql`).flush({
      errors: [
        {
          message: 'Request timed out',
          extensions: { code: GRAPHQL_REQUEST_TIMEOUT_CODE },
        },
      ],
    });

    expect(receivedError).toBeInstanceOf(RequestTimeoutError);
    expect(requestTimeoutService.notify).toHaveBeenCalledTimes(1);
  });

  it('does not label unrelated GraphQL errors as timeouts', () => {
    let receivedError: unknown;

    service.request<{ value: string }>({ query: '{ value }' }).subscribe({
      error: (error: unknown) => {
        receivedError = error;
      },
    });

    httpTesting.expectOne(`${environment.apiUrl}/graphql`).flush({
      errors: [{ message: 'Invalid filter' }],
    });

    expect(receivedError).toEqual(new Error('Invalid filter'));
    expect(requestTimeoutService.notify).not.toHaveBeenCalled();
  });

  it('emits deferred data before completion and merges its patch', () => {
    const states: unknown[] = [];
    service.requestDeferred<{ detail: { title: string; iml: string } }>({
      query: '{ detail { title ... @defer { iml } } }',
    }).subscribe((state) => states.push(state));

    const request = httpTesting.expectOne(`${environment.apiUrl}/graphql`);
    expect(request.request.headers.get('Accept')).toContain('multipart/mixed');
    const contentType = 'multipart/mixed; boundary="graphql"';
    request.event(new HttpHeaderResponse({ headers: new HttpHeaders({ 'content-type': contentType }) }));
    const first = '--graphql\r\ncontent-type: application/json\r\n\r\n' +
      '{"data":{"detail":{"title":"BO"}},"hasNext":true}\r\n';
    request.event({ type: HttpEventType.DownloadProgress, loaded: first.length, partialText: first });
    expect(states).toEqual([{ data: { detail: { title: 'BO' } }, complete: false, errors: [] }]);

    const body = first + '--graphql\r\ncontent-type: application/json\r\n\r\n' +
      '{"incremental":[{"path":["detail"],"data":{"iml":"ready"}}],"hasNext":false}' +
      '\r\n--graphql--\r\n';
    request.flush(body, { headers: { 'content-type': contentType } });
    expect(states).toEqual([
      { data: { detail: { title: 'BO' } }, complete: false, errors: [] },
      { data: { detail: { title: 'BO', iml: 'ready' } }, complete: true, errors: [] },
    ]);
  });

  it('rejects a truncated deferred response', () => {
    let receivedError: unknown;
    service.requestDeferred<{ detail: string }>({ query: '{ detail }' }).subscribe({
      error: (error: unknown) => { receivedError = error; },
    });
    const request = httpTesting.expectOne(`${environment.apiUrl}/graphql`);
    request.flush('--graphql\r\ncontent-type: application/json\r\n\r\n' +
      '{"data":{"detail":"partial"},"hasNext":true}\r\n', {
      headers: { 'content-type': 'multipart/mixed; boundary=graphql' },
    });
    expect(receivedError).toEqual(new Error('Incomplete GraphQL multipart response'));
  });

  it('cancels a deferred HTTP request on unsubscribe', () => {
    const subscription = service.requestDeferred<{ detail: string }>({
      query: '{ detail }',
    }).subscribe();
    const request = httpTesting.expectOne(`${environment.apiUrl}/graphql`);
    subscription.unsubscribe();
    expect(request.cancelled).toBe(true);
  });
});
