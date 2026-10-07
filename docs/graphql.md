# GraphQL transport

The API uses GraphQL Yoga's NestJS driver at `/api/graphql`. Nest decorators
remain the schema source (`autoSchemaFile: true`); the checked-in `schema.gql`
is not loaded at runtime. GraphiQL and introspection are available outside
production. Nest continues to own CORS, request IDs, and throttling.

Ordinary JSON operations keep their existing response shape. Nest HTTP
exceptions retain their GraphQL error codes; database timeouts retain
`REQUEST_TIMEOUT` without database details, including in incremental patches.
Unexpected resolver errors return a generic message and code while details
remain in server logs.
Batching and multipart file uploads are disabled. Multipart **responses** are
supported for incremental delivery.

## Incremental delivery

Yoga's `@defer`/`@stream` plugin extends the generated code-first schema. Clients
must send `Accept: multipart/mixed` and process all patches until `hasNext` is
false. A JSON-only client cannot consume these operations and receives HTTP 406
when execution produces incremental results. Incremental delivery is still an
experimental protocol; the Yoga driver, executor-facing server, and defer/stream
plugin versions are pinned and covered by transport tests.

The occurrence detail dialog uses a deferred IML fragment. The root resolver
loads the occurrence first; its IML field resolvers share one lazy enrichment
promise. Angular `HttpClient` reports download progress, and an Observable
emits the overview followed by the merged IML patch. Unsubscribing cancels the
request, and the completed response alone enters the detail cache. The dialog
shows a separate IML loading state while keeping the overview usable.

For a different client that needs both startup metadata and global totals, this query
could deliver the cheap metadata before the expensive count finishes:

```graphql
query MetadataWithDeferredTotals {
  mapFeaturesMetadata {
    datasetRevision
    dateRange { earliest latest defaultAfter }
    ... @defer(label: "totals") {
      totalFeatures
    }
  }
}
```

The metadata resolver already loads aggregates lazily, shares scans across
aliases/fragments, and checks dataset revisions. Deferral uses that behavior;
it does not reduce aggregate database work or guarantee a consistent snapshot
across a dataset update. A later patch can still fail and must be handled.

`@stream(initialCount: 10)` is supported on list fields, but does not make a
database query incremental when its resolver already waits for a complete
array. It is useful when list items themselves are expensive or arrive
asynchronously; current chart buckets and lookup results do not benefit enough
to justify switching their consumers.

Other Angular queries continue to request complete JSON results. Startup
metadata already omits aggregates, chart facets have separate cached queries,
and their consumers expect complete lists. The incremental transport is used
only where the UI models partial data, patch failures, cancellation, and cache
completion explicitly. The API still supports ordinary complete detail queries.

Implementation references:

- [Yoga NestJS integration](https://the-guild.dev/graphql/yoga-server/docs/integrations/integration-with-nestjs)
- [Yoga defer and stream](https://the-guild.dev/graphql/yoga-server/docs/features/defer-stream)

## Validation

`bunx nx test backend --runInBand` covers existing resolver contracts and the
Nest/Yoga HTTP fixture, including incremental chunks and deferred timeout errors.
The fixture uses an ephemeral local port and in-memory data; it does not start
the application or contact PostgreSQL. The metadata resolver test verifies that
the first response arrives while the count promise remains unresolved.

Use `bunx nx run-many -t lint -p backend frontend` and `bunx nx build backend`
for static validation. Live browser, database, and reverse-proxy buffering
behavior require separate validation in the deployed environment.
