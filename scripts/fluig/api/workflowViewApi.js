/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require("fs");

async function postJson(page, url, payload, timeoutMs = 30000) {
  return page.evaluate(
    async ({ targetUrl, body, requestTimeoutMs }) => {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), requestTimeoutMs);

      const response = await fetch(targetUrl, {
        method: "POST",
        credentials: "include",
        headers: {
          "content-type": "application/json",
          accept: "application/json, text/plain, */*"
        },
        body: JSON.stringify(body),
        signal: controller.signal
      });

      clearTimeout(timeoutId);
      const text = await response.text();
      return { status: response.status, text };
    },
    { targetUrl: url, body: payload, requestTimeoutMs: timeoutMs }
  );
}

async function getJson(page, url, timeoutMs = 30000) {
  const response = await page.evaluate(async ({ targetUrl, requestTimeoutMs }) => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), requestTimeoutMs);

    const response = await fetch(targetUrl, {
      credentials: "include",
      headers: {
        accept: "application/json, text/plain, */*"
      },
      signal: controller.signal
    });

    clearTimeout(timeoutId);
    const text = await response.text();
    return { status: response.status, text };
  }, { targetUrl: url, requestTimeoutMs: timeoutMs });

  return parseHttpJson(response, `GET ${url}`);
}

function parseHttpJson(response, operation) {
  const status = Number(response && response.status);
  const text = String((response && response.text) || "");
  if (!Number.isInteger(status) || status < 200 || status >= 300) {
    const summary = text.replace(/\s+/g, " ").trim().slice(0, 500);
    throw new Error(`${operation} falhou com HTTP ${status || "desconhecido"}${summary ? `: ${summary}` : ""}`);
  }

  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${operation} retornou JSON invalido (HTTP ${status}).`);
  }
}

async function fetchRequest(page, processInstanceId) {
  return getJson(page, `/process-management/api/v2/requests/${processInstanceId}?expand=formFields`);
}

async function fetchAttachments(page, processInstanceId) {
  return getJson(page, `/process-management/api/v2/requests/${processInstanceId}/attachments`);
}

async function fetchHistories(page, processInstanceId) {
  return getJson(page, `/process-management/api/v2/requests/${processInstanceId}/histories?page=1&pageSize=1000`);
}

async function fetchDetails(page, processInstanceId, taskUserId) {
  const response = await postJson(page, "/ecm/api/rest/ecm/workflowView/findDetailsMyRequests", {
    processInstanceId: Number(processInstanceId),
    taskUserId
  });

  return parseHttpJson(response, "Consulta de detalhes da solicitacao Fluig");
}

async function uploadFile(page, filePath, uploadName, timeoutMs = 30000) {
  const fileBuffer = await fs.promises.readFile(filePath);
  const payload = {
    name: uploadName || filePath.split(/[/\\]/).pop(),
    contentBase64: fileBuffer.toString("base64")
  };

  return page.evaluate(async ({ fileName, base64, requestTimeoutMs }) => {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }

    const formData = new FormData();
    formData.append("files[]", new File([bytes], fileName, { type: "application/octet-stream" }));

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), requestTimeoutMs);
    const response = await fetch("/ecm/upload", {
      method: "POST",
      credentials: "include",
      body: formData,
      signal: controller.signal
    });

    clearTimeout(timeoutId);
    return response.json();
  }, { fileName: payload.name, base64: payload.contentBase64, requestTimeoutMs: timeoutMs });
}

async function downloadAttachment(page, processInstanceId, attachmentSequence, filePath, timeoutMs = 30000) {
  const result = await page.evaluate(async ({ requestId, sequence, requestTimeoutMs }) => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), requestTimeoutMs);
    const response = await fetch(
      `/process-management/api/v2/requests/${requestId}/attachments/${sequence}/download`,
      {
        credentials: "include",
        signal: controller.signal
      }
    );

    clearTimeout(timeoutId);
    const buffer = await response.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    let binary = "";
    for (let index = 0; index < bytes.byteLength; index += 1) {
      binary += String.fromCharCode(bytes[index]);
    }

    return {
      status: response.status,
      contentType: response.headers.get("content-type") || "application/octet-stream",
      base64: btoa(binary)
    };
  }, { requestId: processInstanceId, sequence: attachmentSequence, requestTimeoutMs: timeoutMs });

  if (!Number.isInteger(result.status) || result.status < 200 || result.status >= 300) {
    throw new Error(`Download do anexo Fluig falhou com HTTP ${result.status || "desconhecido"}.`);
  }
  await fs.promises.writeFile(filePath, Buffer.from(result.base64, "base64"));
  return result;
}

function buildFormData(formFields) {
  return Object.entries(formFields).map(([name, value]) => ({
    name,
    value: value == null ? "" : String(value)
  }));
}

function buildNewAttachment(fileName, taskUserId) {
  return {
    id: 1,
    fullPath: "BPM",
    droppedZipZone: false,
    name: fileName,
    newAttach: true,
    description: fileName,
    documentId: 0,
    attachedUser: "Administrativo DVA CD",
    attachedActivity: "Anexar NF para Central de Lançamento",
    attachments: [
      {
        attach: false,
        principal: true,
        fileName
      }
    ],
    hasOwnSubMenu: true,
    enablePublish: false,
    enableEdit: false,
    enableEditContent: false,
    enableDownload: false,
    hasMoreOptions: false,
    classSubMenu: "fs-display-flex fs-justify-content-flex-end",
    iconClass: "fluigicon-file-upload",
    iconUrl: false,
    colleagueId: taskUserId
  };
}

async function sendNewRequest(page, payload) {
  const response = await postJson(page, "/ecm/api/rest/ecm/workflowView/send", payload);
  return parseHttpJson(response, "Envio da nova solicitacao Fluig");
}

async function cancelRequest(page, processInstanceId, taskUserId, cancelText) {
  const response = await postJson(page, "/ecm/api/rest/ecm/workflowView/cancelInstance/", {
    processInstanceId: Number(processInstanceId),
    taskUserId,
    cancelText
  });

  return parseHttpJson(response, "Cancelamento da solicitacao Fluig");
}

module.exports = {
  fetchRequest,
  fetchAttachments,
  fetchHistories,
  fetchDetails,
  uploadFile,
  downloadAttachment,
  buildFormData,
  buildNewAttachment,
  sendNewRequest,
  cancelRequest,
  __test: {
    parseHttpJson
  }
};
