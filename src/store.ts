import type {
  Canal,
  CaseVersion,
  Conflict,
  NextVisit,
  PersistShape,
  ToothCase,
} from "./types";
import {
  RULES,
  auditCase,
  currentVersion,
  seedCases,
  todayISO,
  uid,
} from "./domain";

const STORAGE_KEY = "hxwl-04-root-canal-v1";

export interface AppState {
  cases: ToothCase[];
  conflicts: Conflict[];
}

export type Action =
  | { type: "ADD_CASE"; toothNo: string; diagnosis: string; canalNames: string[] }
  | { type: "ADD_LENGTH"; caseId: string; canalId: string; date: string; length: number; reason?: string }
  | { type: "SET_MASTER_FILE"; caseId: string; canalId: string; masterFile: string }
  | { type: "ADD_MED"; caseId: string; canalId: string; date: string; dry: boolean; note?: string }
  | { type: "SET_NEXT_VISIT"; caseId: string; next: NextVisit }
  | { type: "FILL"; caseId: string; date: string }
  | { type: "REVISE"; caseId: string; reason: string }
  | { type: "ADD_CONFLICT"; conflict: Omit<Conflict, "id" | "at" | "status"> }
  | { type: "RESOLVE_CONFLICT"; id: string }
  | { type: "CLEAR_CONFLICTS" }
  | { type: "RESET_SEED" };

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));

const mutateVersion = (
  cases: ToothCase[],
  caseId: string,
  fn: (v: CaseVersion) => void
): ToothCase[] =>
  cases.map((c) => {
    if (c.id !== caseId) return c;
    const copy = clone(c);
    fn(currentVersion(copy));
    return copy;
  });

const findCanal = (v: CaseVersion, canalId: string): Canal | undefined =>
  v.canals.find((x) => x.id === canalId);

export function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case "ADD_CASE": {
      const at = new Date().toISOString();
      const canals: Canal[] = action.canalNames
        .map((n) => n.trim())
        .filter(Boolean)
        .map((name) => ({
          id: uid(),
          name,
          lengthEvents: [],
          masterFile: "",
          medEvents: [],
        }));
      if (canals.length === 0) return state;
      const v: CaseVersion = {
        version: 1,
        createdAt: at,
        reason: null,
        frozen: false,
        filledAt: null,
        canals,
        nextVisit: null,
      };
      const c: ToothCase = {
        id: uid(),
        toothNo: action.toothNo.trim(),
        diagnosis: action.diagnosis.trim(),
        createdAt: todayISO(),
        versions: [v],
      };
      return { ...state, cases: [c, ...state.cases] };
    }

    case "ADD_LENGTH":
      return {
        ...state,
        cases: mutateVersion(state.cases, action.caseId, (v) => {
          const canal = findCanal(v, action.canalId);
          canal?.lengthEvents.push({
            id: uid(),
            date: action.date,
            length: action.length,
            reason: action.reason?.trim() || undefined,
          });
        }),
      };

    case "SET_MASTER_FILE":
      return {
        ...state,
        cases: mutateVersion(state.cases, action.caseId, (v) => {
          const canal = findCanal(v, action.canalId);
          if (canal) canal.masterFile = action.masterFile;
        }),
      };

    case "ADD_MED":
      return {
        ...state,
        cases: mutateVersion(state.cases, action.caseId, (v) => {
          const canal = findCanal(v, action.canalId);
          canal?.medEvents.push({
            id: uid(),
            date: action.date,
            dry: action.dry,
            note: action.note?.trim() || undefined,
          });
        }),
      };

    case "SET_NEXT_VISIT":
      return {
        ...state,
        cases: mutateVersion(state.cases, action.caseId, (v) => {
          v.nextVisit = action.next;
        }),
      };

    case "FILL":
      return {
        ...state,
        cases: mutateVersion(state.cases, action.caseId, (v) => {
          v.frozen = true;
          v.filledAt = new Date(action.date + "T12:00:00.000Z").toISOString();
          v.nextVisit = null;
        }),
      };

    case "REVISE":
      return {
        ...state,
        cases: state.cases.map((c) => {
          if (c.id !== action.caseId) return c;
          const copy = clone(c);
          const cur = currentVersion(copy);
          copy.versions.push({
            ...clone(cur),
            version: cur.version + 1,
            createdAt: new Date().toISOString(),
            reason: action.reason.trim(),
            frozen: false,
            filledAt: null,
          });
          return copy;
        }),
      };

    case "ADD_CONFLICT": {
      const conflict: Conflict = {
        ...action.conflict,
        id: uid(),
        at: new Date().toISOString(),
        status: "待处理",
      };
      return { ...state, conflicts: [conflict, ...state.conflicts] };
    }

    case "RESOLVE_CONFLICT":
      return {
        ...state,
        conflicts: state.conflicts.map((x) =>
          x.id === action.id ? { ...x, status: "已处理" } : x
        ),
      };

    case "CLEAR_CONFLICTS":
      return {
        ...state,
        conflicts: state.conflicts.filter((x) => x.status === "待处理"),
      };

    case "RESET_SEED":
      return { cases: seedCases(todayISO()), conflicts: [] };

    default:
      return state;
  }
}

/* ---------------- 持久化 ---------------- */

export function saveState(state: AppState): void {
  try {
    const payload: PersistShape = { schema: 1, ...state };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch {
    /* 存储不可用时静默降级为内存态 */
  }
}

function isValid(data: unknown): data is PersistShape {
  if (!data || typeof data !== "object") return false;
  const d = data as Record<string, unknown>;
  return Array.isArray(d.cases) && Array.isArray(d.conflicts);
}

/** 加载并执行刷新一致性校验；问题以 R5 冲突登记 */
export function loadState(): AppState {
  let state: AppState;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    if (isValid(parsed)) {
      state = { cases: parsed.cases, conflicts: parsed.conflicts };
    } else {
      state = { cases: seedCases(todayISO()), conflicts: [] };
    }
  } catch {
    state = { cases: seedCases(todayISO()), conflicts: [] };
  }

  const findings = state.cases.flatMap((c) =>
    auditCase(c).map((issue) => ({ c, issue }))
  );

  const open = state.conflicts.filter((x) => x.status === "待处理");
  const seen = new Set(
    open.map(
      (x) =>
        `${x.caseId}|${x.canal}|${x.field}|${x.oldValue}|${x.newValue}|${x.detail}`
    )
  );

  const additions: Conflict[] = [];
  for (const { c, issue } of findings) {
    const key = `${c.id}|${issue.canal}|${issue.field}|${issue.oldValue}|${issue.newValue}|${issue.detail}`;
    if (seen.has(key)) continue;
    seen.add(key);
    additions.push({
      id: uid(),
      at: new Date().toISOString(),
      caseId: c.id,
      toothNo: c.toothNo,
      canal: issue.canal,
      field: issue.field,
      oldValue: issue.oldValue,
      newValue: issue.newValue,
      rule: `${RULES.R5.code} ${RULES.R5.name}`,
      detail: issue.detail,
      status: "待处理",
    });
  }

  return { ...state, conflicts: [...additions, ...state.conflicts] };
}
