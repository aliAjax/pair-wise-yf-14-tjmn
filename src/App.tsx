import { useEffect, useMemo, useRef, useState } from "react";
import "./styles.css";
import type { AppState, Cue, DraftRow, ReturnLine } from "./types";
import { FIXTURE_TYPES } from "./types";
import {
  gelOccupancy,
  loadWorkspace,
  resetWorkspace,
  saveWorkspace,
  type WorkspaceExtra,
} from "./lib/storage";
import {
  commitDraft,
  makeLedgerEntry,
  totalLoss,
  validateRehearsal,
  type Candidate,
  type RehearsalIssue,
} from "./lib/scheduling";
import { StageMap } from "./components/StageMap";
import { CueList } from "./components/CueList";
import { ScenePreview } from "./components/ScenePreview";
import { InventoryPanel } from "./components/InventoryPanel";
import { DraftForm, emptyDraft } from "./components/DraftForm";
import { CancelDialog } from "./components/CancelDialog";
import { LedgerPanel } from "./components/LedgerPanel";

type Banner = { kind: "success" | "error"; text: string; details?: RehearsalIssue[] } | null;

function App() {
  const [{ state, extra }, setWorkspace] = useState(loadWorkspace);
  const [banner, setBanner] = useState<Banner>(null);
  const [canceling, setCanceling] = useState<Cue | null>(null);
  const [selectedFixture, setSelectedFixture] = useState<string | null>(null);
  const bannerTimer = useRef<number | null>(null);

  /* 本地存储同步：任何变更立即写入，刷新后保留 */
  useEffect(() => {
    saveWorkspace(state, extra);
  }, [state, extra]);

  const patchState = (patch: Partial<AppState>) =>
    setWorkspace((w) => ({ ...w, state: { ...w.state, ...patch } }));
  const patchExtra = (patch: Partial<WorkspaceExtra>) =>
    setWorkspace((w) => ({ ...w, extra: { ...w.extra, ...patch } }));

  const occupancy = useMemo(() => gelOccupancy(state.cues), [state.cues]);
  const previewCue = state.cues.find((c) => c.id === extra.previewCueId) ?? null;
  const pendingFocus = state.fixtures.filter((f) => f.focus.includes("待确认")).length;

  const flash = (b: Banner, ttl = 7000) => {
    setBanner(b);
    if (bannerTimer.current) window.clearTimeout(bannerTimer.current);
    if (b) bannerTimer.current = window.setTimeout(() => setBanner(null), ttl);
  };

  /* ---------------- 筛选 ---------------- */

  const toggleType = (type: string) =>
    patchExtra({
      typeFilter: extra.typeFilter.includes(type)
        ? extra.typeFilter.filter((t) => t !== type)
        : [...extra.typeFilter, type],
    });

  const toggleGel = (code: string) =>
    patchExtra({
      gelFilter: extra.gelFilter.includes(code)
        ? extra.gelFilter.filter((c) => c !== code)
        : [...extra.gelFilter, code],
    });

  /* ---------------- 整次排演：原子提交 ---------------- */

  const submitRehearsal = () => {
    // 1) 草稿先转候选 Cue（此时还未写入状态）
    const candidates: Candidate[] = state.cues.map((cue) => ({
      key: cue.id,
      label: `${cue.cueNo} · ${cue.name}`,
      cue,
      isDraft: false,
    }));

    const draftCues: Cue[] = extra.drafts.map((row, i) =>
      commitDraft(row.data, state.cues.length + i + 1, `__cand_${i}`),
    );
    draftCues.forEach((cue, i) =>
      candidates.push({ key: `draft-${i}`, label: `${cue.cueNo || "未编号"} · ${cue.name}`, cue, isDraft: true }),
    );

    // 2) 统一校验：重叠重复领用 / 任一时段库存不足
    const issues = validateRehearsal(candidates, state.gels);
    if (issues.length) {
      // 整次排演失败：不改动 Cue 顺序、灯位图、库存，草稿原样保留供修改
      flash({
        kind: "error",
        text: `整次排演失败：发现 ${issues.length} 项冲突，已驳回全部提交。原 Cue 顺序、灯位图与库存均未改动。`,
        details: issues,
      }, 12000);
      return;
    }

    // 3) 校验通过才提交：追加 Cue（order 接续末尾），库存为占用模型无需扣减
    const maxOrder = state.cues.reduce((m, c) => Math.max(m, c.order), 0);
    let seq = 0;
    const committed: Cue[] = draftCues.map((c) => {
      seq += 1;
      return { ...c, id: `cue-${Date.now().toString(36)}-${seq}`, order: maxOrder + seq };
    });

    patchState({ cues: [...state.cues, ...committed] });
    patchExtra({ drafts: [], previewCueId: committed[0]?.id ?? extra.previewCueId });
    flash({
      kind: "success",
      text: `整次排演通过：已按触发顺序追加 ${committed.length} 个 Cue，色片按各自演出时间窗口占用库存。`,
    });
  };

  /* ---------------- 取消 Cue：未拆封全退 / 已拆封退余料记损耗 ---------------- */

  const confirmCancel = (cue: Cue, lines: ReturnLine[]) => {
    const loss = totalLoss(lines);
    // 核销库存：仅已拆封且未以余料退回的部分
    const gels = state.gels.map((g) => {
      const line = lines.find((l) => l.gelCode === g.code);
      return line ? { ...g, stock: Math.max(0, g.stock - line.loss) } : g;
    });
    const cues = state.cues.filter((c) => c.id !== cue.id);
    // 原 Cue 顺序保持（只删除该条，不重排其余 order）
    const ledger = [...state.ledger, makeLedgerEntry(cue, lines)];
    patchState({ gels, cues, ledger });
    if (extra.previewCueId === cue.id) patchExtra({ previewCueId: null });
    setCanceling(null);
    flash({
      kind: "success",
      text:
        loss > 0
          ? `已取消 ${cue.cueNo}：退回未拆封与余料，核销损耗 ${loss} 张并记入台账。`
          : `已取消 ${cue.cueNo}：色片全部完好退回，无损耗。`,
    });
  };

  /* ---------------- 库存盘点 ---------------- */

  const adjustStock = (code: string, nextStock: number) =>
    patchState({
      gels: state.gels.map((g) => (g.code === code ? { ...g, stock: nextStock } : g)),
    });

  /* ---------------- 重置演示数据 ---------------- */

  const handleReset = () => {
    const fresh = resetWorkspace();
    setWorkspace(fresh);
    setSelectedFixture(null);
    flash({ kind: "success", text: "已恢复到初始排演数据。" });
  };

  const selectedFixtureObj = selectedFixture ? state.fixtures.find((f) => f.id === selectedFixture) : null;

  return (
    <main className="app">
      <section className="hero">
        <p>hxyfront-62002 · 源提示词2 · Port 62002</p>
        <h1>剧场灯光 Cue 表 · 色片领用闭环</h1>
        <span>
          每个 Cue 登记色片型号与数量，按演出时间窗口占用库存；整次排演原子校验，重叠重复领用或任一时段库存不足即整单驳回。
          取消 Cue 时未拆封全退、已拆封只退余料并记录损耗。
        </span>
        <div className="show-edit">
          <label>
            <span>演出名称</span>
            <input value={state.showName} onChange={(e) => patchState({ showName: e.target.value })} />
          </label>
          <label>
            <span>演出版本备注</span>
            <input value={state.versionNote} onChange={(e) => patchState({ versionNote: e.target.value })} />
          </label>
          <button type="button" onClick={handleReset} className="reset-btn" title="清空本地存储并恢复初始数据">
            恢复初始数据
          </button>
        </div>
      </section>

      <section className="metrics">
        <article><small>灯具数量</small><strong>{state.fixtures.length}</strong></article>
        <article><small>在排 Cue 数量</small><strong>{state.cues.length}</strong></article>
        <article><small>当前场景</small><strong className="metric-text">{previewCue ? previewCue.cueNo : "—"}</strong></article>
        <article><small>待确认焦点</small><strong>{pendingFocus}</strong></article>
      </section>

      {banner && (
        <div className={`banner banner-${banner.kind}`} role="alert">
          <p>{banner.text}</p>
          {banner.details && (
            <ul>
              {banner.details.slice(0, 6).map((iss, i) => (
                <li key={i} className={`issue issue-${iss.type}`}>{iss.message}</li>
              ))}
              {banner.details.length > 6 && <li>……另有 {banner.details.length - 6} 项冲突</li>}
            </ul>
          )}
          <button type="button" className="banner-x" onClick={() => setBanner(null)} aria-label="关闭提示">×</button>
        </div>
      )}

      <section className="workspace workspace-main">
        {/* 左：筛选 */}
        <aside className="panel filter-panel">
          <h2>灯具筛选</h2>
          <p className="panel-sub">按灯位类型（灯位图与候选灯具联动）</p>
          <div className="chips">
            {FIXTURE_TYPES.map((t) => (
              <button
                key={t}
                type="button"
                className={extra.typeFilter.includes(t) ? "chip-on" : ""}
                onClick={() => toggleType(t)}
              >
                {t}
              </button>
            ))}
          </div>

          <h2 className="filter-gel-title">色片筛选</h2>
          <p className="panel-sub">按已装色片型号过滤灯位图</p>
          <div className="chips gel-chips">
            {state.gels.map((g) => (
              <button
                key={g.code}
                type="button"
                className={extra.gelFilter.includes(g.code) ? "chip-on" : ""}
                onClick={() => toggleGel(g.code)}
              >
                <i className="chip-swatch" style={{ background: g.color }} />
                {g.code}
              </button>
            ))}
          </div>
          {(extra.typeFilter.length > 0 || extra.gelFilter.length > 0) && (
            <button
              type="button"
              className="link-btn"
              onClick={() => patchExtra({ typeFilter: [], gelFilter: [] })}
            >
              清除全部筛选
            </button>
          )}

          {selectedFixtureObj && (
            <div className="fixture-detail">
              <h3>{selectedFixtureObj.id}</h3>
              <p>通道 CH{String(selectedFixtureObj.channel).padStart(3, "0")} · {selectedFixtureObj.type}</p>
              <p>焦点：{selectedFixtureObj.focus}</p>
              <p>亮度预设：{selectedFixtureObj.brightness}%</p>
              <p>已装色片：{selectedFixtureObj.gelCode ?? "无"}</p>
              <button type="button" className="link-btn" onClick={() => setSelectedFixture(null)}>取消选中</button>
            </div>
          )}
        </aside>

        {/* 中：灯位图 + Cue 列表 */}
        <section className="panel stage-panel">
          <div className="heading">
            <div>
              <p>舞台平面</p>
              <h2>灯位图（点击灯具查看详情）</h2>
            </div>
          </div>
          <StageMap
            fixtures={state.fixtures}
            gels={state.gels}
            previewCue={previewCue}
            typeFilter={extra.typeFilter}
            gelFilter={extra.gelFilter}
            selectedFixtureId={selectedFixture}
            onSelectFixture={setSelectedFixture}
          />
        </section>

        {/* 右：场景预览 */}
        <section className="panel preview-panel">
          <div className="heading">
            <div>
              <p>当前场景预览</p>
              <h2>{state.showName}</h2>
            </div>
          </div>
          <ScenePreview cue={previewCue} fixtures={state.fixtures} gels={state.gels} />
        </section>
      </section>

      <section className="workspace workspace-cues">
        <section className="panel cue-panel">
          <div className="heading">
            <div>
              <p>Cue 触发顺序</p>
              <h2>在排 Cue 列表</h2>
            </div>
            <span className="order-hint">顺序固定 · 取消不重排</span>
          </div>
          <CueList
            cues={state.cues}
            gels={state.gels}
            previewCueId={extra.previewCueId}
            onPreview={(id) => patchExtra({ previewCueId: id })}
            onCancel={setCanceling}
          />
        </section>

        <section className="panel inventory-panel">
          <div className="heading">
            <div>
              <p>色片库存</p>
              <h2>时间窗口占用情况</h2>
            </div>
          </div>
          <InventoryPanel gels={state.gels} occupancy={occupancy} onAdjust={adjustStock} />
        </section>
      </section>

      <section className="panel draft-panel">
        <div className="heading">
          <div>
            <p>整次排演登记</p>
            <h2>新增排演单（可一次添加多个 Cue 后统一提交）</h2>
          </div>
          <button
            type="button"
            className="primary"
            onClick={() => patchExtra({ drafts: [...extra.drafts, emptyDraft()] })}
          >
            + 加入排演单
          </button>
        </div>
        <DraftForm
          drafts={extra.drafts}
          fixtures={state.fixtures}
          gels={state.gels}
          occupiedCodes={new Set()}
          onChange={(drafts: DraftRow[]) => patchExtra({ drafts })}
          onSubmit={submitRehearsal}
        />
      </section>

      <section className="panel ledger-panel">
        <div className="heading">
          <div>
            <p>领用闭环台账</p>
            <h2>取消 Cue 退库 / 损耗记录</h2>
          </div>
        </div>
        <LedgerPanel ledger={state.ledger} />
      </section>

      {canceling && (
        <CancelDialog
          cue={canceling}
          gels={state.gels}
          onClose={() => setCanceling(null)}
          onConfirm={confirmCancel}
        />
      )}
    </main>
  );
}

export default App;
