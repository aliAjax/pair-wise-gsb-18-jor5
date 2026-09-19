import type {
  Canal,
  CaseVersion,
  Conflict,
  LengthEvent,
  NextVisit,
  Stage,
  ToothCase,
  VisitType,
} from "./types";

export const uid = (): string =>
  Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

export const todayISO = (): string => new Date().toISOString().slice(0, 10);

/* ---------------- 派生指标 ---------------- */

export const latestLength = (canal: Canal): number | null =>
  canal.lengthEvents.length
    ? canal.lengthEvents[canal.lengthEvents.length - 1].length
    : null;

export const previousLength = (canal: Canal): number | null =>
  canal.lengthEvents.length > 1
    ? canal.lengthEvents[canal.lengthEvents.length - 2].length
    : null;

export const medCount = (canal: Canal): number => canal.medEvents.length;

/** 末尾连续未干燥封药次数（最后一次干燥即断流） */
export const wetStreak = (canal: Canal): number => {
  let n = 0;
  for (let i = canal.medEvents.length - 1; i >= 0; i--) {
    if (canal.medEvents[i].dry) break;
    n++;
  }
  return n;
};

export const currentVersion = (c: ToothCase): CaseVersion =>
  c.versions[c.versions.length - 1];

export const isFilled = (c: ToothCase): boolean => currentVersion(c).frozen;

/** 牙位治疗阶段由各根管进度聚合：未测长→测长/开髓，封药中→封药，已充填→充填 */
export const toothStage = (v: CaseVersion): Stage => {
  if (v.frozen) return "充填";
  if (v.canals.every((c) => c.medEvents.length > 0)) return "封药";
  if (v.canals.some((c) => c.lengthEvents.length > 0)) return "测长";
  return "开髓";
};

/** 牙位是否允许充填：以最严根管为准（未测长 / 连续两次湿封） */
export const canFillReasons = (v: CaseVersion): string[] => {
  const reasons: string[] = [];
  for (const c of v.canals) {
    if (latestLength(c) === null) reasons.push(`R1：${c.name} 未测长`);
    if (wetStreak(c) >= 2) reasons.push(`R3：${c.name} 连续两次封药未干燥，须显微会诊`);
  }
  return reasons;
};

/* ---------------- 规则定义 ---------------- */

export const RULES = {
  R1: {
    code: "R1",
    name: "未测长不得充填",
    text: "任一根管未记录工作长度时，禁止进入充填。",
  },
  R2: {
    code: "R2",
    name: "缩短 >1mm 必须填原因",
    text: "工作长度较上次缩短超过 1mm 时，必须填写重新测长原因。",
  },
  R3: {
    code: "R3",
    name: "两次未干燥只能显微会诊",
    text: "连续封药两次仍未干燥时，下次复诊只能安排显微会诊，不能直接充填。",
  },
  R4: {
    code: "R4",
    name: "已充填病例冻结",
    text: "已充填病例冻结，更正只能新建带原因的修订版并保留旧版。",
  },
  R5: {
    code: "R5",
    name: "刷新一致性校验",
    text: "刷新加载时校验牙位 / 根管 / 复诊 / 修订链一致性。",
  },
} as const;

export interface GuardResult {
  ok: boolean;
  conflict?: Omit<Conflict, "id" | "at" | "caseId" | "toothNo" | "status">;
}

const block = (
  canal: string,
  field: string,
  oldValue: string,
  newValue: string,
  rule: keyof typeof RULES,
  detail: string
): GuardResult => ({
  ok: false,
  conflict: {
    canal,
    field,
    oldValue,
    newValue,
    rule: `${RULES[rule].code} ${RULES[rule].name}`,
    detail,
  },
});

/** R2：新增测长事件守卫 */
export function guardLengthEvent(canal: Canal, next: LengthEvent): GuardResult {
  const prev = latestLength(canal);
  if (prev !== null && prev - next.length > 1) {
    if (!next.reason || !next.reason.trim()) {
      return block(
        canal.name,
        "工作长度",
        `${prev}mm`,
        `${next.length}mm`,
        "R2",
        `缩短 ${(prev - next.length).toFixed(1)}mm（>1mm），必须填写重新测长原因`
      );
    }
  }
  return { ok: true };
}

/** R1 + R3：充填守卫（逐根管检查，返回最严冲突） */
export function guardFill(v: CaseVersion): GuardResult {
  for (const c of v.canals) {
    if (latestLength(c) === null) {
      return block(
        c.name,
        "阶段",
        toothStage(v),
        "充填",
        "R1",
        `根管 ${c.name} 尚未测量工作长度，禁止进入充填`
      );
    }
    if (wetStreak(c) >= 2) {
      return block(
        c.name,
        "阶段",
        toothStage(v),
        "充填",
        "R3",
        `根管 ${c.name} 连续 ${wetStreak(c)} 次封药未干燥，只能安排显微会诊`
      );
    }
  }
  return { ok: true };
}

/** R3：安排下次复诊守卫 */
export function guardNextVisit(
  v: CaseVersion,
  next: NextVisit
): GuardResult {
  const wet = v.canals.filter((c) => wetStreak(c) >= 2);
  if (wet.length && next.type !== "显微会诊") {
    return block(
      wet.map((c) => c.name).join("、"),
      "下次复诊类型",
      v.nextVisit ? v.nextVisit.type : "（未安排）",
      next.type,
      "R3",
      `${wet.map((c) => c.name).join("、")} 连续两次封药未干燥，下次复诊只能安排显微会诊`
    );
  }
  return { ok: true };
}

/** R4：冻结病例写操作守卫（修订动作本身除外） */
export function guardFrozen(v: CaseVersion, action: string): GuardResult {
  if (v.frozen) {
    return block(
      "—",
      "冻结状态",
      `v${v.version} 已充填冻结`,
      action,
      "R4",
      "已充填病例冻结，更正只能新建带原因的修订版"
    );
  }
  return { ok: true };
}

/* ---------------- 修订链 ---------------- */

/** 深拷贝当前版形成新版本；新版本解冻（撤销充填），等待再次完成 */
export function makeRevision(c: ToothCase, reason: string, at: string): CaseVersion {
  const cur = currentVersion(c);
  const clone: CaseVersion = JSON.parse(JSON.stringify(cur));
  return {
    ...clone,
    version: cur.version + 1,
    createdAt: at,
    reason,
    frozen: false,
    filledAt: null,
  };
}

/* ---------------- 刷新一致性校验 ---------------- */

interface AuditIssue {
  canal: string;
  field: string;
  oldValue: string;
  newValue: string;
  detail: string;
}

export function auditCase(c: ToothCase): AuditIssue[] {
  const issues: AuditIssue[] = [];
  if (c.versions.length === 0) {
    issues.push({ canal: "—", field: "修订链", oldValue: "空", newValue: "-", detail: "病例没有任何版本" });
    return issues;
  }
  c.versions.forEach((v, i) => {
    if (v.version !== i + 1) {
      issues.push({
        canal: "—",
        field: "修订链",
        oldValue: `位置${i + 1}`,
        newValue: `v${v.version}`,
        detail: "版本号不连续",
      });
    }
    if (v.version >= 2 && (!v.reason || !v.reason.trim())) {
      issues.push({
        canal: "—",
        field: `v${v.version} 修订原因`,
        oldValue: "（空）",
        newValue: "必填",
        detail: "修订版必须带原因",
      });
    }
    v.canals.forEach((canal) => {
      if (latestLength(canal) === null && v.frozen) {
        issues.push({
          canal: canal.name,
          field: "工作长度",
          oldValue: "未测长",
          newValue: "已充填",
          detail: "已充填版本存在未测长根管",
        });
      }
      let prev: number | null = null;
      for (const e of canal.lengthEvents as LengthEvent[]) {
        if (prev !== null && prev - e.length > 1 && !e.reason?.trim()) {
          issues.push({
            canal: canal.name,
            field: "工作长度",
            oldValue: `${prev}mm`,
            newValue: `${e.length}mm`,
            detail: "缩短超过 1mm 缺少重新测长原因",
          });
        }
        prev = e.length;
      }
      if (wetStreak(canal) >= 2 && v.nextVisit && v.nextVisit.type !== "显微会诊" && !v.frozen) {
        issues.push({
          canal: canal.name,
          field: "下次复诊类型",
          oldValue: v.nextVisit.type,
          newValue: "显微会诊",
          detail: "连续两次封药未干燥却未安排显微会诊",
        });
      }
      if (wetStreak(canal) >= 2 && v.frozen) {
        issues.push({
          canal: canal.name,
          field: "阶段",
          oldValue: "充填",
          newValue: "显微会诊",
          detail: "连续两次封药未干燥的根管被充填",
        });
      }
    });
  });
  // 中间版本不应被改写标记：除最后一个版本外均应为不可变历史（有 filledAt 或曾冻结）
  c.versions.slice(0, -1).forEach((v) => {
    if (!v.frozen && v.filledAt === null && v.version >= 2) {
      // 修订后旧版曾经充填过即合法；这里只记录提示性问题
      issues.push({
        canal: "—",
        field: `v${v.version} 旧版`,
        oldValue: "历史版本",
        newValue: "未冻结",
        detail: "修订链中的旧版应保留为冻结快照",
      });
    }
  });
  return issues;
}

/* ---------------- 示例数据 ---------------- */

export function seedCases(at: string): ToothCase[] {
  const mkCanal = (
    name: string,
    lengths: Array<[string, number, string?]>,
    masterFile: string,
    meds: Array<[string, boolean, string?]> = []
  ): Canal => ({
    id: uid(),
    name,
    lengthEvents: lengths.map(([date, length, reason]) => ({
      id: uid(),
      date,
      length,
      reason,
    })),
    masterFile,
    medEvents: meds.map(([date, dry, note]) => ({ id: uid(), date, dry, note })),
  });

  // #11：已充填冻结病例 —— 演示 R4
  const v11: CaseVersion = {
    version: 1,
    createdAt: "2026-08-20T09:00:00.000Z",
    reason: null,
    frozen: true,
    filledAt: "2026-09-05T10:30:00.000Z",
    canals: [mkCanal("单根管", [["2026-08-20", 22.0], ["2026-09-05", 21.5]], "#35", [["2026-08-27", true, "棉捻干燥"]])],
    nextVisit: null,
  };

  // #36：MB/ML 均连续两次湿封 —— 下次复诊强制显微会诊，禁止充填（R3）
  const v36: CaseVersion = {
    version: 1,
    createdAt: "2026-08-18T09:00:00.000Z",
    reason: null,
    frozen: false,
    filledAt: null,
    canals: [
      mkCanal(
        "MB",
        [["2026-08-18", 19.5]],
        "#30",
        [["2026-08-25", false, "渗出较多"], ["2026-09-01", false, "仍有分泌物"]]
      ),
      mkCanal(
        "ML",
        [["2026-08-18", 19.0]],
        "#30",
        [["2026-08-25", false, "叩诊不适"], ["2026-09-01", false, "棉捻湿润"]]
      ),
      mkCanal("D", [["2026-08-18", 21.0]], "#35", [["2026-08-25", true, "干燥"]]),
    ],
    nextVisit: { date: "2026-09-22", type: "显微会诊" },
  };

  // #46：近中双根管测长阶段；MB2 第二次测长缩短 >1mm，需重新测长原因（R2），且尚未测长
  const v46: CaseVersion = {
    version: 1,
    createdAt: "2026-09-10T09:00:00.000Z",
    reason: null,
    frozen: false,
    filledAt: null,
    canals: [
      mkCanal(
        "MB",
        [["2026-09-10", 20.5], ["2026-09-17", 19.0]],
        "#25"
        // 注意：19.0 较 20.5 缩短 1.5mm 且未填原因 —— 刷新校验会标记 R2
      ),
      mkCanal("ML", [["2026-09-10", 20.0]], "#25"),
      mkCanal("D", [], "#30"), // 未测长 —— R1 拦截充填
    ],
    nextVisit: { date: "2026-09-24", type: "常规复诊" },
  };

  return [
    { id: uid(), toothNo: "#36", diagnosis: "慢性根尖周炎", createdAt: "2026-08-18", versions: [v36] },
    { id: uid(), toothNo: "#11", diagnosis: "外伤后变色", createdAt: "2026-08-20", versions: [v11] },
    { id: uid(), toothNo: "#46", diagnosis: "急性牙髓炎", createdAt: "2026-09-10", versions: [v46] },
  ];
}

export type { VisitType };
