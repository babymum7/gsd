# 0007 - Product URLs carry the id and a slug

- **Status:** Accepted
- **Date:** 2026-06-23

## Decision

A product URL is `/p/<id>-<slug>`, the slug being `toSlug` of the title. The id alone identifies the product, so a renamed product keeps its old links working.

## Rationale

Slugs make links readable, and the id keeps them stable.
