import { HttpClient, provideHttpClient, withInterceptors, withXhr } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { fakeAsync, TestBed, tick } from '@angular/core/testing';
import {
  BACKEND_REQUEST_TIMEOUT_MS,
  requestTimeoutInterceptor,
} from './request-timeout.interceptor';
import {
  RequestTimeoutError,
  RequestTimeoutService,
} from './request-timeout.service';

describe('requestTimeoutInterceptor', () => {
  let http: HttpClient;
  let httpTesting: HttpTestingController;
  let requestTimeoutService: { notify: jest.Mock };

  beforeEach(() => {
    requestTimeoutService = { notify: jest.fn() };

    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withXhr(), withInterceptors([requestTimeoutInterceptor])),
        provideHttpClientTesting(),
        {
          provide: RequestTimeoutService,
          useValue: requestTimeoutService,
        },
      ],
    });

    http = TestBed.inject(HttpClient);
    httpTesting = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpTesting.verify({ ignoreCancelled: true });
  });

  it('notifies the user for gateway timeout responses', () => {
    let receivedError: unknown;

    http.get('/api/data').subscribe({
      error: (error: unknown) => {
        receivedError = error;
      },
    });

    httpTesting.expectOne('/api/data').flush('Gateway timeout', {
      status: 504,
      statusText: 'Gateway Timeout',
    });

    expect(receivedError).toBeInstanceOf(RequestTimeoutError);
    expect(requestTimeoutService.notify).toHaveBeenCalledTimes(1);
  });

  it('aborts and notifies when the backend stops responding', fakeAsync(() => {
    let receivedError: unknown;

    http.get('/api/data').subscribe({
      error: (error: unknown) => {
        receivedError = error;
      },
    });

    const request = httpTesting.expectOne('/api/data');
    tick(BACKEND_REQUEST_TIMEOUT_MS);

    expect(request.cancelled).toBe(true);
    expect(receivedError).toBeInstanceOf(RequestTimeoutError);
    expect(requestTimeoutService.notify).toHaveBeenCalledTimes(1);
  }));

  it('does not impose the backend timeout on external requests', fakeAsync(() => {
    let completed = false;

    http.get('https://example.com/data').subscribe(() => {
      completed = true;
    });

    const request = httpTesting.expectOne('https://example.com/data');
    tick(BACKEND_REQUEST_TIMEOUT_MS);
    expect(request.cancelled).toBe(false);

    request.flush({});
    expect(completed).toBe(true);
    expect(requestTimeoutService.notify).not.toHaveBeenCalled();
  }));
});
