import type { Context } from '@deepseek-ai/cordis';
import type { SkillResourceBase } from '../domain/types.js';

// DSH exposes dynamically composed services; these are the APIs this plugin uses.
type HostCall = (...args: any[]) => any;
type HostLayers = { merge: HostCall; chainLayers?: HostCall; global?: any };
type HostToolSchema = { name: string; description: string; parameters: Record<string, unknown>; deferLoading?: true };
export type HostToolDefinition = HostToolSchema & { output: unknown; execute: (args: unknown, context: unknown) => Promise<unknown> };
type HostToolActivation = { agent: object; modelSelection: unknown; signal: AbortSignal };
type HostToolRegistration = { definition: HostToolDefinition; when?: (context: HostToolActivation) => boolean | Promise<boolean> };
type HostToolLayer = { tools: { get(name: string): HostToolRegistration | undefined }; admits(name: string): boolean };
export interface HostSkillSummary {
  name: string;
  description: string;
  path?: string;
  source: string;
  provider: string;
  invocation: { modelInvocable: boolean; userInvocable: boolean };
  resourceBase?: SkillResourceBase;
}
export interface HostSkillDefinition extends HostSkillSummary { content: string; metadata?: Readonly<Record<string, unknown>> }
export type SkillOptions = { cwd?: string; signal?: AbortSignal; scope?: object };
export interface HostFileSystem {
  resolve(path: string, options?: { cwd?: string; signal?: AbortSignal }): Promise<{ targetKey?: unknown } & object>;
  stat(target: unknown, signal?: AbortSignal): Promise<{ type: string; size?: number } | undefined>;
  streamText(target: unknown, signal?: AbortSignal): Promise<AsyncIterable<string>>;
}
export interface HostPresetRow { id: string; name: string; broken?: string }

export interface HostTools {
  schemas(scope?: object): HostToolSchema[];
  get(name: string, scope?: object): HostToolDefinition | undefined;
  register(definition: HostToolDefinition, options?: { when?: HostToolRegistration['when'] }): () => void;
  restrict(filter: { allow?: string[]; deny?: string[] }): () => void;
  resolve(context: HostToolActivation): Promise<{ dispose(): void }>;
  // DSH 0.2.2 private implementation; recheck when upgrading the host.
  layers: { global: HostToolLayer; chainLayers(scope?: object): HostToolLayer[] };
}

export type HostContext = Context & {
  loader: { entries: HostCall; root: any; ctx?: any };
  tools: HostTools;
  systemPrompt: { layers: HostLayers; assemble: HostCall; section: HostCall; context: HostCall; variable: HostCall; getSectionOrder: HostCall };
  skills: { layers: HostLayers; revision: unknown; snapshot(options?: SkillOptions): Promise<{ skills: HostSkillSummary[]; complete: boolean }>; get(name: string, options?: SkillOptions): Promise<HostSkillDefinition | undefined>; registerProvider: HostCall; invalidateCache: HostCall };
  agentPresets: { register: HostCall; list(): Promise<HostPresetRow[]>; acquireScope: HostCall; composedPreset: HostCall; select: HostCall; presetForSession: HostCall; defaultId: HostCall; resolve: HostCall; serviceFor: HostCall; readDocument: HostCall; inspectCompositions: HostCall };
  agents: { list: HostCall; get: HostCall; turnBoundaryOf: HostCall };
  sessions: { flush: HostCall; prepare: HostCall; get: HostCall; list: HostCall };
  sessionPersistence: { open: HostCall };
  sessionProjections: { snapshot: HostCall; register: HostCall };
  get: (name: string) => any;
};
