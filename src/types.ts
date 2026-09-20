export type FixtureType = "面光" | "侧光" | "逆光" | "效果光";

export interface Fixture {
  id: string;
  label: string; // 灯具编号
  type: FixtureType;
  channel: string; // 通道号
  x: number; // 灯位图横坐标（百分比）
  y: number; // 灯位图纵坐标（百分比）
}

export interface Gel {
  id: string; // 色片型号
  name: string;
  color: string; // 预览色
  stock: number; // 在库（未拆封）数量
}

export interface CueGel {
  gelId: string;
  qty: number;
  opened: boolean; // 是否已拆封
  checkedOut: boolean; // 是否已领用（占用库存）
}

export type CueStatus = "pending" | "active" | "cancelled" | "done";

export interface Cue {
  id: string;
  name: string; // 场景名称
  fixtureIds: string[];
  focus: string; // 焦点位置
  focusConfirmed: boolean;
  dimmer: number; // 亮度预设 %
  start: number; // 演出时间窗口起点（分钟，0:00 起算）
  end: number; // 演出时间窗口终点
  gels: CueGel[];
  status: CueStatus;
}

export interface WasteRecord {
  id: string;
  at: string; // 记录时间
  gelId: string;
  gelName: string;
  qty: number; // 损耗数量
  source: string; // 来源（取消 Cue / 结束排演）
}

export interface RehearsalState {
  status: "idle" | "running" | "failed";
  errors: string[];
  ranAt: string | null;
}

export interface PersistedState {
  showName: string;
  versionNote: string;
  cues: Cue[];
  gels: Gel[];
  waste: WasteRecord[];
  rehearsal: RehearsalState;
  activeCueId: string | null;
  fixtureFilter: string;
  gelFilter: string;
}
