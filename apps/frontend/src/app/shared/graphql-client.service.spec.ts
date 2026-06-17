import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { provideHttpClient, withXhr } from '@angular/common/http';
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
});
