# 0024 — Pre-release 0.0.1 contract

- **Status:** Accepted
- **Date:** 2026-09-21

## Decision

GSD remains pre-release at package version `0.0.1`. Runtime state is canonical `schema:v0.0.1` with the current field order and semantics. Earlier state schemas are experimental history: GSD neither migrates nor interprets them, and malformed or unsupported state bytes fail closed unchanged. Keeping the current field layout avoids changing runtime behavior while the schema name reflects the same pre-release status as the package version.

## Amendment

Amended 2026-10-05. The package version stays `0.0.1`, but the state schema has since moved to
`v0.0.3` (decision 0028). Earlier schemas, `v0.0.1` included, are not migrated.
