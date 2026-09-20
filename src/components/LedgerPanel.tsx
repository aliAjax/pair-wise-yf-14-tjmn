import type { LedgerEntry } from "../types";

interface LedgerPanelProps {
  ledger: LedgerEntry[];
}

export function LedgerPanel({ ledger }: LedgerPanelProps) {
  if (ledger.length === 0) {
    return <p className="empty">暂无退库 / 损耗记录。取消 Cue 后在此登记闭环台账。</p>;
  }
  return (
    <div className="ledger">
      {[...ledger].reverse().map((entry) => {
        const loss = entry.lines.reduce((s, l) => s + l.loss, 0);
        const returned = entry.lines.reduce((s, l) => s + l.unopened + l.returnedLeftover, 0);
        return (
          <article key={entry.id} className="ledger-row">
            <header>
              <b>{entry.cueLabel}</b>
              <span>{entry.time}</span>
            </header>
            <ul>
              {entry.lines.map((l) => (
                <li key={l.gelCode}>
                  <b>{l.gelCode}</b> 领用 {l.qty} → 未拆封退 {l.unopened}
                  {l.opened > 0 && <>，已拆封 {l.opened}（余料退 {l.returnedLeftover}）</>}
                  {l.loss > 0 && <em className="loss-num"> 损耗 {l.loss}</em>}
                </li>
              ))}
            </ul>
            <footer>
              退库 {returned} 张 · 核销损耗 {loss} 张
            </footer>
          </article>
        );
      })}
    </div>
  );
}
