import { useMemo, useState } from "react";
import type { Cue, Gel } from "../types";
import { buildReturnLines, totalLoss, type CancelInput } from "../lib/scheduling";

interface CancelDialogProps {
  cue: Cue;
  gels: Gel[];
  onClose: () => void;
  onConfirm: (cue: Cue, lines: NonNullable<ReturnType<typeof buildReturnLines>["lines"]>) => void;
}

interface RowState {
  unopened: number;
  opened: number;
  leftover: number;
}

export function CancelDialog({ cue, gels, onClose, onConfirm }: CancelDialogProps) {
  const gelMap = new Map(gels.map((g) => [g.code, g]));
  const [rows, setRows] = useState<Record<string, RowState>>(() =>
    Object.fromEntries(
      cue.gels.map((g) => [
        g.gelCode,
        // 默认未拆封全退
        { unopened: g.qty, opened: 0, leftover: 0 } as RowState,
      ]),
    ),
  );

  const inputs: CancelInput[] = cue.gels.map((g) => {
    const r = rows[g.gelCode] ?? { unopened: g.qty, opened: 0, leftover: 0 };
    return { gelCode: g.gelCode, unopened: r.unopened, opened: r.opened, returnedLeftover: r.leftover };
  });

  const result = useMemo(() => buildReturnLines(cue, inputs), [cue, rows]);

  const setRow = (code: string, patch: Partial<RowState>) => {
    const cur = rows[code];
    if (!cur) return;
    const next = { ...cur, ...patch };
    // 余料退回不能超过已拆封张数
    if (next.leftover > next.opened) next.leftover = next.opened;
    setRows({ ...rows, [code]: next });
  };

  const lossSum = result.lines ? totalLoss(result.lines) : 0;
  const returnSum = result.lines
    ? result.lines.reduce((s, l) => s + l.unopened + l.returnedLeftover, 0)
    : 0;

  return (
    <div className="modal-mask" onMouseDown={onClose}>
      <div className="modal" role="dialog" aria-modal="true" onMouseDown={(e) => e.stopPropagation()}>
        <header className="modal-head">
          <h2>取消 {cue.cueNo} · {cue.name}</h2>
          <button type="button" className="modal-close" onClick={onClose} aria-label="关闭">
            ×
          </button>
        </header>
        <p className="modal-tip">
          演出时间窗口 {cue.start}–{cue.end}。逐行登记色片拆封情况：<b>未拆封全退</b>；<b>已拆封只退余料</b>，差额记为损耗并核销库存。
        </p>

        <div className="cancel-table">
          <div className="cancel-tr cancel-th">
            <span>色片</span>
            <span>领用</span>
            <span>未拆封（全退）</span>
            <span>已拆封</span>
            <span>退回余料</span>
            <span>损耗</span>
          </div>
          {cue.gels.map((req) => {
            const gel = gelMap.get(req.gelCode);
            const r = rows[req.gelCode] ?? { unopened: req.qty, opened: 0, leftover: 0 };
            const line = result.lines?.find((l) => l.gelCode === req.gelCode);
            const accounted = r.unopened + r.opened;
            return (
              <div key={req.gelCode} className="cancel-tr">
                <span className="cancel-gel">
                  <i className="gel-line-swatch" style={{ background: gel?.color ?? "#cbd5e1" }} />
                  <b>{req.gelCode}</b>
                  <em>{gel?.name ?? ""}</em>
                </span>
                <span className="cancel-qty">{req.qty}</span>
                <span>
                  <input
                    type="number"
                    min={0}
                    max={req.qty}
                    value={r.unopened}
                    onChange={(e) => {
                      const v = clampInt(e.target.value, 0, req.qty);
                      setRow(req.gelCode, { unopened: v, opened: req.qty - v });
                    }}
                    aria-label={`${req.gelCode} 未拆封张数`}
                  />
                </span>
                <span>
                  <input
                    type="number"
                    min={0}
                    max={req.qty}
                    value={r.opened}
                    onChange={(e) => {
                      const v = clampInt(e.target.value, 0, req.qty);
                      setRow(req.gelCode, { opened: v, unopened: req.qty - v });
                    }}
                    aria-label={`${req.gelCode} 已拆封张数`}
                  />
                </span>
                <span>
                  <input
                    type="number"
                    min={0}
                    max={r.opened}
                    value={r.leftover}
                    onChange={(e) => setRow(req.gelCode, { leftover: clampInt(e.target.value, 0, r.opened) })}
                    aria-label={`${req.gelCode} 退回余料`}
                  />
                </span>
                <span className={line && line.loss > 0 ? "loss-num" : ""}>{line?.loss ?? "—"}</span>
                {accounted !== req.qty && <small className="row-error">合计须为 {req.qty} 张</small>}
              </div>
            );
          })}
        </div>

        <div className="cancel-summary">
          <span>退回入库合计：<b>{returnSum}</b> 张</span>
          <span>损耗核销合计：<b className={lossSum > 0 ? "loss-num" : ""}>{lossSum}</b> 张</span>
        </div>
        {result.error && <p className="modal-error">{result.error}</p>}

        <footer className="modal-foot">
          <button type="button" onClick={onClose}>
            再想想（Cue 保留）
          </button>
          <button
            type="button"
            className="danger"
            disabled={!!result.error}
            onClick={() => result.lines && onConfirm(cue, result.lines)}
          >
            确认取消并退库
          </button>
        </footer>
      </div>
    </div>
  );
}

function clampInt(raw: string, min: number, max: number): number {
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.min(n, max);
}
