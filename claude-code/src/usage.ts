import type { UsageInfo } from "./types";

let cachedUsage: UsageInfo = { status: "ok" };

export function updateUsageFromRateLimit(rateLimitInfo: {
  status: string;
  resetsAt?: number;
  rateLimitType?: string;
  utilization?: number;
}) {
  const type = rateLimitInfo.rateLimitType;
  const utilization = rateLimitInfo.utilization ?? 0;
  const resetsAt = rateLimitInfo.resetsAt ?? 0;

  if (type === "five_hour") {
    cachedUsage.fiveHour = {
      usedPercentage: utilization * 100,
      resetsAt,
    };
  } else if (
    type === "seven_day" ||
    type === "seven_day_opus" ||
    type === "seven_day_sonnet"
  ) {
    cachedUsage.sevenDay = {
      usedPercentage: utilization * 100,
      resetsAt,
    };
  }

  if (rateLimitInfo.status === "rejected") {
    cachedUsage.status = "blocked";
    cachedUsage.blockedUntil = resetsAt;
  } else if (rateLimitInfo.status === "allowed_warning") {
    cachedUsage.status = "warning";
  } else {
    cachedUsage.status = "ok";
  }
}

export function getUsage(): UsageInfo {
  return { ...cachedUsage };
}
