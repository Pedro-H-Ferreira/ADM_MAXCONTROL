import { afterEach, describe, expect, it, vi } from "vitest";
import { fluigAdmApi } from "@/lib/fluig-api";

function jsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("fluigAdmApi read deduplication", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reutiliza a chamada de agentes enquanto ela esta em voo", async () => {
    let release!: (response: Response) => void;
    const fetchMock = vi.fn(() => new Promise<Response>((resolve) => {
      release = resolve;
    }));
    vi.stubGlobal("fetch", fetchMock);

    const first = fluigAdmApi.listAgents();
    const second = fluigAdmApi.listAgents();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    release(jsonResponse({ success: true, agents: [{ id: "agent-1" }] }));
    await expect(Promise.all([first, second])).resolves.toEqual([
      [{ id: "agent-1" }],
      [{ id: "agent-1" }],
    ]);
  });

  it("compartilha a lista de jobs e recorta o limite de cada consumidor", async () => {
    const jobs = Array.from({ length: 50 }, (_, index) => ({ id: `job-${index}` }));
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ success: true, jobs }));
    vi.stubGlobal("fetch", fetchMock);

    const [shortList, fullList] = await Promise.all([
      fluigAdmApi.listJobs(20),
      fluigAdmApi.listJobs(50),
    ]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(shortList.jobs).toHaveLength(20);
    expect(fullList.jobs).toHaveLength(50);
  });

  it("nao mantem resposta em cache depois que a leitura termina", async () => {
    const fetchMock = vi.fn().mockImplementation(async () => jsonResponse({ success: true, agents: [] }));
    vi.stubGlobal("fetch", fetchMock);

    await fluigAdmApi.listAgents();
    await fluigAdmApi.listAgents();

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
