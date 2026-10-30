# 0003 - Search matches whole words

- **Status:** Accepted
- **Date:** 2026-03-02

## Decision

A search term matches a product when it equals a whole word of the product's title, both compared in lower case after trimming. Part of a word does not match.

## Rationale

Matching parts of words flooded the results for short terms.
