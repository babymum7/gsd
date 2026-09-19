// Stable OMP entry surface. The OMP adapter was re-homed to adapters/omp/
// gsd-context.js (decision 0015), but install.sh still publishes this exact
// path as the direct extension symlink and existing importers still resolve it,
// so this file re-exports the adapter unchanged. It names no host identifier;
// only the adapter does.
export * from '../adapters/omp/gsd-context.js';
export { default } from '../adapters/omp/gsd-context.js';
