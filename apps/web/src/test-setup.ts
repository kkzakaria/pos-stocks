import "@testing-library/dom"

// Cart persistence (issue #14) writes real localStorage entries keyed by
// store/session id. Several POS test suites reuse the same store1/sess1
// fixture, so without this reset a cart written by one test would leak into
// the next test's mount and corrupt its expectations.
afterEach(() => {
  localStorage.clear()
})
