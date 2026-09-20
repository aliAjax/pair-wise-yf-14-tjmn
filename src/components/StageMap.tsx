import type { Cue, Fixture, Gel } from "../types";

interface StageMapProps {
  fixtures: Fixture[];
  gels: Gel[];
  previewCue: Cue | null;
  typeFilter: string[];
  gelFilter: string[];
  onSelectFixture?: (id: string) => void;
  selectedFixtureId?: string | null;
}

const TYPE_LABEL: Record<string, string> = {
  面光: "面光 FOH",
  侧光: "侧光 SL",
  逆光: "逆光 BK",
  效果光: "效果光 FX",
};

export function StageMap({
  fixtures,
  gels,
  previewCue,
  typeFilter,
  gelFilter,
  onSelectFixture,
  selectedFixtureId,
}: StageMapProps) {
  const gelMap = new Map(gels.map((g) => [g.code, g]));
  const activeIds = new Set(previewCue?.fixtureIds ?? []);

  const dimmed = (f: Fixture) => {
    if (typeFilter.length && !typeFilter.includes(f.type)) return true;
    if (gelFilter.length && (!f.gelCode || !gelFilter.includes(f.gelCode))) return true;
    return false;
  };

  return (
    <div className="stage-wrap">
      <div className="stage" role="img" aria-label="舞台平面灯位图">
        <div className="stage-label stage-label-top">观众厅 / 面光桥</div>
        <div className="stage-label stage-label-bottom">后台 / 天幕</div>
        {fixtures.map((f) => {
          const active = activeIds.has(f.id);
          const dim = dimmed(f);
          const gel = f.gelCode ? gelMap.get(f.gelCode) : undefined;
          return (
            <button
              type="button"
              key={f.id}
              className={[
                "lamp",
                `lamp-${f.type}`,
                active ? "lamp-active" : "",
                dim ? "lamp-dim" : "",
                selectedFixtureId === f.id ? "lamp-selected" : "",
              ].join(" ")}
              style={{ left: `${f.x}%`, top: `${f.y}%` }}
              title={`${f.id} · CH${String(f.channel).padStart(3, "0")} · ${f.focus}${
                gel ? ` · ${gel.code}` : ""
              }`}
              onClick={() => onSelectFixture?.(f.id)}
            >
              <span className="lamp-dot" style={{ background: gel?.color ?? "#94a3b8" }} />
              <span className="lamp-id">{f.id}</span>
            </button>
          );
        })}
      </div>
      <div className="stage-legend">
        {Object.entries(TYPE_LABEL).map(([type, label]) => (
          <span key={type} className={`legend-dot legend-${type}`}>
            <i />
            {label}
          </span>
        ))}
      </div>
    </div>
  );
}
