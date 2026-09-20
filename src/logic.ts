import type { Cue, Gel } from "./types";

export const mmToLabel = (m: number) =>
  `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

export const hhmmToMinutes = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
};

/** 参与排演校验的 Cue（已取消 / 已结束的不参与占用） */
export const inPlay = (cues: Cue[]) =>
  cues.filter((c) => c.status === "pending" || c.status === "active");

/** 某色片当前被已领用占用的数量 */
export const checkedOutQty = (cues: Cue[], gelId: string) =>
  inPlay(cues).reduce(
    (sum, c) =>
      sum + c.gels.filter((g) => g.gelId === gelId && g.checkedOut).reduce((s, g) => s + g.qty, 0),
    0
  );

/** 色片可用上限 = 在库 + 已领出（领出的部分仍属本次排演可支配库存） */
export const gelCapacity = (cues: Cue[], gels: Gel[], gelId: string) => {
  const gel = gels.find((g) => g.id === gelId);
  return (gel?.stock ?? 0) + checkedOutQty(cues, gelId);
};

interface GelInterval {
  cue: Cue;
  qty: number;
  start: number;
  end: number;
}

const gelIntervals = (cues: Cue[], gelId: string): GelInterval[] =>
  inPlay(cues).flatMap((cue) =>
    cue.gels
      .filter((g) => g.gelId === gelId)
      .map((g) => ({ cue, qty: g.qty, start: cue.start, end: cue.end }))
  );

/**
 * 整次排演校验（纯函数，不改动任何状态）：
 * 1. 同一色片被时间窗口重叠的 Cue 重复领用 → 失败
 * 2. 任一时段该色片需求超过可用库存 → 失败
 */
export function validateRehearsal(cues: Cue[], gels: Gel[]): string[] {
  const errors: string[] = [];
  const gelIds = [...new Set(inPlay(cues).flatMap((c) => c.gels.map((g) => g.gelId)))];

  for (const gelId of gelIds) {
    const gel = gels.find((g) => g.id === gelId);
    if (!gel) {
      errors.push(`色片 ${gelId} 在库存中不存在`);
      continue;
    }
    const capacity = gelCapacity(cues, gels, gelId);
    const intervals = gelIntervals(cues, gelId).sort(
      (a, b) => a.start - b.start || a.end - b.end
    );

    // 重叠 Cue 重复领用同一色片
    for (let i = 0; i < intervals.length; i++) {
      for (let j = i + 1; j < intervals.length && intervals[j].start < intervals[i].end; j++) {
        const a = intervals[i];
        const b = intervals[j];
        const lo = Math.max(a.start, b.start);
        const hi = Math.min(a.end, b.end);
        errors.push(
          `色片 ${gel.id}「${gel.name}」被「${a.cue.name}」与「${b.cue.name}」在 ${mmToLabel(
            lo
          )}–${mmToLabel(hi)} 重叠时段重复领用`
        );
      }
    }

    // 时段库存扫描（[start, end) 半开区间，终点事件先于同刻起点事件处理）
    const events = intervals
      .flatMap((it) => [
        { t: it.start, d: it.qty },
        { t: it.end, d: -it.qty },
      ])
      .sort((a, b) => a.t - b.t || a.d - b.d);
    let cur = 0;
    const reported = new Set<number>();
    for (const e of events) {
      cur += e.d;
      if (cur > capacity && !reported.has(e.t)) {
        reported.add(e.t);
        errors.push(
          `色片 ${gel.id}「${gel.name}」在 ${mmToLabel(e.t)} 起需求 ${cur} 张，超出可用库存 ${capacity} 张`
        );
      }
    }
  }
  return errors;
}

/** 某色片在 UI 上需要标红的冲突 Cue id 集合（重叠领用） */
export function conflictCueIds(cues: Cue[], gelId: string): Set<string> {
  const ids = new Set<string>();
  const intervals = gelIntervals(cues, gelId).sort(
    (a, b) => a.start - b.start || a.end - b.end
  );
  for (let i = 0; i < intervals.length; i++) {
    for (let j = i + 1; j < intervals.length && intervals[j].start < intervals[i].end; j++) {
      ids.add(intervals[i].cue.id);
      ids.add(intervals[j].cue.id);
    }
  }
  return ids;
}

export interface ReturnLine {
  key: string; // cueId:gelId
  cueId: string;
  cueName: string;
  gelId: string;
  gelName: string;
  color: string;
  qty: number;
  opened: boolean;
}

/** 收集一组 Cue 中已领用、待退还的色片行 */
export function collectReturnLines(cues: Cue[], gels: Gel[], cueIds: string[]): ReturnLine[] {
  return cues
    .filter((c) => cueIds.includes(c.id))
    .flatMap((c) =>
      c.gels
        .filter((g) => g.checkedOut)
        .map((g) => {
          const gel = gels.find((x) => x.id === g.gelId);
          return {
            key: `${c.id}:${g.gelId}`,
            cueId: c.id,
            cueName: c.name,
            gelId: g.gelId,
            gelName: gel ? `${gel.id}「${gel.name}」` : g.gelId,
            color: gel?.color ?? "#94a3b8",
            qty: g.qty,
            opened: g.opened,
          };
        })
    );
}
