import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { fail } from '../domain/core.js';
import type { Preset, SnapshotEntry, WorkshopState } from '../domain/types.js';
import { snapshotSettings, historyFor, snapshotView, viewSummary, snapshotDiff, diffLines } from '../history/history.js';
import type { PresetWorkshop } from './index.js';

type PreviewContext = { cwd?: string; sessionId?: string; language?: string };
type HistoryInput = PreviewContext & { id: string; snapshotId?: string; draft?: Partial<Preset> };

export async function recordSnapshot(this: PresetWorkshop, next: WorkshopState, previous?: Preset, reason?: SnapshotEntry['reason'], input: PreviewContext = {}) {
  if (!previous || !reason || !snapshotSettings(next.config).enabled && reason !== 'restore') return [];
  const reserved = [...this.deletedSnapshots.values()].filter(row => row.presetId === previous.id && row.expiresAt > Date.now()).length;
  const capacity = snapshotSettings(next.config).limit - reserved;
  if (capacity < 1) fail('snapshot-undo-pending', '删除撤销仍在计时，请稍后再保存或还原。', 409);
  const view = snapshotView(previous, await this.preview({ id: previous.id, cwd: input.cwd, sessionId: input.sessionId, language: input.language }, previous));
  const entry = { id: randomUUID(), createdAt: new Date().toISOString(), reason, summary: viewSummary(view) };
  next.histories ??= {};
  next.histories[previous.id] = [entry, ...historyFor(next, previous.id)].slice(0, capacity);
  return [{ presetId: previous.id, id: entry.id, value: { preset: previous, view } }];
}

export async function cleanupSnapshots(this: PresetWorkshop, id: string) {
  const keep = [...this.deletedSnapshots.values()].filter(row => row.presetId === id).map(row => row.entry.id);
  try { await this.store.pruneSnapshots(id, keep); }
  catch (error) { this.ctx.logger.warn('Snapshot cleanup: %s', error.message); }
}

export async function history(this: PresetWorkshop, input: HistoryInput, detail = false) {
  if (!detail && !historyFor(this.store.state, input.id).length) { this.preset(input.id); return { records: [], draft: false }; }
  const preset = this.preset(input.id), current = input.draft ? await this.validatedPreset({ ...preset, ...input.draft }, preset) : preset;
  const context = input.sessionId && input.id === this.store.state.config.selectedPresetId
    ? { sessionId: input.sessionId }
    : { cwd: input.cwd };
  const right = snapshotView(current, await this.preview({ ...context, language: input.language, id: preset.id }, current));
  const isDraft = input.draft && !isDeepStrictEqual({ ...current, revision: preset.revision }, preset);
  if (!detail) {
    const records = [];
    for (const entry of historyFor(this.store.state, preset.id)) {
      const { view } = await this.store.readSnapshot(preset.id, entry.id);
      records.push({ ...entry, changes: snapshotDiff(view, right).count });
    }
    return { records, draft: Boolean(isDraft) };
  }
  const entry = historyFor(this.store.state, preset.id).find(row => row.id === input.snapshotId);
  if (!entry) fail('snapshot-not-found', 'Snapshot no longer exists', 404);
  const { view: left } = await this.store.readSnapshot(preset.id, entry.id);
  const userNames = [...new Set([...left.user, ...right.user].map(row => row.name))];
  const users = userNames.map(name => {
    const before = left.user.find(row => row.name === name), after = right.user.find(row => row.name === name);
    return { name, label: before?.label ?? after.label, changed: before?.text !== after?.text, lines: diffLines(before?.text ?? '', after?.text ?? '') };
  });
  return { entry, revision: preset.revision, left, right, draft: Boolean(isDraft), diff: snapshotDiff(left, right), systemLines: diffLines(left.system, right.system), users };
}
