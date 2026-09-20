import type { Cue, Gel } from "../types";

interface CueListProps {
  cues: Cue[];
  gels: Gel[];
  previewCueId: string | null;
  onPreview: (id: string) => void;
  onCancel: (cue: Cue) => void;
}

export function CueList({ cues, gels, previewCueId, onPreview, onCancel }: CueListProps) {
  const gelMap = new Map(gels.map((g) => [g.code, g]));
  const sorted = [...cues].sort((a, b) => a.order - b.order);

  return (
    <div className="cue-list">
      {sorted.length === 0 && <p className="empty">暂无在排 Cue，请在下方排演单中新增并提交。</p>}
      {sorted.map((cue, idx) => {
        const active = cue.id === previewCueId;
        return (
          <article key={cue.id} className={`cue-card${active ? " cue-card-active" : ""}`}>
            <button type="button" className="cue-main" onClick={() => onPreview(cue.id)} title="点击载入场景预览">
              <span className="cue-order">{String(idx + 1).padStart(2, "0")}</span>
              <span className="cue-body">
                <span className="cue-title-row">
                  <b>{cue.cueNo}</b>
                  <em>{cue.name}</em>
                  {active && <i className="cue-preview-tag">预览中</i>}
                </span>
                <span className="cue-meta">
                  {cue.start}–{cue.end} · 亮度 {cue.brightness}% · {cue.fixtureIds.length} 台灯
                </span>
                <span className="cue-gels">
                  {cue.gels.map((g) => {
                    const gel = gelMap.get(g.gelCode);
                    return (
                      <span key={g.gelCode} className="gel-chip gel-chip-sm">
                        <i style={{ background: gel?.color ?? "#cbd5e1" }} />
                        {g.gelCode} ×{g.qty}
                      </span>
                    );
                  })}
                </span>
                {cue.note && <span className="cue-note">备注：{cue.note}</span>}
              </span>
            </button>
            <button type="button" className="danger-btn" onClick={() => onCancel(cue)}>
              取消 Cue
            </button>
          </article>
        );
      })}
    </div>
  );
}
