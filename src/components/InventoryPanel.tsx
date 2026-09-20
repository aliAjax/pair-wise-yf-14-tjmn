import { useState } from "react";
import type { Gel } from "../types";
import type { GelOccupancy } from "../lib/storage";

interface InventoryPanelProps {
  gels: Gel[];
  occupancy: Map<string, GelOccupancy>;
  onAdjust: (code: string, nextStock: number) => void;
}

export function InventoryPanel({ gels, occupancy, onAdjust }: InventoryPanelProps) {
  const [editing, setEditing] = useState<string | null>(null);
  const [draftStock, setDraftStock] = useState("");

  const startEdit = (gel: Gel) => {
    setEditing(gel.code);
    setDraftStock(String(gel.stock));
  };

  const commit = (gel: Gel) => {
    const n = parseInt(draftStock, 10);
    if (Number.isFinite(n) && n >= 0) onAdjust(gel.code, n);
    setEditing(null);
  };

  return (
    <div className="inventory">
      {gels.map((gel) => {
        const occ = occupancy.get(gel.code);
        const peak = occ?.peak ?? 0;
        const pct = gel.stock > 0 ? Math.min(100, (peak / gel.stock) * 100) : peak > 0 ? 100 : 0;
        const tight = peak >= gel.stock;
        return (
          <div key={gel.code} className="inv-row">
            <span className="inv-swatch" style={{ background: gel.color }} />
            <div className="inv-main">
              <div className="inv-head">
                <b>{gel.code}</b>
                <em>{gel.name}</em>
                {occ?.cueCount ? <span className="inv-cues">{occ.cueCount} 个 Cue 领用</span> : null}
              </div>
              <div className="inv-bar">
                <i
                  className={tight ? "inv-fill inv-fill-tight" : "inv-fill"}
                  style={{ width: `${pct}%` }}
                />
              </div>
            </div>
            <div className="inv-stock">
              {editing === gel.code ? (
                <span className="inv-edit">
                  <input
                    value={draftStock}
                    onChange={(e) => setDraftStock(e.target.value.replace(/[^\d]/g, ""))}
                    onKeyDown={(e) => e.key === "Enter" && commit(gel)}
                    aria-label={`${gel.code} 库存数量`}
                  />
                  <button type="button" className="mini primary" onClick={() => commit(gel)}>
                    确定
                  </button>
                </span>
              ) : (
                <button type="button" className="inv-count" onClick={() => startEdit(gel)} title="点击盘点调整库存">
                  <strong className={tight ? "stock-tight" : ""}>{gel.stock}</strong>
                  <small>张 / 峰值占用 {peak}</small>
                </button>
              )}
            </div>
          </div>
        );
      })}
      <p className="inv-hint">库存为物理总数；未取消的在排 Cue 按演出时间窗口占用库存（峰值占用＝时间轴上同时领用的最大张数）。点击数量可盘点。</p>
    </div>
  );
}
