export type FixtureType = "面光" | "侧光" | "逆光" | "效果光";

export const FIXTURE_TYPES: FixtureType[] = ["面光", "侧光", "逆光", "效果光"];

/** 灯位图上的灯具 */
export interface Fixture {
  id: string; // 灯具编号，如 FOH-03
  channel: number; // 通道号
  type: FixtureType;
  x: number; // 灯位图坐标（0-100，横向百分比）
  y: number; // 灯位图坐标（0-100，纵向百分比）
  focus: string; // 焦点位置
  brightness: number; // 亮度预设 0-100
  gelCode?: string; // 当前已安装色片型号
}

/** 色片型号与库存 */
export interface Gel {
  code: string; // 型号（色号），如 L201
  name: string; // 名称
  color: string; // 色块
  stock: number; // 库存（张）
}

/** 一条色片领用需求 */
export interface GelRequest {
  gelCode: string;
  qty: number; // 领用张数
}

/** 已排入排演的 Cue，其色片按时间窗口占用库存 */
export interface Cue {
  id: string;
  cueNo: string; // Cue 12
  name: string; // 冷蓝侧光
  order: number; // 触发顺序
  start: string; // HH:MM
  end: string; // HH:MM
  brightness: number;
  fixtureIds: string[];
  gels: GelRequest[];
  note?: string;
}

/** 表单中尚未提交的排演草稿（整次排演批量提交） */
export interface CueDraft {
  cueNo: string;
  name: string;
  start: string;
  end: string;
  brightness: number;
  fixtureIds: string[];
  gels: GelRequest[];
  note: string;
}

/** 草稿在表单中的一行（uid 仅用于 React key 与局部编辑） */
export interface DraftRow {
  uid: string;
  data: CueDraft;
}

/** 取消 Cue 时逐行登记的退库结果 */
export interface ReturnLine {
  gelCode: string;
  qty: number; // 领用
  unopened: number; // 未拆封：全退
  opened: number; // 已拆封
  returnedLeftover: number; // 已拆封部分退回的余料（折合张）
  loss: number; // 损耗 = 已拆封 - 余料退回
}

/** 领用/损耗台账条目 */
export interface LedgerEntry {
  id: string;
  time: string;
  cueId: string;
  cueLabel: string;
  lines: ReturnLine[];
}

export interface AppState {
  showName: string;
  versionNote: string;
  fixtures: Fixture[];
  gels: Gel[];
  cues: Cue[];
  ledger: LedgerEntry[];
}
