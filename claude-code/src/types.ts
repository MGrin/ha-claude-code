export interface SessionInfo {
  id: string;
  title: string;
  createdAt: string;
  lastModified: string;
  messageCount: number;
}

export interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: string;
  toolUse?: ToolUseInfo[];
}

export interface ToolUseInfo {
  name: string;
  input: unknown;
  result?: string;
}

export interface UsageInfo {
  fiveHour?: {
    usedPercentage: number;
    resetsAt: number;
  };
  sevenDay?: {
    usedPercentage: number;
    resetsAt: number;
  };
  status: "ok" | "warning" | "blocked";
  blockedUntil?: number;
}

export interface AuthStatus {
  authenticated: boolean;
  message?: string;
}
