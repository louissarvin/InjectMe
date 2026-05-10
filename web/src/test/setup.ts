import '@testing-library/jest-dom/vitest'

// Stub import.meta.env for modules that read it at import time
if (
  typeof (globalThis as Record<string, unknown>).import_meta_env === 'undefined'
) {
  ;(globalThis as Record<string, unknown>).__vitest_environment__ = 'jsdom'
}
