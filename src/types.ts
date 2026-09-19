// 根管复诊闭环：牙位 / 根管 / 复诊 / 修订 的核心数据模型

export type NextVisitType = "" | "dressing" | "obturation" | "microscope";

export type Stage = "open" | "measure" | "med" | "micro" | "filled";

/** 工作长度复测记录：缩短超过 1mm 时 reason 必填 */
export interface LengthRecord {
  value: number; // mm
  at: string; // YYYY-MM-DD
  reason?: string; // 重新测长原因
}

export interface Canal {
  id: string; // 例如 "#36-MB"
  name: string; // MB / ML / D …
  lengthHistory: LengthRecord[]; // 末条即当前工作长度；空 = 未测长
  masterApicalFile: string; // 主尖锉号，如 "#30"
  medCount: number; // 封药次数
  wetHistory: boolean[]; // 每次封药是否仍未干燥（true = 未干燥）
  nextVisit: NextVisitType; // 下次复诊安排
  nextVisitDate: string; // 下次复诊日
  filled: boolean; // 是否已充填
  filledAt: string;
}

/** 冻结病例的更正修订：自带旧版快照，形成修订链 */
export interface Revision {
  id: string;
  at: string;
  toothId: string;
  canalId: string;
  canalName: string;
  field: string;
  oldValue: string;
  newValue: string;
  reason: string; // 必填的修订/重测原因
  versionBefore: number;
  versionAfter: number;
  snapshot: Canal; // 保留的旧版根管数据
}

export interface Tooth {
  id: string; // 牙位，如 "#36"
  diagnosis: string;
  version: number; // 更正一次升一版
  canals: Canal[];
  updatedAt: string;
}

export type ConflictAction = "blocked" | "rerouted" | "recorded" | "integrity";

/** 冲突留痕：牙位、根管、原值、新值、触发规则 */
export interface ConflictEntry {
  id: string;
  at: string;
  toothId: string;
  canalName: string;
  field: string;
  oldValue: string;
  newValue: string;
  rule: string; // 规则编号
  ruleLabel: string;
  message: string;
  action: ConflictAction;
}

export interface Store {
  teeth: Tooth[];
  revisions: Revision[];
  conflicts: ConflictEntry[];
  savedAt: string;
}
