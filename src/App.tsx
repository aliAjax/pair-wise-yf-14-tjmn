import { useEffect, useMemo, useState, type CSSProperties } from "react";
import "./styles.css";
import { FIXTURE_TYPES, seedCues, seedFixtures, seedGels } from "./data";
import {
  checkedOutQty,
  collectReturnLines,
  conflictCueIds,
  gelCapacity,
  hhmmToMinutes,
  inPlay,
  mmToLabel,
  validateRehearsal,
  type ReturnLine,
} from "./logic";
import type { Cue, CueGel, Gel, PersistedState, RehearsalState, WasteRecord } from "./types";

const STORAGE_KEY = "hxyfront-62002-cue-gel-v1";

const defaultState = (): PersistedState => ({
  showName: "《夜航》排练版",
  versionNote: "版本B · 二幕色片待确认",
  cues: seedCues,
  gels: seedGels,
  waste: [],
  rehearsal: { status: "idle", errors: [], ranAt: null },
  activeCueId: seedCues[0]?.id ?? null,
  fixtureFilter: "全部",
  gelFilter: "全部",
});

function loadState(): PersistedState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultState();
    const parsed = JSON.parse(raw) as PersistedState;
    return { ...defaultState(), ...parsed };
  } catch {
    return defaultState();
  }
}

const uid = () => `id-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
const nowLabel = () => new Date().toLocaleString("zh-CN", { hour12: false });

const STATUS_META: Record<Cue["status"], { label: string; cls: string }> = {
  pending: { label: "待排演", cls: "st-pending" },
  active: { label: "排演中 · 已领用", cls: "st-active" },
  cancelled: { label: "已取消", cls: "st-cancelled" },
  done: { label: "已完成", cls: "st-done" },
};

interface DraftGel {
  gelId: string;
  qty: number;
}

interface DraftCue {
  name: string;
  start: string;
  end: string;
  fixtureIds: string[];
  focus: string;
  dimmer: number;
  gels: DraftGel[];
}

const emptyDraft = (gelId: string): DraftCue => ({
  name: "",
  start: "19:30",
  end: "19:50",
  fixtureIds: [],
  focus: "",
  dimmer: 80,
  gels: [{ gelId, qty: 1 }],
});

function App() {
  const [initial] = useState(loadState);
  const [showName, setShowName] = useState(initial.showName);
  const [versionNote, setVersionNote] = useState(initial.versionNote);
  const [cues, setCues] = useState<Cue[]>(initial.cues);
  const [gels, setGels] = useState<Gel[]>(initial.gels);
  const [waste, setWaste] = useState<WasteRecord[]>(initial.waste);
  const [rehearsal, setRehearsal] = useState<RehearsalState>(initial.rehearsal);
  const [activeCueId, setActiveCueId] = useState<string | null>(initial.activeCueId);
  const [fixtureFilter, setFixtureFilter] = useState(initial.fixtureFilter);
  const [gelFilter, setGelFilter] = useState(initial.gelFilter);
  const [draft, setDraft] = useState<DraftCue>(() => emptyDraft(initial.gels[0]?.id ?? ""));
  const [formError, setFormError] = useState("");
  const [returnTarget, setReturnTarget] = useState<{
    cueIds: string[];
    title: string;
    mode: "cancel" | "end";
  } | null>(null);

  // 本地存储同步：任何状态变化都写回，刷新后保留
  useEffect(() => {
    const state: PersistedState = {
      showName,
      versionNote,
      cues,
      gels,
      waste,
      rehearsal,
      activeCueId,
      fixtureFilter,
      gelFilter,
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }, [showName, versionNote, cues, gels, waste, rehearsal, activeCueId, fixtureFilter, gelFilter]);

  const activeCue = cues.find((c) => c.id === activeCueId) ?? null;
  const playCues = inPlay(cues);
  const gelById = useMemo(() => new Map(gels.map((g) => [g.id, g])), [gels]);
  const fixtureById = useMemo(() => new Map(seedFixtures.map((f) => [f.id, f])), []);

  const visibleCues = cues.filter(
    (c) => gelFilter === "全部" || c.gels.some((g) => g.gelId === gelFilter)
  );

  const pendingFocus = playCues.filter((c) => !c.focusConfirmed).length;

  /* ---------------- 排演闭环 ---------------- */

  // 开始/重新校验排演：整次校验，任一失败则全部不生效
  const startRehearsal = () => {
    const errors = validateRehearsal(cues, gels);
    if (errors.length > 0) {
      // 失败：仅记录失败状态，Cue 顺序、灯位图与库存保持原样
      setRehearsal({ status: "failed", errors, ranAt: nowLabel() });
      return;
    }
    const toCheckout = new Map<string, number>();
    for (const cue of playCues) {
      for (const g of cue.gels) {
        if (!g.checkedOut) {
          toCheckout.set(g.gelId, (toCheckout.get(g.gelId) ?? 0) + g.qty);
        }
      }
    }
    setGels((prev) =>
      prev.map((g) => ({ ...g, stock: g.stock - (toCheckout.get(g.id) ?? 0) }))
    );
    setCues((prev) =>
      prev.map((c) =>
        c.status === "pending" || c.status === "active"
          ? { ...c, status: "active", gels: c.gels.map((g) => ({ ...g, checkedOut: true })) }
          : c
      )
    );
    setRehearsal({ status: "running", errors: [], ranAt: nowLabel() });
  };

  // 退还结算：未拆封全退；已拆封按余料退，差额记损耗
  const applyReturn = (cueIds: string[], remainders: Record<string, number>, nextStatus: Cue["status"], source: string) => {
    const lines = collectReturnLines(cues, gels, cueIds);
    const backToStock = new Map<string, number>();
    const newWaste: WasteRecord[] = [];
    for (const line of lines) {
      const returned = line.opened
        ? Math.min(Math.max(remainders[line.key] ?? 0, 0), line.qty)
        : line.qty;
      backToStock.set(line.gelId, (backToStock.get(line.gelId) ?? 0) + returned);
      const loss = line.qty - returned;
      if (loss > 0) {
        newWaste.push({
          id: uid(),
          at: nowLabel(),
          gelId: line.gelId,
          gelName: line.gelName,
          qty: loss,
          source: `${source} · ${line.cueName}`,
        });
      }
    }
    setGels((prev) =>
      prev.map((g) => ({ ...g, stock: g.stock + (backToStock.get(g.id) ?? 0) }))
    );
    if (newWaste.length > 0) setWaste((prev) => [...newWaste, ...prev]);
    setCues((prev) =>
      prev.map((c) =>
        cueIds.includes(c.id)
          ? { ...c, status: nextStatus, gels: c.gels.map((g) => ({ ...g, checkedOut: false })) }
          : c
      )
    );
  };

  const requestCancelCue = (cue: Cue) => {
    if (cue.gels.some((g) => g.checkedOut)) {
      setReturnTarget({
        cueIds: [cue.id],
        title: `取消「${cue.name}」· 色片退还`,
        mode: "cancel",
      });
    } else {
      setCues((prev) => prev.map((c) => (c.id === cue.id ? { ...c, status: "cancelled" } : c)));
    }
  };

  const requestEndRehearsal = () => {
    const ids = playCues.map((c) => c.id);
    if (ids.some((id) => cues.find((c) => c.id === id)?.gels.some((g) => g.checkedOut))) {
      setReturnTarget({ cueIds: ids, title: "结束排演 · 全部色片退还", mode: "end" });
    } else {
      setCues((prev) =>
        prev.map((c) => (ids.includes(c.id) ? { ...c, status: "done" as const } : c))
      );
      setRehearsal({ status: "idle", errors: [], ranAt: nowLabel() });
    }
  };

  const confirmReturn = (remainders: Record<string, number>) => {
    if (!returnTarget) return;
    const isEnd = returnTarget.mode === "end";
    applyReturn(
      returnTarget.cueIds,
      remainders,
      isEnd ? "done" : "cancelled",
      isEnd ? "结束排演" : "取消Cue"
    );
    if (isEnd) setRehearsal({ status: "idle", errors: [], ranAt: nowLabel() });
    setReturnTarget(null);
  };

  /* ---------------- Cue 维护 ---------------- */

  const moveCue = (index: number, dir: -1 | 1) => {
    setCues((prev) => {
      const next = [...prev];
      const j = index + dir;
      if (j < 0 || j >= next.length) return prev;
      [next[index], next[j]] = [next[j], next[index]];
      return next;
    });
  };

  const removeCue = (cue: Cue) => {
    if (cue.gels.some((g) => g.checkedOut)) return; // 已领用的必须先取消退还
    setCues((prev) => prev.filter((c) => c.id !== cue.id));
    if (activeCueId === cue.id) setActiveCueId(null);
  };

  const toggleOpened = (cueId: string, gelId: string) => {
    setCues((prev) =>
      prev.map((c) =>
        c.id === cueId
          ? {
              ...c,
              gels: c.gels.map((g) =>
                g.gelId === gelId && g.checkedOut ? { ...g, opened: !g.opened } : g
              ),
            }
          : c
      )
    );
  };

  const toggleFocusConfirmed = (cueId: string) => {
    setCues((prev) =>
      prev.map((c) => (c.id === cueId ? { ...c, focusConfirmed: !c.focusConfirmed } : c))
    );
  };

  const addCue = () => {
    const start = hhmmToMinutes(draft.start);
    const end = hhmmToMinutes(draft.end);
    if (!draft.name.trim()) return setFormError("请填写场景名称");
    if (end <= start) return setFormError("时间窗口无效：结束时间必须晚于开始时间");
    const merged = new Map<string, number>();
    for (const g of draft.gels) {
      if (g.qty <= 0) return setFormError("色片数量必须大于 0");
      merged.set(g.gelId, (merged.get(g.gelId) ?? 0) + g.qty);
    }
    const cueGels: CueGel[] = [...merged.entries()].map(([gelId, qty]) => ({
      gelId,
      qty,
      opened: false,
      checkedOut: false,
    }));
    const cue: Cue = {
      id: uid(),
      name: draft.name.trim(),
      fixtureIds: draft.fixtureIds,
      focus: draft.focus.trim() || "待定",
      focusConfirmed: false,
      dimmer: Math.min(Math.max(draft.dimmer, 0), 100),
      start,
      end,
      gels: cueGels,
      status: "pending",
    };
    setCues((prev) => [...prev, cue]);
    setDraft(emptyDraft(gels[0]?.id ?? ""));
    setFormError("");
    setActiveCueId(cue.id);
  };

  /* ---------------- 渲染 ---------------- */

  const returnLines = returnTarget
    ? collectReturnLines(cues, gels, returnTarget.cueIds)
    : [];

  return (
    <main className="app">
      <section className="hero">
        <p>hxyfront-62002 · 剧场灯光 · Port 62002</p>
        <h1>剧场灯光Cue表管理</h1>
        <span>
          灯位图、Cue 触发顺序与场景预览之外，本工作台为每个 Cue 登记色片型号与数量，按演出时间窗口占用库存：
          重叠领用或时段库存不足则整次排演失败且数据不变；取消 Cue 时未拆封全退、已拆封退余料并记录损耗。
        </span>
        <div className="hero-fields">
          <label>
            <span>演出名称</span>
            <input value={showName} onChange={(e) => setShowName(e.target.value)} />
          </label>
          <label>
            <span>演出版本备注</span>
            <input value={versionNote} onChange={(e) => setVersionNote(e.target.value)} />
          </label>
        </div>
      </section>

      <section className="metrics">
        <article>
          <small>灯具数量</small>
          <strong>{seedFixtures.length}</strong>
        </article>
        <article>
          <small>Cue数量</small>
          <strong>{playCues.length}</strong>
        </article>
        <article>
          <small>当前场景</small>
          <strong className="metric-text">{activeCue ? activeCue.name : "未选择"}</strong>
        </article>
        <article>
          <small>待确认焦点</small>
          <strong>{pendingFocus}</strong>
        </article>
      </section>

      <section className={`panel rehearsal ${rehearsal.status}`}>
        <div className="heading">
          <div>
            <p>排演闭环</p>
            <h2>
              {rehearsal.status === "running" && "排演进行中 · 色片已领用"}
              {rehearsal.status === "idle" && "排演未开始"}
              {rehearsal.status === "failed" && "整次排演失败"}
            </h2>
            {rehearsal.ranAt && <small className="muted">最近操作：{rehearsal.ranAt}</small>}
          </div>
          <div className="row-actions">
            <button className="primary" onClick={startRehearsal}>
              {rehearsal.status === "running" ? "重新校验并补领" : "开始排演 · 校验并领用"}
            </button>
            <button
              onClick={requestEndRehearsal}
              disabled={rehearsal.status !== "running" && playCues.length === 0}
            >
              结束排演 · 退还全部
            </button>
          </div>
        </div>
        {rehearsal.status === "failed" && (
          <div className="error-box">
            <b>校验未通过 —— Cue 顺序、灯位图与库存均保持不变：</b>
            <ul>
              {rehearsal.errors.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          </div>
        )}
        {rehearsal.status === "running" && (
          <p className="ok-line">校验通过：全部在排 Cue 的色片已按时间窗口领用并占用库存。</p>
        )}
      </section>

      <section className="workspace">
        <aside className="panel">
          <h2>灯具筛选</h2>
          <div className="chips">
            {["全部", ...FIXTURE_TYPES].map((t) => (
              <button
                key={t}
                className={fixtureFilter === t ? "chip-on" : ""}
                onClick={() => setFixtureFilter(t)}
              >
                {t}
              </button>
            ))}
          </div>

          <h2 className="mt">色片筛选</h2>
          <div className="chips">
            {["全部", ...gels.map((g) => g.id)].map((id) => (
              <button
                key={id}
                className={gelFilter === id ? "chip-on" : ""}
                onClick={() => setGelFilter(id)}
              >
                {id === "全部" ? (
                  "全部"
                ) : (
                  <>
                    <i className="dot" style={{ background: gelById.get(id)?.color }} />
                    {id}
                  </>
                )}
              </button>
            ))}
          </div>

          <h2 className="mt">色片库存</h2>
          <div className="stock-list">
            {gels.map((g) => {
              const out = checkedOutQty(cues, g.id);
              return (
                <div className="stock-row" key={g.id}>
                  <i className="dot" style={{ background: g.color }} />
                  <div className="stock-info">
                    <b>
                      {g.id}「{g.name}」
                    </b>
                    <div className="stock-bar">
                      <span
                        style={{
                          width: `${(g.stock / (g.stock + out || 1)) * 100}%`,
                          background: g.color,
                        }}
                      />
                    </div>
                  </div>
                  <small>
                    在库 {g.stock} · 领用 {out}
                  </small>
                </div>
              );
            })}
          </div>
        </aside>

        <section className="panel">
          <div className="heading">
            <div>
              <p>舞台平面灯位图 · 场景预览</p>
              <h2>{activeCue ? activeCue.name : "点击 Cue 查看场景"}</h2>
            </div>
            {activeCue && (
              <span className="time-badge">
                {mmToLabel(activeCue.start)}–{mmToLabel(activeCue.end)} · 亮度{" "}
                {activeCue.dimmer}%
              </span>
            )}
          </div>
          <StagePlot
            activeCue={activeCue}
            fixtureFilter={fixtureFilter}
            gelById={gelById}
          />
          {activeCue && (
            <div className="preview-detail">
              <div>
                <small>通道号</small>
                <p>
                  {activeCue.fixtureIds
                    .map((id) => fixtureById.get(id)?.channel)
                    .filter(Boolean)
                    .join("，") || "未指派"}
                </p>
              </div>
              <div>
                <small>焦点位置</small>
                <p>{activeCue.focus}</p>
              </div>
              <div>
                <small>色片</small>
                <p className="gel-inline">
                  {activeCue.gels.length === 0 && "无"}
                  {activeCue.gels.map((g) => (
                    <span key={g.gelId}>
                      <i className="dot" style={{ background: gelById.get(g.gelId)?.color }} />
                      {g.gelId} × {g.qty}
                    </span>
                  ))}
                </p>
              </div>
            </div>
          )}
        </section>
      </section>

      <section className="panel">
        <div className="heading">
          <div>
            <p>Cue 触发顺序</p>
            <h2>Cue 列表{gelFilter !== "全部" && ` · 筛选：${gelFilter}`}</h2>
          </div>
        </div>
        <div className="cue-list">
          {visibleCues.length === 0 && <p className="muted">当前色片筛选下没有 Cue。</p>}
          {visibleCues.map((cue) => {
            const seq = cues.indexOf(cue);
            const st = STATUS_META[cue.status];
            const selected = cue.id === activeCueId;
            return (
              <article
                key={cue.id}
                className={`cue-row ${selected ? "cue-selected" : ""} ${
                  cue.status === "cancelled" || cue.status === "done" ? "cue-off" : ""
                }`}
                onClick={() => setActiveCueId(cue.id)}
              >
                <div className="cue-seq">
                  <b>{String(seq + 1).padStart(2, "0")}</b>
                  <div className="seq-btns">
                    <button
                      title="上移"
                      disabled={seq === 0}
                      onClick={(e) => {
                        e.stopPropagation();
                        moveCue(seq, -1);
                      }}
                    >
                      ↑
                    </button>
                    <button
                      title="下移"
                      disabled={seq === cues.length - 1}
                      onClick={(e) => {
                        e.stopPropagation();
                        moveCue(seq, 1);
                      }}
                    >
                      ↓
                    </button>
                  </div>
                </div>
                <div className="cue-main">
                  <div className="cue-title">
                    <h3>{cue.name}</h3>
                    <span className={`status ${st.cls}`}>{st.label}</span>
                    <span className="time-badge">
                      {mmToLabel(cue.start)}–{mmToLabel(cue.end)}
                    </span>
                    <span className="muted">亮度 {cue.dimmer}%</span>
                  </div>
                  <p className="muted">
                    {cue.fixtureIds.map((id) => fixtureById.get(id)?.label).filter(Boolean).join("、") ||
                      "未指派灯具"}{" "}
                    · 焦点：{cue.focus}
                  </p>
                  <div className="cue-gels">
                    {cue.gels.map((g) => {
                      const gel = gelById.get(g.gelId);
                      return (
                        <span className="gel-tag" key={g.gelId}>
                          <i className="dot" style={{ background: gel?.color }} />
                          {g.gelId}「{gel?.name}」× {g.qty}
                          {g.checkedOut ? (
                            <button
                              className={`mini ${g.opened ? "mini-warn" : ""}`}
                              title="切换拆封状态"
                              onClick={(e) => {
                                e.stopPropagation();
                                toggleOpened(cue.id, g.gelId);
                              }}
                            >
                              {g.opened ? "已拆封" : "未拆封"}
                            </button>
                          ) : (
                            <em>未领用</em>
                          )}
                        </span>
                      );
                    })}
                  </div>
                </div>
                <div className="cue-actions" onClick={(e) => e.stopPropagation()}>
                  <button
                    className={`mini ${cue.focusConfirmed ? "" : "mini-warn"}`}
                    onClick={() => toggleFocusConfirmed(cue.id)}
                  >
                    {cue.focusConfirmed ? "焦点已确认" : "确认焦点"}
                  </button>
                  {(cue.status === "pending" || cue.status === "active") && (
                    <button className="mini" onClick={() => requestCancelCue(cue)}>
                      取消 Cue
                    </button>
                  )}
                  {!cue.gels.some((g) => g.checkedOut) && (
                    <button className="mini danger" onClick={() => removeCue(cue)}>
                      删除
                    </button>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      </section>

      <section className="panel form-panel">
        <div className="heading">
          <div>
            <p>专业字段</p>
            <h2>新增 Cue</h2>
          </div>
          <button className="primary" onClick={addCue}>
            保存并加入 Cue 表
          </button>
        </div>
        <div className="field-grid">
          <label>
            <span>场景名称</span>
            <input
              placeholder="填写场景名称"
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            />
          </label>
          <label>
            <span>焦点位置</span>
            <input
              placeholder="填写焦点位置"
              value={draft.focus}
              onChange={(e) => setDraft({ ...draft, focus: e.target.value })}
            />
          </label>
          <label>
            <span>时间窗口 · 开始</span>
            <input
              type="time"
              value={draft.start}
              onChange={(e) => setDraft({ ...draft, start: e.target.value })}
            />
          </label>
          <label>
            <span>时间窗口 · 结束</span>
            <input
              type="time"
              value={draft.end}
              onChange={(e) => setDraft({ ...draft, end: e.target.value })}
            />
          </label>
          <label>
            <span>亮度预设（{draft.dimmer}%）</span>
            <input
              type="range"
              min={0}
              max={100}
              value={draft.dimmer}
              onChange={(e) => setDraft({ ...draft, dimmer: Number(e.target.value) })}
            />
          </label>
          <div className="fixture-picker">
            <span>灯具编号（点击选择）</span>
            <div className="chips">
              {seedFixtures.map((f) => (
                <button
                  key={f.id}
                  className={draft.fixtureIds.includes(f.id) ? "chip-on" : ""}
                  onClick={() =>
                    setDraft({
                      ...draft,
                      fixtureIds: draft.fixtureIds.includes(f.id)
                        ? draft.fixtureIds.filter((id) => id !== f.id)
                        : [...draft.fixtureIds, f.id],
                    })
                  }
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="gel-editor">
          <span>色片登记（型号 + 数量）</span>
          {draft.gels.map((g, i) => (
            <div className="gel-edit-row" key={i}>
              <select
                value={g.gelId}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    gels: draft.gels.map((x, j) => (j === i ? { ...x, gelId: e.target.value } : x)),
                  })
                }
              >
                {gels.map((gel) => (
                  <option key={gel.id} value={gel.id}>
                    {gel.id}「{gel.name}」 在库 {gel.stock}
                  </option>
                ))}
              </select>
              <input
                type="number"
                min={1}
                value={g.qty}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    gels: draft.gels.map((x, j) =>
                      j === i ? { ...x, qty: Math.max(1, Number(e.target.value) || 1) } : x
                    ),
                  })
                }
              />
              <button
                className="mini danger"
                disabled={draft.gels.length <= 1}
                onClick={() => setDraft({ ...draft, gels: draft.gels.filter((_, j) => j !== i) })}
              >
                移除
              </button>
            </div>
          ))}
          <button
            className="mini"
            onClick={() =>
              setDraft({ ...draft, gels: [...draft.gels, { gelId: gels[0]?.id ?? "", qty: 1 }] })
            }
          >
            + 添加色片行
          </button>
          {formError && <p className="form-error">{formError}</p>}
        </div>
      </section>

      <GelTimeline cues={cues} gels={gels} />

      <section className="panel">
        <div className="heading">
          <div>
            <p>闭环记录</p>
            <h2>色片损耗记录</h2>
          </div>
        </div>
        {waste.length === 0 ? (
          <p className="muted">暂无损耗。取消已拆封色片的 Cue 时，差额会记录在这里。</p>
        ) : (
          <div className="records">
            {waste.map((w, i) => (
              <article key={w.id}>
                <b>{String(waste.length - i).padStart(2, "0")}</b>
                <div>
                  <h3>
                    {w.gelName} · 损耗 {w.qty} 张
                  </h3>
                  <p>
                    {w.source} · {w.at}
                  </p>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      {returnTarget && (
        <ReturnDialog
          title={returnTarget.title}
          lines={returnLines}
          onCancel={() => setReturnTarget(null)}
          onConfirm={confirmReturn}
        />
      )}
    </main>
  );
}

/* ---------------- 灯位图 ---------------- */

function StagePlot({
  activeCue,
  fixtureFilter,
  gelById,
}: {
  activeCue: Cue | null;
  fixtureFilter: string;
  gelById: Map<string, Gel>;
}) {
  const cueFixtureIds = new Set(activeCue?.fixtureIds ?? []);
  const glowColor = activeCue?.gels.length
    ? gelById.get(activeCue.gels[0].gelId)?.color ?? "#f59e0b"
    : "#f59e0b";
  const dimmer = (activeCue?.dimmer ?? 0) / 100;

  return (
    <div className="stage">
      <span className="stage-zone zone-aud">观众席 / FOH</span>
      <span className="stage-zone zone-stage">舞台</span>
      {seedFixtures.map((f) => {
        const inCue = cueFixtureIds.has(f.id);
        const filtered = fixtureFilter === "全部" || f.type === fixtureFilter;
        const cls = ["fixture", inCue ? "fx-on" : "", filtered ? "" : "fx-dim"].join(" ");
        const style: CSSProperties = { left: `${f.x}%`, top: `${f.y}%` };
        if (inCue && activeCue) {
          style.background = glowColor;
          style.boxShadow = `0 0 ${10 + dimmer * 26}px ${glowColor}`;
          style.opacity = 0.35 + dimmer * 0.65;
        }
        return (
          <div key={f.id} className={cls} style={style} title={`${f.label} · ${f.channel} · ${f.type}`}>
            <i />
            <small>{f.label}</small>
          </div>
        );
      })}
    </div>
  );
}

/* ---------------- 色片时段占用 ---------------- */

function GelTimeline({ cues, gels }: { cues: Cue[]; gels: Gel[] }) {
  const play = inPlay(cues);
  const usedGelIds = [...new Set(play.flatMap((c) => c.gels.map((g) => g.gelId)))];
  if (play.length === 0 || usedGelIds.length === 0) {
    return (
      <section className="panel">
        <div className="heading">
          <div>
            <p>时间窗口</p>
            <h2>色片时段占用</h2>
          </div>
        </div>
        <p className="muted">暂无在排 Cue。</p>
      </section>
    );
  }
  const min = Math.min(...play.map((c) => c.start)) - 15;
  const max = Math.max(...play.map((c) => c.end)) + 15;
  const span = max - min;
  const ticks = Array.from({ length: 5 }, (_, i) => min + (span / 4) * i);

  return (
    <section className="panel">
      <div className="heading">
        <div>
          <p>时间窗口</p>
          <h2>色片时段占用</h2>
        </div>
        <small className="muted">重叠占用与超库存会以红色标出</small>
      </div>
      <div className="timeline">
        <div className="tl-scale">
          {ticks.map((t) => (
            <span key={t} style={{ left: `${((t - min) / span) * 100}%` }}>
              {mmToLabel(Math.round(t))}
            </span>
          ))}
        </div>
        {usedGelIds.map((gelId) => {
          const gel = gels.find((g) => g.id === gelId);
          if (!gel) return null;
          const conflicts = conflictCueIds(cues, gelId);
          const capacity = gelCapacity(cues, gels, gelId);
          const rows = play.filter((c) => c.gels.some((g) => g.gelId === gelId));
          const overStock = rows.some((c) => {
            const line = c.gels.find((g) => g.gelId === gelId);
            return line ? line.qty > capacity : false;
          });
          return (
            <div className="tl-row" key={gelId}>
              <div className="tl-label">
                <i className="dot" style={{ background: gel.color }} />
                <b>{gel.id}</b>
                <small>
                  可用 {capacity}
                  {(conflicts.size > 0 || overStock) && <em className="tl-alert">冲突</em>}
                </small>
              </div>
              <div className="tl-track">
                {rows.map((cue) => {
                  const line = cue.gels.find((g) => g.gelId === gelId)!;
                  const bad = conflicts.has(cue.id) || line.qty > capacity;
                  return (
                    <div
                      key={cue.id}
                      className={`tl-bar ${bad ? "tl-bad" : ""}`}
                      style={{
                        left: `${((cue.start - min) / span) * 100}%`,
                        width: `${((cue.end - cue.start) / span) * 100}%`,
                        background: bad ? undefined : gel.color,
                      }}
                      title={`${cue.name} · ${mmToLabel(cue.start)}–${mmToLabel(cue.end)} · ${gel.id} × ${line.qty}`}
                    >
                      {cue.name} × {line.qty}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

/* ---------------- 退还弹窗 ---------------- */

function ReturnDialog({
  title,
  lines,
  onCancel,
  onConfirm,
}: {
  title: string;
  lines: ReturnLine[];
  onCancel: () => void;
  onConfirm: (remainders: Record<string, number>) => void;
}) {
  const [remainders, setRemainders] = useState<Record<string, number>>({});
  const remOf = (l: ReturnLine) => remainders[l.key] ?? 0;
  const totalBack = lines.reduce((s, l) => s + (l.opened ? remOf(l) : l.qty), 0);
  const totalLoss = lines.reduce((s, l) => s + (l.opened ? l.qty - remOf(l) : 0), 0);

  return (
    <div className="modal-mask" onClick={onCancel}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>{title}</h3>
        <p className="muted">未拆封色片全退；已拆封色片只退余料，差额计入损耗记录。</p>
        <div className="return-lines">
          {lines.map((l) => (
            <div className="return-line" key={l.key}>
              <i className="dot" style={{ background: l.color }} />
              <div className="return-info">
                <b>{l.gelName}</b>
                <small>
                  {l.cueName} · 领用 {l.qty} 张 · {l.opened ? "已拆封" : "未拆封"}
                </small>
              </div>
              {l.opened ? (
                <label className="return-input">
                  <span>余料</span>
                  <input
                    type="number"
                    min={0}
                    max={l.qty}
                    value={remOf(l)}
                    onChange={(e) =>
                      setRemainders({
                        ...remainders,
                        [l.key]: Math.min(Math.max(Number(e.target.value) || 0, 0), l.qty),
                      })
                    }
                  />
                  <em>损耗 {l.qty - remOf(l)}</em>
                </label>
              ) : (
                <span className="return-full">全退 {l.qty} 张</span>
              )}
            </div>
          ))}
        </div>
        <div className="return-summary">
          合计退还 <b>{totalBack}</b> 张 · 记录损耗 <b className={totalLoss > 0 ? "loss" : ""}>{totalLoss}</b> 张
        </div>
        <div className="row-actions end">
          <button onClick={onCancel}>再想想</button>
          <button className="primary" onClick={() => onConfirm(remainders)}>
            确认退还并关闭
          </button>
        </div>
      </div>
    </div>
  );
}

export default App;
