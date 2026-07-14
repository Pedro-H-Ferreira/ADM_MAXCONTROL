type FluigJobForErrorResolution = {
  module: string;
  operation: string;
  status: string;
  updatedAt: string;
  finishedAt?: string | null;
};

function jobTimestamp(job: FluigJobForErrorResolution) {
  const timestamp = Date.parse(job.finishedAt || job.updatedAt || "");
  return Number.isFinite(timestamp) ? timestamp : 0;
}

export function actionableRecentFluigJobFailures<T extends FluigJobForErrorResolution>(
  jobs: T[],
  options: { now?: number; windowMs?: number } = {}
) {
  const now = options.now ?? Date.now();
  const windowMs = options.windowMs ?? 24 * 60 * 60 * 1000;
  const successes = jobs.filter((job) => job.status === "success");

  return jobs.filter((job) => {
    if (job.status !== "error" && job.status !== "expired") return false;
    const failedAt = jobTimestamp(job);
    if (!failedAt || now - failedAt > windowMs) return false;

    return !successes.some(
      (success) =>
        success.module === job.module &&
        success.operation === job.operation &&
        jobTimestamp(success) > failedAt
    );
  });
}
