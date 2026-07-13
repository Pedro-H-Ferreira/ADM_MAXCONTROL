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

export async function waitForFluigJob(
  jobId: string,
  options: {
    signal?: AbortSignal;
    intervalMs?: number;
    onUpdate?: (payload: FluigJobStatusResponse) => void;
  } = {}
) {
  const intervalMs = Math.max(500, options.intervalMs || 2_000);

  while (!options.signal?.aborted) {
    const payload = await fluigAdmApi.getJob(jobId);
    options.onUpdate?.(payload);
    if (isTerminalFluigJob(payload.job)) return payload;

    await new Promise<void>((resolve) => {
      const onAbort = () => {
        window.clearTimeout(timeout);
        resolve();
      };
      const timeout = window.setTimeout(() => {
        options.signal?.removeEventListener("abort", onAbort);
        resolve();
      }, intervalMs);
      options.signal?.addEventListener("abort", onAbort, { once: true });
    });
  }

  throw new DOMException("Acompanhamento do job Fluig cancelado.", "AbortError");
}

export async function waitForFluigJobs(
  jobs: readonly Pick<FluigAdmJobSummary, "id">[],
  options: {
    signal?: AbortSignal;
    intervalMs?: number;
    onUpdate?: (job: FluigAdmJobSummary) => void;
  } = {}
) {
  const results = await Promise.all(
    jobs.map((job) =>
      waitForFluigJob(job.id, {
        signal: options.signal,
        intervalMs: options.intervalMs,
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
  const { matches, recover = true, recoverRecentTerminal = false, intervalMs = 2_000 } = options;
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
