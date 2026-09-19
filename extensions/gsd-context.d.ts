// Stable OMP type entry. The hand-maintained type surface now lives beside the
// adapter at adapters/omp/gsd-context.d.ts (decision 0015); this shim keeps
// package.json#types and editors on the old path resolving.
export * from '../adapters/omp/gsd-context.js';
export { default } from '../adapters/omp/gsd-context.js';
