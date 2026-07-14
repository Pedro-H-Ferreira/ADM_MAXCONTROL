import { beforeEach, describe, expect, it, vi } from "vitest";
import { operationalLaunchFingerprint } from "@/lib/operational-launch";

const mocks = vi.hoisted(() => ({
  canActorAccessPage: vi.fn(),
  canActorPerformPageAction: vi.fn(),
  enqueueOperationalLaunchJob: vi.fn(),
  getOperationalLaunch: vi.fn(),
  requireFluigProcessMap: vi.fn(),
  resolveCurrentAppUser: vi.fn(),
}));

vi.mock("@/lib/db/app-repository", () => ({
  canActorAccessPage: mocks.canActorAccessPage,
  canActorPerformPageAction: mocks.canActorPerformPageAction,
  isAppAuthError: () => false,
  resolveCurrentAppUser: mocks.resolveCurrentAppUser,
}));

vi.mock("@/lib/db/operational-launch-repository", () => ({
  createValidatedOperationalLaunch: vi.fn(),
  enqueueOperationalLaunchJob: mocks.enqueueOperationalLaunchJob,
  getOperationalLaunch: mocks.getOperationalLaunch,
  listOperationalLaunches: vi.fn(),
}));

vi.mock("@/lib/fluig/process-map", () => ({
  requireFluigProcessMap: mocks.requireFluigProcessMap,
}));

import { POST } from "@/app/api/fluig/adm/launches/route";

type AttachmentPayload = {
  name: string;
  mimeType: string;
  size: number;
  dataBase64: string;
};

const launchId = "2a8eb97d-d627-4859-a713-d72a7aecc252";

function request(attachments: AttachmentPayload[]) {
  return new Request("http://localhost/api/fluig/adm/launches", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: "submit", launchId, attachments }),
  });
}

function launchFor(attachments: AttachmentPayload[]) {
  const attachmentMetadata = attachments.map(({ name, mimeType, size }) => ({ name, mimeType, size }));
  const fingerprintInput = {
    sourceRequestId: "12345",
    fieldOverrides: {},
    attachments: attachmentMetadata,
    items: [],
  };

  return {
    id: launchId,
    module: "pagamentos" as const,
    status: "VALIDADO" as const,
    sourceRequestId: fingerprintInput.sourceRequestId,
    fieldOverrides: fingerprintInput.fieldOverrides,
    attachments: attachmentMetadata,
    items: fingerprintInput.items,
    reviewFingerprint: operationalLaunchFingerprint(fingerprintInput),
  };
}

async function submit(attachments: AttachmentPayload[]) {
  mocks.getOperationalLaunch.mockResolvedValue(launchFor(attachments));
  return POST(request(attachments));
}

describe("POST /api/fluig/adm/launches submit attachments", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolveCurrentAppUser.mockResolvedValue({ id: "user-1" });
    mocks.canActorAccessPage.mockReturnValue(true);
    mocks.canActorPerformPageAction.mockReturnValue(true);
    mocks.requireFluigProcessMap.mockReturnValue({
      module: "pagamentos",
      processId: "process-1",
      processVersions: [1],
      processLabel: "Pagamento",
      defaultTaskUserId: "user-1",
    });
    mocks.enqueueOperationalLaunchJob.mockResolvedValue({ id: "job-1" });
  });

  it("rejeita size falsificado antes de enfileirar", async () => {
    const content = Buffer.from("conteudo real");
    const response = await submit([
      {
        name: "nota.pdf",
        mimeType: "application/pdf",
        size: 1,
        dataBase64: content.toString("base64"),
      },
    ]);

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      success: false,
      error: `O tamanho declarado do anexo "nota.pdf" (1 byte) nao corresponde ao tamanho real (${content.byteLength} bytes).`,
    });
    expect(mocks.enqueueOperationalLaunchJob).not.toHaveBeenCalled();
  });

  it("rejeita Base64 invalido antes de enfileirar", async () => {
    const response = await submit([
      {
        name: "nota.pdf",
        mimeType: "application/pdf",
        size: 3,
        dataBase64: "Zm9v$",
      },
    ]);

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      success: false,
      error: expect.stringContaining("dataBase64 invalido"),
    });
    expect(mocks.enqueueOperationalLaunchJob).not.toHaveBeenCalled();
  });

  it("rejeita data URL sem marcador base64", async () => {
    const response = await submit([
      {
        name: "nota.pdf",
        mimeType: "application/pdf",
        size: 3,
        dataBase64: "data:application/pdf,foo",
      },
    ]);

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      success: false,
      error: expect.stringContaining("dataBase64 invalido"),
    });
    expect(mocks.enqueueOperationalLaunchJob).not.toHaveBeenCalled();
  });

  it("rejeita total real acima de 3 MB", async () => {
    const firstContent = Buffer.alloc(1_600_000, 1);
    const secondContent = Buffer.alloc(1_600_000, 2);
    const response = await submit([
      {
        name: "nota-1.pdf",
        mimeType: "application/pdf",
        size: firstContent.byteLength,
        dataBase64: firstContent.toString("base64"),
      },
      {
        name: "nota-2.pdf",
        mimeType: "application/pdf",
        size: secondContent.byteLength,
        dataBase64: secondContent.toString("base64"),
      },
    ]);

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      success: false,
      error: "Os anexos podem ter no maximo 3 MB no total, considerando os bytes reais.",
    });
    expect(mocks.enqueueOperationalLaunchJob).not.toHaveBeenCalled();
  });

  it.each([
    ["Base64 puro", (content: Buffer) => content.toString("base64")],
    ["data URL", (content: Buffer) => `data:application/pdf;base64,${content.toString("base64")}`],
  ])("aceita payload valido em %s e preserva o contrato da fila", async (_label, encode) => {
    const content = Buffer.from("pdf valido");
    const attachment = {
      name: "nota.pdf",
      mimeType: "application/pdf",
      size: content.byteLength,
      dataBase64: encode(content),
    };
    const response = await submit([attachment]);

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ success: true, job: { id: "job-1" } });
    expect(mocks.enqueueOperationalLaunchJob).toHaveBeenCalledWith(
      expect.objectContaining({
        launchId,
        requestPayload: expect.objectContaining({ attachments: [attachment] }),
      })
    );
  });
});
