"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  fluigAdmApi,
  type FluigAdmJobSummary,
  type FluigJobStatusResponse,
} from "@/lib/fluig-api";

export const terminalFluigJobStatuses = new Set(["success", "error", "cancelled", "expired"]);

export function isTerminalFluigJob(job: Pick<FluigAdmJobSummary, "status"> | null | undefined) {
  return Boolean(job && terminalFluigJobStatuses.has(job.status));
}

export function isActiveFluigJob(job: Pick<FluigAdmJobSummary, "status"> | null | undefined) {
  return Boolean(job && !isTerminalFluigJob(job));
}

const defaultFluigPollBackoffMs = [2_000, 5_000, 10_000, 15_000] as const;
const defaultFluigPollTimeoutMs = 15 * 60 * 1_000;

type PollOptions = {
  backoffMs?: readonly number[];
  intervalMs?: number;
  timeoutMs?: number;
};

type SharedPollSession = {
  controller: AbortController;
  listeners: Map<symbol, (payload: FluigJobStatusResponse) => void>;
  promise: Promise<FluigJobStatusResponse>;
};

const activeFluigPolls = new Map<string, SharedPollSession>();

export function fluigPollDelayMs(attempt: number, options: PollOptions = {}) {
  const configured = options.backoffMs?.length
    ? options.backoffMs
    : options.intervalMs
      ? [options.intervalMs, 5_000, 10_000, 15_000]
      : defaultFluigPollBackoffMs;
  const index = Math.min(Math.max(attempt, 0), configured.length - 1);
  return Math.max(50, Number(configured[index] || configured[configured.length - 1] || 2_000));
}

function abortError() {
  return new DOMException("Acompanhamento do job Fluig cancelado.", "AbortError");
}

function waitForDelay(delayMs: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      reject(abortError());
      return;
    }

    const timeout = globalThis.setTimeout(done, delayMs);
    function done() {
      signal.removeEventListener("abort", cancelled);
      resolve();
    }
    function cancelled() {
      globalThis.clearTimeout(timeout);
      reject(abortError());
    }
    signal.addEventListener("abort", cancelled, { once: true });
  });
}

function waitForVisibleDocument(signal: AbortSignal) {
  if (typeof document === "undefined" || document.visibilityState !== "hidden") {
    return Promise.resolve();
  }

  return new Promise<void>((resolve, reject) => {
    function cleanup() {
      document.removeEventListener("visibilitychange", visibilityChanged);
      signal.removeEventListener("abort", cancelled);
    }
    function visibilityChanged() {
      if (document.visibilityState === "hidden") return;
      cleanup();
      resolve();
    }
    function cancelled() {
      cleanup();
      reject(abortError());
    }
    document.addEventListener("visibilitychange", visibilityChanged);
    signal.addEventListener("abort", cancelled, { once: true });
  });
}

async function runFluigPoll(
  jobId: string,
  session: Pick<SharedPollSession, "controller" | "listeners">,
  options: PollOptions
) {
  const startedAt = Date.now();
  const timeoutMs = Math.max(1_000, options.timeoutMs || defaultFluigPollTimeoutMs);
  let attempt = 0;

  while (!session.controller.signal.aborted) {
    await waitForVisibleDocument(session.controller.signal);
    if (Date.now() - startedAt >= timeoutMs) {
      throw new Error("Tempo limite excedido ao acompanhar o job Fluig. Atualize o status manualmente.");
    }

    const payload = await fluigAdmApi.getJob(jobId);
    for (const listener of session.listeners.values()) listener(payload);
    if (isTerminalFluigJob(payload.job)) return payload;

    await waitForDelay(fluigPollDelayMs(attempt, options), session.controller.signal);
    attempt += 1;
  }

  throw abortError();
}

function sharedFluigPoll(jobId: string, options: PollOptions) {
  const current = activeFluigPolls.get(jobId);
  if (current) return current;

  const session: SharedPollSession = {
    controller: new AbortController(),
    listeners: new Map(),
    promise: null as unknown as Promise<FluigJobStatusResponse>,
  };
  session.promise = runFluigPoll(jobId, session, options).finally(() => {
    if (activeFluigPolls.get(jobId) === session) activeFluigPolls.delete(jobId);
  });
  activeFluigPolls.set(jobId, session);
  return session;
}

export async function waitForFluigJob(
  jobId: string,
  options: {
    signal?: AbortSignal;
    intervalMs?: number;
    backoffMs?: readonly number[];
    timeoutMs?: number;
    onUpdate?: (payload: FluigJobStatusResponse) => void;
  } = {}
) {
  if (options.signal?.aborted) throw abortError();

  const session = sharedFluigPoll(jobId, options);
  const listenerId = Symbol(jobId);
  session.listeners.set(listenerId, options.onUpdate || (() => undefined));

  return new Promise<FluigJobStatusResponse>((resolve, reject) => {
    let settled = false;
    function cleanup() {
      if (settled) return;
      settled = true;
      session.listeners.delete(listenerId);
      options.signal?.removeEventListener("abort", cancelled);
      if (!session.listeners.size && activeFluigPolls.get(jobId) === session) {
        session.controller.abort();
      }
    }
    function cancelled() {
      cleanup();
      reject(abortError());
    }

    options.signal?.addEventListener("abort", cancelled, { once: true });
    session.promise.then(
      (payload) => {
        if (settled) return;
        cleanup();
        resolve(payload);
      },
      (error) => {
        if (settled) return;
        cleanup();
        reject(error);
      }
    );
  });
}

export async function waitForFluigJobs(
  jobs: readonly Pick<FluigAdmJobSummary, "id">[],
  options: {
    signal?: AbortSignal;
    intervalMs?: number;
    backoffMs?: readonly number[];
    timeoutMs?: number;
    onUpdate?: (job: FluigAdmJobSummary) => void;
  } = {}
) {
  const results = await Promise.all(
    jobs.map((job) =>
      waitForFluigJob(job.id, {
        signal: options.signal,
        intervalMs: options.intervalMs,
        backoffMs: options.backoffMs,
        timeoutMs: options.timeoutMs,
        onUpdate: (payload) => options.onUpdate?.(payload.job),
      })
    )
  );
  const failed = results.find(({ job }) => job.status !== "success");
  if (failed) {
    throw new Error(
      failed.job.errorMessage ||
        failed.job.progressLabel ||
        `Job Fluig finalizado com status ${failed.job.status}.`
    );
  }
  return results;
}

export function useFluigJobState(options: {
  matches: (job: FluigAdmJobSummary) => boolean;
  recover?: boolean;
  recoverRecentTerminal?: boolean;
  intervalMs?: number;
}) {
  const { matches, recover = true, recoverRecentTerminal = false, intervalMs } = options;
  const [job, setJob] = useState<FluigAdmJobSummary | null>(null);
  const [events, setEvents] = useState<FluigJobStatusResponse["events"]>([]);
  const [recovering, setRecovering] = useState(recover);
  const mountedRef = useRef(true);
  const manualWaitJobIdRef = useRef<string | null>(null);

  const applyPayload = useCallback((payload: FluigJobStatusResponse) => {
    if (!mountedRef.current) return;
    setJob(payload.job);
    setEvents(payload.events || []);
  }, []);

  const track = useCallback((nextJob: FluigAdmJobSummary | null) => {
    setJob(nextJob);
    if (!nextJob) setEvents([]);
  }, []);

  const wait = useCallback(
    async (nextJob: FluigAdmJobSummary | string) => {
      const jobId = typeof nextJob === "string" ? nextJob : nextJob.id;
      if (typeof nextJob !== "string") track(nextJob);
      manualWaitJobIdRef.current = jobId;
      try {
        const payload = await waitForFluigJob(jobId, { intervalMs, onUpdate: applyPayload });
        if (payload.job.status !== "success") {
          throw new Error(
            payload.job.errorMessage ||
              payload.job.progressLabel ||
              `Job Fluig finalizado com status ${payload.job.status}.`
          );
        }
        return payload;
      } finally {
        if (manualWaitJobIdRef.current === jobId) manualWaitJobIdRef.current = null;
      }
    },
    [applyPayload, intervalMs, track]
  );

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!recover) return;

    let cancelled = false;
    void fluigAdmApi
      .listJobs(50)
      .then(async ({ jobs }) => {
        if (cancelled) return;
        const matchingJobs = jobs.filter((candidate) => matches(candidate));
        const recovered =
          matchingJobs.find((candidate) => isActiveFluigJob(candidate)) ||
          (recoverRecentTerminal ? matchingJobs[0] : null);
        if (!recovered) return;
        setJob(recovered);
        const detail = await fluigAdmApi.getJob(recovered.id);
        if (!cancelled) applyPayload(detail);
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setRecovering(false);
      });

    return () => {
      cancelled = true;
    };
  }, [applyPayload, matches, recover, recoverRecentTerminal]);

  const trackedJobId = job?.id || null;
  const trackedJobIsTerminal = isTerminalFluigJob(job);
  useEffect(() => {
    if (!trackedJobId || trackedJobIsTerminal) return;
    if (manualWaitJobIdRef.current === trackedJobId) return;
    const controller = new AbortController();
    void waitForFluigJob(trackedJobId, {
      signal: controller.signal,
      intervalMs,
      onUpdate: applyPayload,
    }).catch((error) => {
      if (error instanceof DOMException && error.name === "AbortError") return;
    });
    return () => controller.abort();
  }, [applyPayload, intervalMs, trackedJobId, trackedJobIsTerminal]);

  return {
    job,
    events,
    active: isActiveFluigJob(job),
    terminal: isTerminalFluigJob(job),
    recovering,
    track,
    wait,
    clear: () => track(null),
  };
}
