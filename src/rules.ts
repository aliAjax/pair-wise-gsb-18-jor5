import type {
  Canal,
  ConflictAction,
  ConflictEntry,
  NextVisitType,
  Stage,
  Store,
  Tooth,
} from "./types";

export const TODAY = "2026-09-19";

export const VISIT_LABEL: Record<NextVisitType, string> = {
  "": "未安排",
  dressing: "继续封药",
  obturation: "充填",
  microscope: "显微会诊",
};

export const STAGE_LABEL: Record<Stage, string> = {
  open: "开髓",
  measure: "测长",
  med: "封药",
  micro: "显微会诊",
  filled: "已充填",
};

/** 闭环规则清单：冲突留痕按此编号给出触发规则 */
export const RULES = {
  R1: {
    label: "R1 复测长原因",
    text: "工作长度缩短超过 1mm 时，必须填写重新测长原因。",
  },
  R2: {
    label: "R2 未测长禁充填",
    text: "根管未测得工作长度，不得进入充填（也不能预约充填复诊）。",
  },
  R3: {
    label: "R3 连续两次未干燥",
    text: "连续封药两次仍未干燥，下次复诊只能安排显微会诊，不能直接充填。",
  },
  R4: {
    label: "R4 已充填冻结",
    text: "已充填病例冻结；更正只能新建带原因的修订并保留旧版。",
  },
  R5: {
    label: "R5 刷新一致性",
    text: "刷新后牙位、根管、复诊与修订链必须一致，否则列入冲突。",
  },
} as const;

let seq = 0;
export function uid(prefix: string): string {
  seq += 1;
  return `${prefix}-${Date.now().toString(36)}-${seq}`;
}

export function latestLength(canal: Canal): number | null {
  return canal.lengthHistory.length
    ? canal.lengthHistory[canal.lengthHistory.length - 1].value
    : null;
}

/** 末尾连续“未干燥”的次数 */
export function wetStreak(canal: Canal): number {
  let n = 0;
  for (let i = canal.wetHistory.length - 1; i >= 0; i -= 1) {
    if (canal.wetHistory[i]) n += 1;
    else break;
  }
  return n;
}

export function canalStage(canal: Canal): Stage {
  if (canal.filled) return "filled";
  if (canal.nextVisit === "microscope") return "micro";
  if (canal.medCount > 0) return "med";
  if (latestLength(canal) !== null) return "measure";
  return "open";
}

export function toothStage(tooth: Tooth): Stage {
  const stages = tooth.canals.map(canalStage);
  if (stages.every((s) => s === "filled")) return "filled";
  if (stages.some((s) => s === "micro")) return "micro";
  if (stages.some((s) => s === "med")) return "med";
  if (stages.some((s) => s === "measure")) return "measure";
  return "open";
}

export function stageClass(stage: Stage): string {
  return `stage-${stage}`;
}

export function makeConflict(parts: {
  toothId: string;
  canalName: string;
  field: string;
  oldValue: string;
  newValue: string;
  rule: keyof typeof RULES;
  message: string;
  action: ConflictAction;
}): ConflictEntry {
  return {
    id: uid("cf"),
    at: TODAY,
    toothId: parts.toothId,
    canalName: parts.canalName,
    field: parts.field,
    oldValue: parts.oldValue,
    newValue: parts.newValue,
    rule: parts.rule,
    ruleLabel: RULES[parts.rule].label,
    message: parts.message,
    action: parts.action,
  };
}

export function describeCanal(canal: Canal): string {
  const len = latestLength(canal);
  const wet = wetStreak(canal);
  return [
    `WL ${len === null ? "未测" : `${len}mm`}`,
    `主尖锉 ${canal.masterApicalFile || "—"}`,
    `封药${canal.medCount}次${wet >= 2 ? "（连续未干燥）" : ""}`,
    `复诊 ${VISIT_LABEL[canal.nextVisit]}${canal.nextVisitDate ? ` ${canal.nextVisitDate}` : ""}`,
    canal.filled ? `已充填 ${canal.filledAt}` : "未充填",
  ].join("，");
}

/** 刷新后一致性校验：牙位 / 根管 / 复诊 / 修订链 */
export function integrityChecks(store: Store): ConflictEntry[] {
  const out: ConflictEntry[] = [];
  const push = (
    toothId: string,
    canalName: string,
    field: string,
    oldValue: string,
    newValue: string,
    message: string
  ) => {
    out.push(
      makeConflict({
        toothId,
        canalName,
        field,
        oldValue,
        newValue,
        rule: "R5",
        message,
        action: "integrity",
      })
    );
  };

  for (const tooth of store.teeth) {
    if (!tooth.canals.length) push(tooth.id, "—", "根管", "0", "0", "牙位下没有任何根管，闭环数据不完整。");
    for (const canal of tooth.canals) {
      const len = latestLength(canal);
      if (canal.nextVisit === "obturation" && len === null) {
        push(tooth.id, canal.name, "下次复诊", VISIT_LABEL[canal.nextVisit], "未测长", "预约了充填复诊但根管未测长。");
      }
      if (canal.nextVisit === "obturation" && wetStreak(canal) >= 2) {
        push(tooth.id, canal.name, "下次复诊", VISIT_LABEL[canal.nextVisit], "显微会诊", "连续两次未干燥仍安排直接充填。");
      }
      for (let i = 1; i < canal.lengthHistory.length; i += 1) {
        const prev = canal.lengthHistory[i - 1];
        const cur = canal.lengthHistory[i];
        if (cur.value < prev.value - 1 && !cur.reason) {
          push(
            tooth.id,
            canal.name,
            "工作长度",
            `${prev.value}mm`,
            `${cur.value}mm`,
            "工作长度缩短超过 1mm 但缺少重新测长原因。"
          );
        }
      }
    }
  }

  const revisionsByTooth = new Map<string, Store["revisions"]>();
  for (const rev of store.revisions) {
    const list = revisionsByTooth.get(rev.toothId) ?? [];
    list.push(rev);
    revisionsByTooth.set(rev.toothId, list);
  }
  for (const [toothId, revs] of revisionsByTooth) {
    const ordered = [...revs].sort((a, b) => a.versionBefore - b.versionBefore);
    for (let i = 1; i < ordered.length; i += 1) {
      if (ordered[i].versionBefore !== ordered[i - 1].versionAfter) {
        push(
          toothId,
          ordered[i].canalName,
          "修订链",
          `v${ordered[i - 1].versionAfter}`,
          `v${ordered[i].versionBefore}`,
          "修订链版本断裂，旧版衔接不一致。"
        );
      }
    }
    const tooth = store.teeth.find((t) => t.id === toothId);
    const head = ordered[ordered.length - 1];
    if (tooth && head && head.versionAfter !== tooth.version) {
      push(toothId, head.canalName, "版本", `v${head.versionAfter}`, `v${tooth.version}`, "牙位当前版本与修订链头部不一致。");
    }
  }
  return out;
}
