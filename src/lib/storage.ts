import type { AppState, Cue, DraftRow } from "../types";
import { mergeRequests, overlaps, toMinutes } from "./scheduling";

/* 工作区附带状态（草稿 / 筛选 / 当前预览），同样持久化，刷新保留 */
export interface WorkspaceExtra {
  drafts: DraftRow[];
  typeFilter: string[];
  gelFilter: string[];
  previewCueId: string | null;
}

export const STORAGE_KEY = "cue-gel-loop:v1";

interface PersistShape {
  state: AppState;
  extra: WorkspaceExtra;
}

/* ---------------- 初始色片库存 ---------------- */

export const SEED_GELS: AppState["gels"] = [
  { code: "L101", name: "清光", color: "#f8fafc", stock: 24 },
  { code: "L201", name: "冷蓝 CTB", color: "#3b82f6", stock: 12 },
  { code: "L241", name: "荧光蓝", color: "#06b6d4", stock: 6 },
  { code: "L305", name: "玫瑰红", color: "#ec4899", stock: 8 },
  { code: "L412", name: "琥珀金", color: "#f59e0b", stock: 10 },
  { code: "L520", name: "嫩绿", color: "#22c55e", stock: 4 },
];

/* ---------------- 灯位图（x/y 为舞台平面百分比坐标） ---------------- */

export const SEED_FIXTURES: AppState["fixtures"] = [
  { id: "FOH-01", channel: 1, type: "面光", x: 18, y: 8, focus: "表演区左", brightness: 80, gelCode: "L412" },
  { id: "FOH-02", channel: 2, type: "面光", x: 50, y: 6, focus: "表演区中", brightness: 80, gelCode: "L412" },
  { id: "FOH-03", channel: 3, type: "面光", x: 82, y: 8, focus: "门口（追光走位待确认）", brightness: 100, gelCode: "L101" },
  { id: "SL-L1", channel: 21, type: "侧光", x: 6, y: 46, focus: "左台口", brightness: 65, gelCode: "L201" },
  { id: "SL-L2", channel: 22, type: "侧光", x: 6, y: 62, focus: "左台中", brightness: 65, gelCode: "L201" },
  { id: "SL-R1", channel: 25, type: "侧光", x: 94, y: 46, focus: "右台口", brightness: 65, gelCode: "L241" },
  { id: "SL-R2", channel: 26, type: "侧光", x: 94, y: 62, focus: "右台中", brightness: 65, gelCode: "L241" },
  { id: "BK-01", channel: 41, type: "逆光", x: 22, y: 92, focus: "后区剪影", brightness: 70, gelCode: "L305" },
  { id: "BK-02", channel: 42, type: "逆光", x: 50, y: 94, focus: "后区中央", brightness: 70, gelCode: "L305" },
  { id: "BK-03", channel: 43, type: "逆光", x: 78, y: 92, focus: "后区剪影", brightness: 70, gelCode: "L305" },
  { id: "FX-01", channel: 61, type: "效果光", x: 34, y: 30, focus: "舞台地面图案", brightness: 45, gelCode: "L520" },
  { id: "FX-02", channel: 62, type: "效果光", x: 66, y: 30, focus: "舞台地面图案", brightness: 45, gelCode: "L520" },
];

/* ---------------- 已排入的 Cue（Cue 12 / Cue 18 / Cue 24，无重叠） ---------------- */

export const SEED_CUES: Cue[] = [
  {
    id: "cue-seed-12",
    cueNo: "Cue 12",
    name: "冷蓝侧光",
    order: 1,
    start: "19:30",
    end: "19:45",
    brightness: 65,
    fixtureIds: ["SL-L1", "SL-L2"],
    gels: [
      { gelCode: "L201", qty: 4 },
      { gelCode: "L241", qty: 2 },
    ],
    note: "二幕开场",
  },
  {
    id: "cue-seed-18",
    cueNo: "Cue 18",
    name: "追光入场",
    order: 2,
    start: "20:00",
    end: "20:10",
    brightness: 100,
    fixtureIds: ["FOH-03"],
    gels: [{ gelCode: "L101", qty: 1 }],
    note: "需演员走位待确认",
  },
  {
    id: "cue-seed-24",
    cueNo: "Cue 24",
    name: "暖色谢幕",
    order: 3,
    start: "21:20",
    end: "21:35",
    brightness: 80,
    fixtureIds: ["FOH-01", "FOH-02", "FOH-03"],
    gels: [{ gelCode: "L412", qty: 6 }],
    note: "版本B",
  },
];

export const SEED_STATE: AppState = {
  showName: "夏夜排练场",
  versionNote: "版本 B · 二幕调度（2026-09-20 联排）",
  fixtures: SEED_FIXTURES,
  gels: SEED_GELS,
  cues: SEED_CUES,
  ledger: [],
};

export const SEED_EXTRA: WorkspaceExtra = {
  drafts: [],
  typeFilter: [],
  gelFilter: [],
  previewCueId: "cue-seed-12",
};

/* ---------------- 占用计算 ---------------- */

export interface GelOccupancy {
  /** 当前所有在排 Cue 的时间轴上，该色片的峰值同时领用需求 */
  peak: number;
  /** 领用该色片的 Cue 数 */
  cueCount: number;
}

export function gelOccupancy(cues: Cue[]): Map<string, GelOccupancy> {
  const result = new Map<string, GelOccupancy>();
  const eventsByGel = new Map<string, { time: number; delta: number }[]>();
  const cueSets = new Map<string, Set<string>>();

  for (const cue of cues) {
    for (const req of mergeRequests(cue.gels)) {
      const events = eventsByGel.get(req.gelCode) ?? [];
      events.push({ time: toMinutes(cue.start), delta: req.qty });
      events.push({ time: toMinutes(cue.end), delta: -req.qty });
      eventsByGel.set(req.gelCode, events);
      const set = cueSets.get(req.gelCode) ?? new Set<string>();
      set.add(cue.id);
      cueSets.set(req.gelCode, set);
    }
  }

  for (const [code, events] of eventsByGel) {
    events.sort((a, b) => a.time - b.time);
    let current = 0;
    let peak = 0;
    for (const ev of events) {
      current += ev.delta;
      peak = Math.max(peak, current);
    }
    result.set(code, { peak, cueCount: cueSets.get(code)?.size ?? 0 });
  }
  return result;
}

/** 判断一个灯是否被某个 Cue 使用 */
export function cueUsesFixture(cue: Cue, fixtureId: string): boolean {
  return cue.fixtureIds.includes(fixtureId);
}

/** 候选时间窗口是否与已有在排 Cue 冲突（用于表单内即时提示，不做库存结论） */
export function windowConflicts(cues: Cue[], start: string, end: string, gelCode: string): Cue[] {
  if (!start || !end || toMinutes(end) <= toMinutes(start)) return [];
  return cues.filter(
    (c) => overlaps(start, end, c.start, c.end) && c.gels.some((g) => g.gelCode === gelCode),
  );
}

/* ---------------- localStorage 同步 ---------------- */

export function loadWorkspace(): { state: AppState; extra: WorkspaceExtra } {
  const fallback = { state: structuredClone(SEED_STATE), extra: structuredClone(SEED_EXTRA) };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as PersistShape;
    const s = parsed.state;
    if (!s || !Array.isArray(s.fixtures) || !Array.isArray(s.gels) || !Array.isArray(s.cues)) {
      return fallback;
    }
    const state: AppState = {
      showName: s.showName ?? SEED_STATE.showName,
      versionNote: s.versionNote ?? SEED_STATE.versionNote,
      fixtures: s.fixtures,
      gels: s.gels,
      cues: s.cues,
      ledger: Array.isArray(s.ledger) ? s.ledger : [],
    };
    const e = parsed.extra ?? {};
    const extra: WorkspaceExtra = {
      drafts: Array.isArray(e.drafts) ? e.drafts : [],
      typeFilter: Array.isArray(e.typeFilter) ? e.typeFilter : [],
      gelFilter: Array.isArray(e.gelFilter) ? e.gelFilter : [],
      previewCueId: typeof e.previewCueId === "string" ? e.previewCueId : SEED_EXTRA.previewCueId,
    };
    return { state, extra };
  } catch {
    return fallback;
  }
}

export function saveWorkspace(state: AppState, extra: WorkspaceExtra): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ state, extra } satisfies PersistShape));
  } catch {
    // 隐私模式等场景下静默失败
  }
}

export function resetWorkspace(): { state: AppState; extra: WorkspaceExtra } {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
  return { state: structuredClone(SEED_STATE), extra: structuredClone(SEED_EXTRA) };
}
