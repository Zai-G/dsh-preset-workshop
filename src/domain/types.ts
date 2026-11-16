export interface PromptSection {
  text: string;
  order: number;
  enabled: boolean;
  custom?: boolean;
  inherit?: boolean;
  role?: 'system' | 'user';
}

export interface ToolOverride {
  prompt?: string;
  promptEnabled?: boolean;
  schema?: ToolSchema;
}

export interface ToolSchema {
  type: string;
  function: { name: string; description: string; parameters: Record<string, unknown> };
}

export interface Preset {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  builtin: boolean;
  revision: number;
  prompt: { persona: string; sections: Record<string, PromptSection> };
  tools: { enabled: string[]; packages: string[]; overrides: Record<string, ToolOverride>; sources: Record<string, string> };
  skills: string[];
  mcp: McpServer[];
  mcpEnabled: Record<string, boolean>;
}

export interface McpServer {
  serverName: string;
  transport: 'stdio' | 'streamable-http';
  enabled?: boolean;
  command?: string;
  args?: string[];
  env?: Record<string, unknown>;
  cwd?: string;
  url?: string;
  headers?: Record<string, unknown>;
  reconnect?: { enabled?: boolean; initialDelayMs?: number; maxDelayMs?: number; maxAttempts?: number };
  toolCallTimeoutMs?: number;
  maxInstructionBytes?: number;
  failOnStartupError?: boolean;
}

export interface ImportEdits {
  id?: string;
  name?: string;
  description?: string;
  persona?: string;
  tools?: string[];
  skills?: string[];
  custom?: Record<string, string>;
}

export interface SkillGroup { id: string; name: string; skills: string[] }
export type SkillResourceBase = { kind: 'directory'; path: string } | { kind: 'url'; url: string } | { kind: 'opaque'; description: string };
export interface SnapshotSummary { tools: number; mcp: number; skills: number; tokens: { min: number; max: number } }
export interface SnapshotEntry { id: string; createdAt: string; reason: 'save' | 'reset' | 'restore' | 'import'; summary: SnapshotSummary }
export interface SnapshotView {
  system: string;
  user: { name: string; label: string; text: string }[];
  tools: { name: string; source: string; override: ToolOverride }[];
  toolCount: number;
  mcp: { name: string; config: McpServer | Record<string, never>; tools: { name: string; override: ToolOverride }[] }[];
  skills: { name: string }[];
  tokens: { min: number; max: number };
}
export interface WorkshopConfig {
  version: number;
  presetIds: string[];
  selectedPresetId: string;
  fallbackPresetId: string;
  polling: boolean;
  scanInterval: number;
  ui: Record<string, unknown>;
  skillGroups: SkillGroup[];
  snapshots: { enabled: boolean; limit: number };
  generation?: number;
  maxPresets?: number;
}
export interface WorkshopState { config: WorkshopConfig; presets: Preset[]; histories: Record<string, SnapshotEntry[]> }
