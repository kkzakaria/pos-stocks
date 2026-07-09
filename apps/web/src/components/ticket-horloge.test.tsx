import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, act } from "@testing-library/react"
import { TicketHorloge } from "./ticket-horloge"

describe("TicketHorloge", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-07-09T10:59:30"))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("affiche l'heure courante puis se met à jour à la minute suivante", () => {
    render(<TicketHorloge />)
    expect(screen.getByText("09/07/2026 10:59")).toBeTruthy()

    act(() => {
      vi.advanceTimersByTime(60_000)
    })
    expect(screen.getByText("09/07/2026 11:00")).toBeTruthy()
  })
})
