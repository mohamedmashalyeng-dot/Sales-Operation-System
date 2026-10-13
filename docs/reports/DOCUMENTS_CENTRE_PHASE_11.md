# Phase 11 - Documents Centre

Status: PASS

## Scope Completed

- Added a Documents Centre UI for uploaded application evidence.
- Added APIs:
  - `GET /api/documents?limit=50&cursor=`
  - `GET /api/documents/:id/download`
- Reused existing application evidence metadata and download infrastructure.
- Added filters for search and file type in the first UI pass.
- Kept document downloads behind authenticated routes.

## Security

- Document ids do not grant access by themselves.
- Download authorization delegates to the existing evidence parent authorization:
  - Evidence -> Application -> Lead owner/team permission.
- File content is not returned in document list payloads.
- Filenames are sanitized for download headers.
- Executable extensions and unsafe content types are explicitly audited in tests.
- Public filesystem URLs are not exposed for uploaded evidence.

## Performance

- Listing is bounded and cursor-paginated.
- PostgreSQL listing expands only application requirement metadata and does not return `content_base64`.

## Tests

- `npm run test:documents`
- Authorization regression covers cross-user document download denial.
- Included in `npm run check`

## Known Limits

- The centre currently indexes application evidence and templates only.
- Gmail/meeting attachments are not copied into the document store, by design.
- Full version history is not introduced; current evidence metadata is reused.
