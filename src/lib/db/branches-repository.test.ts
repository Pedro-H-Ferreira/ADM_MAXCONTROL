import { describe, expect, it } from "vitest";
import { aggregateOpenRequestCounts } from "@/lib/db/branches-repository";

describe("aggregateOpenRequestCounts", () => {
  it("conta cada solicitacao uma vez quando id e codigo da filial estao preenchidos", () => {
    const counts = aggregateOpenRequestCounts(
      [
        { id: "request-1", branch_id: "branch-1", branch_code: "1007" },
        { id: "request-1", branch_id: "branch-1", branch_code: "1007" },
        { id: "request-2", branch_id: null, branch_code: "1007" },
        { id: "request-3", branch_id: null, branch_code: "9999" },
      ],
      ["branch-1"],
      ["1007"]
    );

    expect(counts.get("branch-1")).toBe(2);
    expect(Array.from(counts.values()).reduce((total, value) => total + value, 0)).toBe(2);
  });
});
