import type { UsageInfo } from "./types";

let cachedUsage: UsageInfo = { status: "ok" };
let lastFetch = 0;

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
    cachedUsage.fiveHour = { usedPercentage: utilization * 100, resetsAt };
  } else if (
    type === "seven_day" ||
    type === "seven_day_opus" ||
    type === "seven_day_sonnet"
  ) {
    cachedUsage.sevenDay = { usedPercentage: utilization * 100, resetsAt };
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

async function getAccessToken(): Promise<string | null> {
  try {
    const file = Bun.file("/data/.claude/.credentials.json");
    if (!(await file.exists())) return null;
    const creds = await file.json();
    return creds?.claudeAiOauth?.accessToken || null;
  } catch {
    return null;
  }
}

async function fetchUsageFromApi(): Promise<void> {
  const token = await getAccessToken();
  if (!token) return;

  try {
    const res = await fetch("https://api.anthropic.com/api/oauth/usage", {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return;
    const data = await res.json();

    // The endpoint returns utilization data for different windows
    if (data.five_hour != null) {
      cachedUsage.fiveHour = {
        usedPercentage: (data.five_hour ?? 0) * 100,
        resetsAt: data.five_hour_resets_at ?? 0,
      };
    }
    if (data.seven_day != null) {
      cachedUsage.sevenDay = {
        usedPercentage: (data.seven_day ?? 0) * 100,
        resetsAt: data.seven_day_resets_at ?? 0,
      };
    }

    // Also handle alternative response formats
    if (data.utilization != null && !cachedUsage.fiveHour) {
      cachedUsage.fiveHour = {
        usedPercentage: (data.utilization ?? 0) * 100,
        resetsAt: data.resets_at ?? 0,
      };
    }

    lastFetch = Date.now();
  } catch {
    // Silently fail — usage is non-critical
  }
}

export async function getUsage(): Promise<UsageInfo> {
  // Fetch from API if cache is older than 60 seconds
  if (Date.now() - lastFetch > 60_000) {
    await fetchUsageFromApi();
  }
  return { ...cachedUsage };
}
