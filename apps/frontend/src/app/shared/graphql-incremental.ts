import type { GraphQLResponse } from '@mapa-criminalidade/shared-types';

type Path = readonly (string | number)[];

export type IncrementalPayload<T> = Omit<GraphQLResponse<T>, 'data'> & {
  data?: Partial<T>;
  hasNext?: boolean;
  incremental?: readonly {
    data?: Record<string, unknown>;
    path?: Path;
    errors?: GraphQLResponse<T>['errors'];
  }[];
};

export class MultipartGraphqlParser<T> {
  private buffer = '';
  private boundary: string | null = null;
  private closed = false;

  setContentType(contentType: string | null): void {
    if (!contentType?.toLowerCase().startsWith('multipart/mixed')) return;
    const match = /(?:^|;)\s*boundary="?([^";]+)"?/i.exec(contentType);
    if (!match) throw new Error('GraphQL multipart boundary is missing');
    this.boundary = `--${match[1]}`;
  }

  get isMultipart(): boolean {
    return this.boundary !== null;
  }

  get isClosed(): boolean {
    return this.closed;
  }

  append(chunk: string): IncrementalPayload<T>[] {
    if (!this.boundary) return [];
    this.buffer += chunk;
    const parts: IncrementalPayload<T>[] = [];
    while (true) {
      const start = this.buffer.indexOf(this.boundary);
      if (start < 0) break;
      if (start > 0) this.buffer = this.buffer.slice(start);
      const afterBoundary = this.boundary.length;
      if (this.buffer.slice(afterBoundary, afterBoundary + 2) === '--') {
        this.closed = true;
        this.buffer = '';
        break;
      }
      const separator = this.buffer.indexOf('\r\n\r\n', afterBoundary);
      if (separator < 0) break;
      const bodyStart = separator + 4;
      const next = this.buffer.indexOf(this.boundary, bodyStart);
      const bodyEnd = next >= 0 ? next : this.buffer.lastIndexOf('\r\n');
      if (bodyEnd < bodyStart) break;
      let payload: IncrementalPayload<T>;
      try {
        payload = JSON.parse(this.buffer.slice(bodyStart, bodyEnd).trim()) as IncrementalPayload<T>;
      } catch {
        // A download-progress event can end in the middle of a JSON payload.
        if (next < 0) break;
        throw new Error('Invalid GraphQL multipart part');
      }
      parts.push(payload);
      this.buffer = this.buffer.slice(next >= 0 ? next : bodyEnd + 2);
    }
    return parts;
  }
}

export function applyIncrementalPatch<T>(
  current: T,
  path: Path,
  data: Record<string, unknown>
): T {
  if (path.length === 0) return { ...current, ...data };
  const [key, ...rest] = path;
  const container = current as Record<string | number, unknown>;
  const child = container[key];
  if (child === null || typeof child !== 'object') {
    throw new Error('GraphQL patch path does not exist');
  }
  const next = applyIncrementalPatch(child, rest, data);
  return (Array.isArray(current)
    ? Object.assign([...current], { [key]: next })
    : { ...current, [key]: next }) as T;
}
