import type { DraftRow, Fixture, Gel, GelRequest } from "../types";
import { overlaps } from "../lib/scheduling";

interface DraftFormProps {
  drafts: DraftRow[];
  fixtures: Fixture[];
  gels: Gel[];
  occupiedCodes: Set<string>; // 与其他草稿行时间窗口重叠的色片（即时提示）
  onChange: (drafts: DraftRow[]) => void;
  onSubmit: () => void;
}

let uidSeq = 0;
export function newDraftUid(): string {
  uidSeq += 1;
  return `draft-${Date.now().toString(36)}-${uidSeq}`;
}

export function emptyDraft(): DraftRow {
  return {
    uid: newDraftUid(),
    data: {
      cueNo: "",
      name: "",
      start: "",
      end: "",
      brightness: 80,
      fixtureIds: [],
      gels: [{ gelCode: "", qty: 1 }],
      note: "",
    },
  };
}

export function DraftForm({ drafts, fixtures, gels, onChange, onSubmit }: DraftFormProps) {
  const update = (uid: string, patch: Partial<DraftRow["data"]>) => {
    onChange(drafts.map((d) => (d.uid === uid ? { ...d, data: { ...d.data, ...patch } } : d)));
  };

  const updateGel = (uid: string, index: number, patch: Partial<GelRequest>) => {
    const row = drafts.find((d) => d.uid === uid);
    if (!row) return;
    const next = row.data.gels.map((g, i) => (i === index ? { ...g, ...patch } : g));
    update(uid, { gels: next });
  };

  const addGelRow = (uid: string) => {
    const row = drafts.find((d) => d.uid === uid);
    if (!row) return;
    update(uid, { gels: [...row.data.gels, { gelCode: "", qty: 1 }] });
  };

  const removeGelRow = (uid: string, index: number) => {
    const row = drafts.find((d) => d.uid === uid);
    if (!row) return;
    update(uid, { gels: row.data.gels.filter((_, i) => i !== index) });
  };

  const toggleFixture = (uid: string, id: string) => {
    const row = drafts.find((d) => d.uid === uid);
    if (!row) return;
    const set = new Set(row.data.fixtureIds);
    if (set.has(id)) set.delete(id);
    else set.add(id);
    update(uid, { fixtureIds: Array.from(set) });
  };

  const remove = (uid: string) => onChange(drafts.filter((d) => d.uid !== uid));

  return (
    <div className="draft-form">
      {drafts.length === 0 && <p className="empty">草稿为空。点击「加入排演单」逐条登记 Cue 的时间窗口与色片领用，随后整次提交校验。</p>}

      {drafts.map((row, rowIdx) => {
        const d = row.data;
        const windowInvalid = d.start !== "" && d.end !== "" && d.end <= d.start;
        // 与其他草稿行的窗口+色片冲突，用于即时提示
        const draftConflicts = new Set<string>();
        drafts.forEach((other) => {
          if (other.uid === row.uid || !d.start || !d.end || !other.data.start || !other.data.end) return;
          if (d.end <= d.start || other.data.end <= other.data.start) return;
          if (!overlaps(d.start, d.end, other.data.start, other.data.end)) return;
          other.data.gels.forEach((g) => g.gelCode && draftConflicts.add(g.gelCode));
        });

        return (
          <article key={row.uid} className="draft-card">
            <header className="draft-head">
              <span className="draft-index">草稿 {rowIdx + 1}</span>
              <button type="button" className="link-danger" onClick={() => remove(row.uid)}>
                移除
              </button>
            </header>

            <div className="draft-grid">
              <label>
                <span>Cue 编号</span>
                <input value={d.cueNo} placeholder="如 Cue 15" onChange={(e) => update(row.uid, { cueNo: e.target.value })} />
              </label>
              <label>
                <span>场景名称</span>
                <input value={d.name} placeholder="如 冷蓝侧光" onChange={(e) => update(row.uid, { name: e.target.value })} />
              </label>
              <label className={windowInvalid ? "field-error" : ""}>
                <span>演出开始</span>
                <input type="time" value={d.start} onChange={(e) => update(row.uid, { start: e.target.value })} />
              </label>
              <label className={windowInvalid ? "field-error" : ""}>
                <span>演出结束</span>
                <input type="time" value={d.end} onChange={(e) => update(row.uid, { end: e.target.value })} />
              </label>
              <label>
                <span>亮度预设 {d.brightness}%</span>
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={d.brightness}
                  onChange={(e) => update(row.uid, { brightness: Number(e.target.value) })}
                />
              </label>
              <label className="draft-note-field">
                <span>排演备注</span>
                <input value={d.note} placeholder="走位确认 / 版本等" onChange={(e) => update(row.uid, { note: e.target.value })} />
              </label>
            </div>

            <div className="draft-gels">
              <span className="sub-label">色片领用（按该时间窗口占用库存）</span>
              {d.gels.map((g, gi) => {
                const gel = gels.find((x) => x.code === g.gelCode);
                const clash = g.gelCode && draftConflicts.has(g.gelCode);
                return (
                  <div key={gi} className={`gel-line${clash ? " gel-line-clash" : ""}`}>
                    <select value={g.gelCode} onChange={(e) => updateGel(row.uid, gi, { gelCode: e.target.value })}>
                      <option value="">选择色片型号</option>
                      {gels.map((opt) => (
                        <option key={opt.code} value={opt.code}>
                          {opt.code} · {opt.name}（库存 {opt.stock}）
                        </option>
                      ))}
                    </select>
                    <input
                      type="number"
                      min={1}
                      value={g.qty}
                      onChange={(e) => updateGel(row.uid, gi, { qty: Math.max(1, Number(e.target.value) || 1) })}
                      aria-label="领用数量"
                    />
                    <span className="gel-line-unit">张</span>
                    {gel && <i className="gel-line-swatch" style={{ background: gel.color }} />}
                    {clash && <span className="inline-warn">与其他草稿时段重叠</span>}
                    <button type="button" className="link-danger" onClick={() => removeGelRow(row.uid, gi)} disabled={d.gels.length === 1}>
                      删除
                    </button>
                  </div>
                );
              })}
              <button type="button" className="mini" onClick={() => addGelRow(row.uid)}>
                + 添加色片
              </button>
            </div>

            <div className="draft-fixtures">
              <span className="sub-label">上场灯具（同步灯位图与场景预览）</span>
              <div className="fixture-picks">
                {fixtures.map((f) => (
                  <button
                    type="button"
                    key={f.id}
                    className={d.fixtureIds.includes(f.id) ? "pick pick-on" : "pick"}
                    onClick={() => toggleFixture(row.uid, f.id)}
                  >
                    {f.id}
                    <small>{f.type}·CH{f.channel}</small>
                  </button>
                ))}
              </div>
            </div>
          </article>
        );
      })}

      <div className="draft-actions">
        <button type="button" className="primary big" onClick={onSubmit} disabled={drafts.length === 0}>
          整次提交排演（原子校验）
        </button>
        <span className="draft-action-hint">
          提交时统一校验：重叠 Cue 重复领用同色片、或任一时段库存不足 → 整次排演失败，Cue 顺序、灯位图与库存保持不变。
        </span>
      </div>
    </div>
  );
}
