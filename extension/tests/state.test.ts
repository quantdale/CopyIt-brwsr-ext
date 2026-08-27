import { describe, it, expect } from "vitest";
import { initialState, shouldDiscardResponse } from "../src/state.js";

describe("state", () => {
  it("initial state is clean", () => {
    const s = initialState();
    expect(s.query).toBe("");
    expect(s.category).toBe("");
    expect(s.items).toEqual([]);
    expect(s.loading).toBe(false);
    expect(s.hostUnavailable).toBe(false);
  });

  it("discards stale responses", () => {
    expect(shouldDiscardResponse(1, 2)).toBe(true);
    expect(shouldDiscardResponse(2, 2)).toBe(false);
  });
});
