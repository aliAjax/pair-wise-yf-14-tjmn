import type { Cue, Fixture, Gel } from "../types";

interface ScenePreviewProps {
  cue: Cue | null;
  fixtures: Fixture[];
  gels: Gel[];
}

export function ScenePreview({ cue, fixtures, gels }: ScenePreviewProps) {
  if (!cue) {
    return (
      <div className="preview-empty">
        <p>当前场景：未选择</p>
        <span>在 Cue 列表中点击任意 Cue 载入舞台效果预览</span>
      </div>
    );
  }

  const gelMap = new Map(gels.map((g) => [g.code, g]));
  const used = fixtures.filter((f) => cue.fixtureIds.includes(f.id));

  // 场景主色调：取领用数量最多的色片颜色
  const primaryReq = [...cue.gels].sort((a, b) => b.qty - a.qty)[0];
  const primaryColor = primaryReq ? gelMap.get(primaryReq.gelCode)?.color ?? "#0f172a" : "#0f172a";

  return (
    <div className="preview">
      <div
        className="preview-stage"
        style={{
          background: `radial-gradient(circle at 50% 30%, ${primaryColor}55, transparent 70%), radial-gradient(circle at 50% 100%, #0b1220, #020617)`,
        }}
      >
        {used.map((f) => {
          const gel = f.gelCode ? gelMap.get(f.gelCode) : undefined;
          return (
            <span
              key={f.id}
              className="preview-beam"
              style={{
                left: `${f.x}%`,
                top: `${f.y}%`,
                opacity: 0.35 + (cue.brightness / 100) * 0.65,
                background: `radial-gradient(circle, ${gel?.color ?? "#f8fafc"}cc 0%, transparent 60%)`,
              }}
            />
          );
        })}
        <div className="preview-caption">
          <b>{cue.cueNo}</b>
          <span>{cue.name}</span>
        </div>
      </div>
      <div className="preview-info">
        <p className="preview-scene-name">
          当前场景：{cue.cueNo} · {cue.name}
        </p>
        <ul>
          <li>时间窗口：{cue.start}–{cue.end}</li>
          <li>亮度预设：{cue.brightness}%</li>
          <li>
            上场灯具：
            {used.map((f) => `${f.id}(CH${String(f.channel).padStart(3, "0")})`).join("、") || "无"}
          </li>
          <li>
            色片领用：
            {cue.gels.map((g) => `${g.gelCode} ${gelMap.get(g.gelCode)?.name ?? ""} ×${g.qty}`).join("、")}
          </li>
        </ul>
      </div>
    </div>
  );
}
