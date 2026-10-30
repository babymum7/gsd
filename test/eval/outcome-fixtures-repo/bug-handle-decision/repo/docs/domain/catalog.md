# Catalog

## Products

- Products get sequential ids and carry a title and a price in whole cents.
- A product URL is `/p/<id>-<slug>`, where the slug is `toSlug` of the title (decision 0007).

## Search

- A search term matches a product when it equals a whole word of the title, ignoring letter case and surrounding spaces (decision 0003).
- An empty term matches nothing.
