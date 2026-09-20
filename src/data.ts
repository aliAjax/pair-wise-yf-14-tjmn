import type { Cue, Fixture, Gel } from "./types";

export const FIXTURE_TYPES = ["面光", "侧光", "逆光", "效果光"] as const;

export const seedFixtures: Fixture[] = [
  { id: "f1", label: "FOH-01", type: "面光", channel: "CH 001", x: 20, y: 8 },
  { id: "f2", label: "FOH-02", type: "面光", channel: "CH 002", x: 50, y: 8 },
  { id: "f3", label: "FOH-03", type: "面光", channel: "CH 003", x: 80, y: 8 },
  { id: "f4", label: "SL-L1", type: "侧光", channel: "CH 021", x: 8, y: 45 },
  { id: "f5", label: "SL-L2", type: "侧光", channel: "CH 022", x: 8, y: 66 },
  { id: "f6", label: "SL-R1", type: "侧光", channel: "CH 023", x: 92, y: 45 },
  { id: "f7", label: "SL-R2", type: "侧光", channel: "CH 024", x: 92, y: 66 },
  { id: "f8", label: "BL-01", type: "逆光", channel: "CH 041", x: 30, y: 30 },
  { id: "f9", label: "BL-02", type: "逆光", channel: "CH 042", x: 50, y: 30 },
  { id: "f10", label: "BL-03", type: "逆光", channel: "CH 043", x: 70, y: 30 },
  { id: "f11", label: "FX-01", type: "效果光", channel: "CH 061", x: 35, y: 82 },
  { id: "f12", label: "FX-02", type: "效果光", channel: "CH 062", x: 65, y: 82 },
];

export const seedGels: Gel[] = [
  { id: "R201", name: "冷蓝", color: "#3b82f6", stock: 12 },
  { id: "R203", name: "琥珀", color: "#f59e0b", stock: 10 },
  { id: "R105", name: "正红", color: "#ef4444", stock: 8 },
  { id: "R3204", name: "青绿", color: "#06b6d4", stock: 6 },
  { id: "R389", name: "紫", color: "#7c3aed", stock: 6 },
];

const T = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
};

export const seedCues: Cue[] = [
  {
    id: "cue-1",
    name: "开场冷场",
    fixtureIds: ["f1", "f2", "f3"],
    focus: "舞台中央",
    focusConfirmed: true,
    dimmer: 60,
    start: T("19:30"),
    end: T("19:45"),
    gels: [{ gelId: "R201", qty: 3, opened: false, checkedOut: false }],
    status: "pending",
  },
  {
    id: "cue-2",
    name: "冷蓝侧光",
    fixtureIds: ["f4", "f5"],
    focus: "二幕开场 · 左区",
    focusConfirmed: true,
    dimmer: 65,
    start: T("19:45"),
    end: T("20:10"),
    gels: [
      { gelId: "R201", qty: 2, opened: false, checkedOut: false },
      { gelId: "R3204", qty: 1, opened: false, checkedOut: false },
    ],
    status: "pending",
  },
  {
    id: "cue-3",
    name: "追光入场",
    fixtureIds: ["f3", "f11"],
    focus: "门口 · 需演员走位确认",
    focusConfirmed: false,
    dimmer: 80,
    start: T("20:10"),
    end: T("20:25"),
    gels: [{ gelId: "R203", qty: 2, opened: false, checkedOut: false }],
    status: "pending",
  },
  {
    id: "cue-4",
    name: "效果间奏",
    fixtureIds: ["f11", "f12"],
    focus: "全台流动",
    focusConfirmed: true,
    dimmer: 70,
    start: T("20:30"),
    end: T("20:50"),
    gels: [{ gelId: "R389", qty: 2, opened: false, checkedOut: false }],
    status: "pending",
  },
  {
    id: "cue-5",
    name: "暖色谢幕",
    fixtureIds: ["f1", "f2", "f3"],
    focus: "全台面光",
    focusConfirmed: false,
    dimmer: 80,
    start: T("21:00"),
    end: T("21:15"),
    gels: [
      { gelId: "R203", qty: 3, opened: false, checkedOut: false },
      { gelId: "R105", qty: 2, opened: false, checkedOut: false },
    ],
    status: "pending",
  },
];
