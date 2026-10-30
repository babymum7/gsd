# 0006 - Shipping is priced by weight band

- **Status:** Accepted
- **Date:** 2026-05-19

## Decision

A parcel's weight picks one of three bands, up to 500 g, 2,000 g, or 10,000 g, and the band sets the price. A heavier parcel is refused.

## Rationale

The carrier contract prices by band, so the shop charges what it pays.
