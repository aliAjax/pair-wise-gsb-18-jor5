import type { Canal, ConflictEntry, NextVisitType, Store, Tooth } from "./types";
import {
  RULES,
  TODAY,
  VISIT_LABEL,
  latestLength,
  makeConflict,
  uid,
  wetStreak,
} from "./rules";

export interface ActionResult {
  store: Store | null; // null = 触发硬性规则，状态未变更（冲突仍留痕）
  conflicts: ConflictEntry[];
}

function clone(store: Store): Store {
  return structuredClone(store);
}

function findCanal(store: Store, toothId: string, canalId: string) {
  const tooth = store.teeth.find((t) => t.id === toothId);
  const canal = tooth?.canals.find((c) => c.id === canalId);
  return { tooth, canal };
}

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

export interface CanalEdit {
  lengthText: string;
  reason: string;
  masterApicalFile: string;
  nextVisit: NextVisitType;
  nextVisitDate: string;
}

/** 保存单个根管的工作长度 / 主尖锉 / 复诊安排 */
export function saveCanalEdit(
  base: Store,
  toothId: string,
  canalId: string,
  edit: CanalEdit
): ActionResult {
  const conflicts: ConflictEntry[] = [];
  const store = clone(base);
  const { canal } = findCanal(store, toothId, canalId);
  if (!canal) return { store: null, conflicts };

  if (canal.filled) {
    conflicts.push(
      makeConflict({
        toothId,
        canalName: canal.name,
        field: "根管资料",
        oldValue: "冻结",
        newValue: "直接修改",
        rule: "R4",
        message: "已充填病例已冻结，更正只能新建带原因的修订并保留旧版。",
        action: "blocked",
      })
    );
    return { store: null, conflicts };
  }

  if (edit.lengthText.trim() !== "") {
    const value = Number(edit.lengthText);
    const prev = latestLength(canal);
    if (Number.isNaN(value) || value <= 0) {
      conflicts.push(
        makeConflict({
          toothId,
          canalName: canal.name,
          field: "工作长度",
          oldValue: prev === null ? "未测" : `${prev}mm`,
          newValue: edit.lengthText,
          rule: "R2",
          message: "工作长度必须为正数毫米值。",
          action: "blocked",
        })
      );
      return { store: null, conflicts };
    }
    if (prev !== null && value < prev - 1 && !edit.reason.trim()) {
      conflicts.push(
        makeConflict({
          toothId,
          canalName: canal.name,
          field: "工作长度",
          oldValue: `${prev}mm`,
          newValue: `${value}mm`,
          rule: "R1",
          message: `工作长度由 ${prev}mm 缩短到 ${value}mm（>1mm），必须填写重新测长原因。`,
          action: "blocked",
        })
      );
      return { store: null, conflicts };
    }
    if (prev !== value) {
      canal.lengthHistory.push({
        value,
        at: TODAY,
        reason: edit.reason.trim() || undefined,
      });
    }
  }

  canal.masterApicalFile = edit.masterApicalFile.trim();

  const oldVisit = VISIT_LABEL[canal.nextVisit];
  if (edit.nextVisit === "obturation") {
    if (latestLength(canal) === null) {
      conflicts.push(
        makeConflict({
          toothId,
          canalName: canal.name,
          field: "下次复诊",
          oldValue: oldVisit,
          newValue: VISIT_LABEL.obturation,
          rule: "R2",
          message: "该根管尚未测得工作长度，不得预约充填。",
          action: "blocked",
        })
      );
      return { store: null, conflicts };
    }
    if (wetStreak(canal) >= 2) {
      conflicts.push(
        makeConflict({
          toothId,
          canalName: canal.name,
          field: "下次复诊",
          oldValue: oldVisit,
          newValue: VISIT_LABEL.obturation,
          rule: "R3",
          message: "已连续封药两次仍未干燥，下次复诊只能安排显微会诊。",
          action: "blocked",
        })
      );
      return { store: null, conflicts };
    }
  }
  canal.nextVisit = edit.nextVisit;
  canal.nextVisitDate = edit.nextVisitDate;

  store.savedAt = TODAY;
  return { store, conflicts };
}

/** 记录一次封药；wet=未干燥 */
export function recordDressing(
  base: Store,
  toothId: string,
  canalId: string,
  wet: boolean
): ActionResult {
  const conflicts: ConflictEntry[] = [];
  const store = clone(base);
  const { canal } = findCanal(store, toothId, canalId);
  if (!canal) return { store: null, conflicts };

  if (canal.filled) {
    conflicts.push(
      makeConflict({
        toothId,
        canalName: canal.name,
        field: "封药",
        oldValue: "已充填",
        newValue: wet ? "封药（未干燥）" : "封药（干燥）",
        rule: "R4",
        message: "已充填病例已冻结，不能再追加封药。",
        action: "blocked",
      })
    );
    return { store: null, conflicts };
  }

  canal.medCount += 1;
  canal.wetHistory.push(wet);
  if (!canal.nextVisitDate) canal.nextVisitDate = addDays(TODAY, 7);

  const oldVisit = VISIT_LABEL[canal.nextVisit];
  if (wet && wetStreak(canal) >= 2 && canal.nextVisit !== "microscope") {
    canal.nextVisit = "microscope";
    conflicts.push(
      makeConflict({
        toothId,
        canalName: canal.name,
        field: "下次复诊",
        oldValue: oldVisit,
        newValue: VISIT_LABEL.microscope,
        rule: "R3",
        message: "连续封药两次仍未干燥，下次复诊自动改派显微会诊，禁止直接充填。",
        action: "rerouted",
      })
    );
  } else if (!canal.nextVisit) {
    canal.nextVisit = "dressing";
  }

  store.savedAt = TODAY;
  return { store, conflicts };
}

/** 进入充填（根管实际充填完成） */
export function fillCanal(base: Store, toothId: string, canalId: string): ActionResult {
  const conflicts: ConflictEntry[] = [];
  const store = clone(base);
  const { canal } = findCanal(store, toothId, canalId);
  if (!canal) return { store: null, conflicts };

  if (canal.filled) {
    conflicts.push(
      makeConflict({
        toothId,
        canalName: canal.name,
        field: "充填",
        oldValue: "已充填",
        newValue: "重复充填",
        rule: "R4",
        message: "该根管已充填并冻结。",
        action: "blocked",
      })
    );
    return { store: null, conflicts };
  }
  const len = latestLength(canal);
  if (len === null) {
    conflicts.push(
      makeConflict({
        toothId,
        canalName: canal.name,
        field: "充填",
        oldValue: "未充填",
        newValue: "充填",
        rule: "R2",
        message: "未测得工作长度，不得进入充填。",
        action: "blocked",
      })
    );
    return { store: null, conflicts };
  }
  if (wetStreak(canal) >= 2) {
    conflicts.push(
      makeConflict({
        toothId,
        canalName: canal.name,
        field: "充填",
        oldValue: "未充填",
        newValue: "充填",
        rule: "R3",
        message: "连续封药两次仍未干燥，只能安排显微会诊，不能直接充填。",
        action: "blocked",
      })
    );
    return { store: null, conflicts };
  }

  canal.filled = true;
  canal.filledAt = TODAY;
  canal.nextVisit = "";
  canal.nextVisitDate = "";
  store.savedAt = TODAY;
  return { store, conflicts };
}

export type RevisableField = "length" | "masterApicalFile" | "filled";

const FIELD_LABEL: Record<RevisableField, string> = {
  length: "工作长度",
  masterApicalFile: "主尖锉号",
  filled: "充填状态",
};

/** 冻结病例更正：新建带原因修订，保留旧版快照，牙位版本 +1 */
export function reviseFrozen(
  base: Store,
  toothId: string,
  canalId: string,
  field: RevisableField,
  newValue: string,
  reason: string
): ActionResult {
  const conflicts: ConflictEntry[] = [];
  const store = clone(base);
  const { tooth, canal } = findCanal(store, toothId, canalId);
  if (!tooth || !canal) return { store: null, conflicts };

  if (!reason.trim()) {
    conflicts.push(
      makeConflict({
        toothId,
        canalName: canal.name,
        field: "更正原因",
        oldValue: "",
        newValue: reason,
        rule: "R4",
        message: "冻结病例更正必须填写修订原因，旧版将原样保留。",
        action: "blocked",
      })
    );
    return { store: null, conflicts };
  }

  const snapshot = structuredClone(canal);
  const oldDisplay =
    field === "length"
      ? latestLength(canal) === null
        ? "未测"
        : `${latestLength(canal)}mm`
      : field === "masterApicalFile"
        ? canal.masterApicalFile || "—"
        : canal.filled
          ? `已充填 ${canal.filledAt}`
          : "未充填";

  if (field === "length") {
    const value = Number(newValue);
    if (Number.isNaN(value) || value <= 0) {
      conflicts.push(
        makeConflict({
          toothId,
          canalName: canal.name,
          field: "工作长度",
          oldValue: oldDisplay,
          newValue: newValue,
          rule: "R4",
          message: "修订后的工作长度必须为正数毫米值。",
          action: "blocked",
        })
      );
      return { store: null, conflicts };
    }
    const prev = latestLength(canal);
    canal.lengthHistory.push({ value, at: TODAY, reason: reason.trim() });
    if (canal.filled) {
      // 充填后长度更正，充填结论需重新评估：保留已充填标记但记录修订
    }
    void prev;
  } else if (field === "masterApicalFile") {
    canal.masterApicalFile = newValue.trim();
  } else {
    canal.filled = newValue === "true";
    if (!canal.filled) canal.filledAt = "";
  }

  const versionBefore = tooth.version;
  tooth.version += 1;
  tooth.updatedAt = TODAY;

  store.revisions.push({
    id: uid("rv"),
    at: TODAY,
    toothId,
    canalId,
    canalName: canal.name,
    field: FIELD_LABEL[field],
    oldValue: oldDisplay,
    newValue: field === "length" ? `${Number(newValue)}mm` : field === "filled" ? (newValue === "true" ? "已充填" : "未充填") : newValue,
    reason: reason.trim(),
    versionBefore,
    versionAfter: tooth.version,
    snapshot,
  });
  store.savedAt = TODAY;
  return { store, conflicts };
}

export function addTooth(base: Store, id: string, diagnosis: string, canalNames: string[]): ActionResult {
  const store = clone(base);
  const toothId = id.trim();
  const conflicts: ConflictEntry[] = [];
  if (!toothId) return { store: null, conflicts };
  if (store.teeth.some((t) => t.id === toothId)) {
    conflicts.push(
      makeConflict({
        toothId,
        canalName: "—",
        field: "牙位",
        oldValue: toothId,
        newValue: toothId,
        rule: "R5",
        message: "牙位已存在，刷新后会造成牙位主键冲突。",
        action: "blocked",
      })
    );
    return { store: null, conflicts };
  }
  const names = canalNames.map((n) => n.trim()).filter(Boolean);
  const canals: Canal[] = names.map((name) => ({
    id: `${toothId}-${name}`,
    name,
    lengthHistory: [],
    masterApicalFile: "",
    medCount: 0,
    wetHistory: [],
    nextVisit: "",
    nextVisitDate: "",
    filled: false,
    filledAt: "",
  }));
  const tooth: Tooth = {
    id: toothId,
    diagnosis: diagnosis.trim() || "待补充诊断",
    version: 1,
    canals,
    updatedAt: TODAY,
  };
  store.teeth.push(tooth);
  store.savedAt = TODAY;
  return { store, conflicts };
}

export function dismissConflict(base: Store, conflictId: string): Store {
  const store = clone(base);
  store.conflicts = store.conflicts.filter((c) => c.id !== conflictId);
  return store;
}

export { RULES };
