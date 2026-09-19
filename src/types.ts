// 根管复诊闭环：领域模型
// 层级：牙位(ToothCase) -> 版本链(CaseVersion[]) -> 根管(Canal[]) -> 测长/封药事件

export type Stage = "开髓" | "测长" | "封药" | "充填";

export type VisitType = "常规复诊" | "显微会诊";

/** 工作长度测量记录；缩短超过 1mm 时 reason 必填 */
export interface LengthEvent {
  id: string;
  date: string;
  length: number; // mm
  reason?: string; // 重新测长原因
}

/** 封药记录：每次复诊记录该根管是否已干燥 */
export interface MedEvent {
  id: string;
  date: string;
  dry: boolean;
  note?: string;
}

export interface Canal {
  id: string;
  name: string; // MB / ML / D / 单根管 …
  lengthEvents: LengthEvent[];
  masterFile: string; // 主尖锉号，如 #30
  medEvents: MedEvent[];
}

export interface NextVisit {
  date: string; // 下次复诊日
  type: VisitType;
}

export interface CaseVersion {
  version: number; // 从 1 开始，只追加
  createdAt: string;
  reason: string | null; // v1 为 null；修订版必须带原因
  frozen: boolean; // 已充填即冻结
  filledAt: string | null;
  canals: Canal[];
  nextVisit: NextVisit | null;
}

export interface ToothCase {
  id: string;
  toothNo: string; // 牙位，如 #36
  diagnosis: string;
  createdAt: string;
  versions: CaseVersion[]; // 修订链，最后一个为当前版
}

/** 规则冲突：固定输出 牙位/根管/原值/新值/触发规则 */
export interface Conflict {
  id: string;
  at: string;
  caseId: string;
  toothNo: string;
  canal: string; // 牙位级规则填 "—"
  field: string;
  oldValue: string;
  newValue: string;
  rule: string;
  detail: string;
  status: "待处理" | "已处理";
}

export interface PersistShape {
  schema: 1;
  cases: ToothCase[];
  conflicts: Conflict[];
}
