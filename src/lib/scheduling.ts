import type { Cue, CueDraft, Gel, GelRequest, LedgerEntry, ReturnLine } from "../types";

/* ---------------- 时间工具 ---------------- */

/** "HH:MM" → 分钟数 */
export function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map((v) => parseInt(v, 10));
  return h * 60 + m;
}

/** 半开区间重叠判定：[aStart, aEnd) 与 [bStart, bEnd) */
export function overlaps(aStart: string, aEnd: string, bStart: string, bEnd: string): boolean {
  return toMinutes(aStart) < toMinutes(bEnd) && toMinutes(bStart) < toMinutes(aEnd);
}

export function fmt(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export function nowStamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/* ---------------- 合并同一 Cue 内重复的色片行 ---------------- */

export function mergeRequests(lines: GelRequest[]): GelRequest[] {
  const map = new Map<string, number>();
  for (const line of lines) {
    if (!line.gelCode || line.qty <= 0) continue;
    map.set(line.gelCode, (map.get(line.gelCode) ?? 0) + line.qty);
  }
  return Array.from(map, ([gelCode, qty]) => ({ gelCode, qty }));
}

/* ---------------- 整次排演校验 ---------------- */

export type IssueType = "window" | "double-book" | "shortage";

export interface RehearsalIssue {
  type: IssueType;
  gelCode?: string;
  message: string;
}

export interface Candidate {
  key: string; // 稳定标识（已有 Cue 或草稿行号）
  label: string; // Cue 12 · 冷蓝侧光
  cue: Cue;
  isDraft: boolean;
}

/**
 * 校验“整次排演”的全部候选 Cue（已排入 Cue + 本次草稿）。
 * 规则一：同一色片被两个时间窗口重叠的 Cue 重复领用 → 物理冲突。
 * 规则二：按时间轴切分时段，任一时段对某色片的叠加领用需求 > 库存 → 库存不足。
 * 任一失败即整单失败（返回 issues），调用方不得写入任何状态。
 */
export function validateRehearsal(candidates: Candidate[], gels: Gel[]): RehearsalIssue[] {
  const issues: RehearsalIssue[] = [];
  const gelMap = new Map(gels.map((g) => [g.code, g]));

  /* 结构校验 */
  for (const c of candidates) {
    const { cue } = c;
    if (!cue.cueNo.trim()) {
      issues.push({ type: "window", message: `存在未填写编号的 Cue（${cue.name || "未命名"}）` });
    }
    if (toMinutes(cue.end) <= toMinutes(cue.start)) {
      issues.push({
        type: "window",
        message: `${c.label} 的演出时间窗口无效：结束须晚于开始（${cue.start}–${cue.end}）`,
      });
    }
    for (const req of cue.gels) {
      if (!gelMap.has(req.gelCode)) {
        issues.push({ type: "shortage", gelCode: req.gelCode, message: `${c.label} 领用了不存在的色片型号 ${req.gelCode}` });
      }
      if (req.qty <= 0) {
        issues.push({ type: "shortage", gelCode: req.gelCode, message: `${c.label} 的色片 ${req.gelCode} 领用数量须大于 0` });
      }
    }
  }
  if (issues.length) return issues;

  /* 规则一：重叠窗口重复领用同一色片 */
  for (let i = 0; i < candidates.length; i++) {
    for (let j = i + 1; j < candidates.length; j++) {
      const a = candidates[i].cue;
      const b = candidates[j].cue;
      if (!overlaps(a.start, a.end, b.start, b.end)) continue;
      const codesA = new Set(a.gels.map((g) => g.gelCode));
      for (const g of b.gels) {
        if (codesA.has(g.gelCode)) {
          issues.push({
            type: "double-book",
            gelCode: g.gelCode,
            message: `色片 ${g.gelCode} 被重叠 Cue 重复领用：${candidates[i].label}（${a.start}–${a.end}）与 ${candidates[j].label}（${b.start}–${b.end}）`,
          });
        }
      }
    }
  }

  /* 规则二：时间轴扫描，任一时段叠加需求超过库存 */
  const byGel = new Map<string, { time: number; delta: number; label: string }[]>();
  for (const c of candidates) {
    for (const req of c.cue.gels) {
      const list = byGel.get(req.gelCode) ?? [];
      list.push({ time: toMinutes(c.cue.start), delta: req.qty, label: c.label });
      list.push({ time: toMinutes(c.cue.end), delta: -req.qty, label: c.label });
      byGel.set(req.gelCode, list);
    }
  }

  for (const [gelCode, events] of byGel) {
    const stock = gelMap.get(gelCode)?.stock ?? 0;
    events.sort((e1, e2) => e1.time - e2.time);
    let need = 0;
    for (let i = 0; i < events.length; ) {
      const t = events[i].time;
      let next = i;
      while (next < events.length && events[next].time === t) {
        need += events[next].delta;
        next++;
      }
      if (need > stock) {
        // 找到该需求水平结束的位置，给出连续时段
        let end = t;
        for (let k = next; k < events.length; k++) {
          if (events[k].delta < 0) {
            end = events[k].time;
            break;
          }
        }
        issues.push({
          type: "shortage",
          gelCode,
          message:
            end > t
              ? `时段 ${fmt(t)}–${fmt(end)} 色片 ${gelCode} 库存不足：需 ${need} 张 / 库存 ${stock} 张（缺 ${need - stock} 张）`
              : `色片 ${gelCode} 库存不足：峰值需 ${need} 张 / 库存 ${stock} 张（缺 ${need - stock} 张）`,
        });
      }
      i = next;
    }
  }

  return issues;
}

/** 校验通过后，把草稿转换为已排入 Cue（order 接续现有顺序末尾） */
export function commitDraft(draft: CueDraft, order: number, id: string): Cue {
  return {
    id,
    cueNo: draft.cueNo.trim(),
    name: draft.name.trim() || "未命名场景",
    order,
    start: draft.start,
    end: draft.end,
    brightness: draft.brightness,
    fixtureIds: draft.fixtureIds,
    gels: mergeRequests(draft.gels),
    note: draft.note.trim() || undefined,
  };
}

/* ---------------- 取消 Cue：未拆封全退 / 已拆封只退余料 ---------------- */

export interface CancelInput {
  gelCode: string;
  unopened: number; // 未拆封张数（全退，不产生损耗）
  opened: number; // 已拆封张数
  returnedLeftover: number; // 已拆封部分可退回的余料（张）
}

/**
 * 计算一次取消 Cue 的退库结果。
 * 损耗 = 已拆封 - 退回余料（夹在 [0, 已拆封] 内）；
 * 每行数量必须等于该 Cue 的领用数量，否则返回错误。
 */
export function buildReturnLines(cue: Cue, inputs: CancelInput[]): { lines?: ReturnLine[]; error?: string } {
  const lines: ReturnLine[] = [];
  for (const req of cue.gels) {
    const input = inputs.find((i) => i.gelCode === req.gelCode);
    const unopened = input?.unopened ?? 0;
    const opened = input?.opened ?? 0;
    const leftover = Math.max(0, Math.min(input?.returnedLeftover ?? 0, opened));
    if (unopened < 0 || opened < 0) {
      return { error: `色片 ${req.gelCode} 数量不能为负` };
    }
    if (unopened + opened !== req.qty) {
      return {
        error: `色片 ${req.gelCode} 登记不符：未拆封 ${unopened} + 已拆封 ${opened} 应等于领用 ${req.qty} 张`,
      };
    }
    if (leftover > opened) {
      return { error: `色片 ${req.gelCode} 余料退回不能超过已拆封张数` };
    }
    lines.push({
      gelCode: req.gelCode,
      qty: req.qty,
      unopened,
      opened,
      returnedLeftover: leftover,
      loss: opened - leftover,
    });
  }
  return { lines };
}

/** 取消 Cue 后需要从库存核销的数量 = 已拆封损耗之和（未拆封与退回余料均已回到库中） */
export function totalLoss(lines: ReturnLine[]): number {
  return lines.reduce((sum, l) => sum + l.loss, 0);
}

let ledgerSeq = 0;
export function makeLedgerEntry(cue: Cue, lines: ReturnLine[]): LedgerEntry {
  ledgerSeq += 1;
  return {
    id: `LG-${Date.now().toString(36)}-${ledgerSeq}`,
    time: nowStamp(),
    cueId: cue.id,
    cueLabel: `${cue.cueNo} · ${cue.name}`,
    lines,
  };
}
