import "@testing-library/dom"

// jsdom does not implement the Web Locks API, which cart persistence requires:
// without an atomic cross-tab primitive it refuses to write at all. Provide a
// minimal implementation so tests exercise the production path rather than the
// disabled one. Execution is immediate, which is faithful enough here since a
// test runs in a single context with no competing tab.
if ((globalThis.navigator as { locks?: unknown }).locks === undefined) {
  Object.defineProperty(globalThis.navigator, "locks", {
    configurable: true,
    value: {
      request: async (_nom: string, rappel: () => unknown): Promise<unknown> =>
        rappel(),
    },
  })
}

// Cart persistence (issue #14) writes real localStorage entries keyed by
// store/session id. Several POS test suites reuse the same store1/sess1
// fixture, so without this reset a cart written by one test would leak into
// the next test's mount and corrupt its expectations.
afterEach(() => {
  localStorage.clear()
})
