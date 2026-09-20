import { SEED_CUES, SEED_GELS } from "../src/lib/storage";
import {
  buildReturnLines,
  commitDraft,
  totalLoss,
  validateRehearsal,
  type Candidate,
  type CancelInput,
} from "../src/lib/scheduling";
import type { Cue, CueDraft } from "../src/types";

let passed = 0;
let failed = 0;

function check(name: string, cond: boolean, detail = "") {
  if (cond) {
    passed += 1;
    console.log(`  ✓ ${name}`);
  } else {
    failed += 1;
    console.error(`  ✗ ${name} ${detail}`);
  }
}

function candidatesFrom(cues: Cue[]): Candidate[] {
  return cues.map((cue) => ({ key: cue.id, label: `${cue.cueNo} · ${cue.name}`, cue, isDraft: false }));
}

function draft(partial: Partial<CueDraft>): Cue {
  const d: CueDraft = {
    cueNo: "Cue T",
    name: "测试场景",
    start: "19:00",
    end: "19:20",
    brightness: 80,
    fixtureIds: [],
    gels: [{ gelCode: "L201", qty: 1 }],
    note: "",
    ...partial,
  };
  return commitDraft(d, 99, "cand-test");
}

console.log("1) 初始数据（3 个无重叠 Cue）应通过整次排演校验");
{
  const issues = validateRehearsal(candidatesFrom(SEED_CUES), SEED_GELS);
  check("无冲突、无不足", issues.length === 0, JSON.stringify(issues));
}

console.log("2) 与在排 Cue 时间窗口重叠且领用同一色片 → 整单失败（double-book）");
{
  // Cue 12: 19:30-19:45 使用 L201
  const conflict = draft({ cueNo: "Cue 13", start: "19:40", end: "20:00", gels: [{ gelCode: "L201", qty: 1 }] });
  const issues = validateRehearsal([...candidatesFrom(SEED_CUES), { key: "x", label: "Cue 13", cue: conflict, isDraft: true }], SEED_GELS);
  check("被驳回", issues.some((i) => i.type === "double-book"), JSON.stringify(issues));
}

console.log("3) 不重叠但同一色片，错开使用 → 允许");
{
  // 19:45 Cue12 刚结束，20:00 Cue18 开始；19:46-19:59 用 L201 不与任何人重叠
  const ok = draft({ cueNo: "Cue 13", start: "19:46", end: "19:59", gels: [{ gelCode: "L201", qty: 12 }] });
  const issues = validateRehearsal([...candidatesFrom(SEED_CUES), { key: "x", label: "Cue 13", cue: ok, isDraft: true }], SEED_GELS);
  check("无 double-book、库存 12 正好够", issues.length === 0, JSON.stringify(issues));
}

console.log("4) 任一时段叠加需求超过库存 → shortage（无重叠同色片场景）");
{
  // 两个新 Cue 在 18:00-18:30 同时使用不同色片不冲突；这里用同色片会先触发 double-book，
  // 因此改用 L520（库存 4）：一个已有时段占 4，另一个不能存在重叠同色片。
  // 场景：同一窗口两个新 Cue 分别用 L520 —— 它们彼此重叠 → 先 double-book。
  // 正确 shortage 场景：单个 Cue 领用量超过库存（18:00-18:30 无人使用）。
  const tooMany = draft({ cueNo: "Cue 90", start: "18:00", end: "18:30", gels: [{ gelCode: "L520", qty: 5 }] });
  const issues = validateRehearsal([...candidatesFrom(SEED_CUES), { key: "x", label: "Cue 90", cue: tooMany, isDraft: true }], SEED_GELS);
  check("库存不足被驳回", issues.some((i) => i.type === "shortage" && i.gelCode === "L520"), JSON.stringify(issues));
  check("且不误报 double-book", !issues.some((i) => i.type === "double-book"));
}

console.log("5) 叠加需求场景：两个新 Cue 窗口不重叠但分别与第三方需求拼接，扫描线峰值正确");
{
  // 18:00-18:20 用 L520 3 张（库存 4，OK）；18:20-18:40 用 L520 3 张（不重叠，各自 OK）
  const a = draft({ cueNo: "Cue 91", start: "18:00", end: "18:20", gels: [{ gelCode: "L520", qty: 3 }] });
  const b = draft({ cueNo: "Cue 92", start: "18:20", end: "18:40", gels: [{ gelCode: "L520", qty: 3 }] });
  const issues = validateRehearsal(
    [...candidatesFrom(SEED_CUES), { key: "a", label: "91", cue: a, isDraft: true }, { key: "b", label: "92", cue: b, isDraft: true }],
    SEED_GELS,
  );
  check("半开区间相接不算重叠、各自不超库存", issues.length === 0, JSON.stringify(issues));
}

console.log("6) 时间窗口非法（结束<=开始）→ window 错误");
{
  const bad = draft({ cueNo: "Cue 93", start: "20:00", end: "19:00", gels: [{ gelCode: "L101", qty: 1 }] });
  const issues = validateRehearsal([...candidatesFrom(SEED_CUES), { key: "x", label: "93", cue: bad, isDraft: true }], SEED_GELS);
  check("窗口错误被识别", issues.some((i) => i.type === "window"), JSON.stringify(issues));
}

console.log("7) 取消 Cue：未拆封全退 → 损耗 0，库存无需核销");
{
  const cue = SEED_CUES[0]; // Cue12: L201×4, L241×2
  const inputs: CancelInput[] = [
    { gelCode: "L201", unopened: 4, opened: 0, returnedLeftover: 0 },
    { gelCode: "L241", unopened: 2, opened: 0, returnedLeftover: 0 },
  ];
  const { lines, error } = buildReturnLines(cue, inputs);
  check("无登记错误", !error, error);
  check("损耗合计 0", lines !== undefined && totalLoss(lines) === 0);
}

console.log("8) 取消 Cue：部分拆封、余料部分退回 → 只核销损耗差额");
{
  const cue = SEED_CUES[0];
  // L201 领4：未拆封2、已拆封2，其中余料可退1 → 损耗1
  // L241 领2：未拆封0、已拆封2，余料退0 → 损耗2
  const inputs: CancelInput[] = [
    { gelCode: "L201", unopened: 2, opened: 2, returnedLeftover: 1 },
    { gelCode: "L241", unopened: 0, opened: 2, returnedLeftover: 0 },
  ];
  const { lines, error } = buildReturnLines(cue, inputs);
  check("无登记错误", !error, error);
  check("总损耗 3", lines !== undefined && totalLoss(lines) === 3, `loss=${lines ? totalLoss(lines) : "?"}`);
  const l201 = lines?.find((l) => l.gelCode === "L201");
  check("L201 损耗1", l201?.loss === 1 && l201.returnedLeftover === 1);
}

console.log("9) 取消登记数量与领用不符 → 拒绝");
{
  const cue = SEED_CUES[0];
  const inputs: CancelInput[] = [
    { gelCode: "L201", unopened: 3, opened: 0, returnedLeftover: 0 }, // 3 != 4
    { gelCode: "L241", unopened: 2, opened: 0, returnedLeftover: 0 },
  ];
  const { lines, error } = buildReturnLines(cue, inputs);
  check("返回错误且无结果行", !!error && !lines, error ?? "");
}

console.log("10) 同一 Cue 内重复登记同一色片行 → 提交时合并数量");
{
  const merged = commitDraft(
    {
      cueNo: "Cue 94",
      name: "合并测试",
      start: "18:00",
      end: "18:10",
      brightness: 60,
      fixtureIds: [],
      gels: [
        { gelCode: "L101", qty: 2 },
        { gelCode: "L101", qty: 3 },
      ],
      note: "",
    },
    1,
    "x",
  );
  check("两行合并为 L101×5", merged.gels.length === 1 && merged.gels[0].qty === 5, JSON.stringify(merged.gels));
}

console.log(`\n结果：${passed} 通过 / ${failed} 失败`);
if (failed > 0) process.exit(1);
