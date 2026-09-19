import { useEffect, useMemo, useReducer, useState } from "react";
import "./styles.css";
import type { Canal, Conflict, NextVisit, Stage, ToothCase } from "./types";
import {
  RULES,
  canFillReasons,
  currentVersion,
  guardFill,
  guardFrozen,
  guardLengthEvent,
  guardNextVisit,
  isFilled,
  latestLength,
  medCount,
  todayISO,
  toothStage,
  wetStreak,
  type GuardResult,
} from "./domain";
import { loadState, reducer, saveState } from "./store";

const STAGE_ORDER: Stage[] = ["开髓", "测长", "封药", "充填"];
const STAGE_FILTERS = ["全部", ...STAGE_ORDER] as const;
type StageFilter = (typeof STAGE_FILTERS)[number];

type ModalSpec =
  | { kind: "length"; caseId: string; canalId: string; canalName: string; prev: number | null }
  | { kind: "med"; caseId: string; canalId: string; canalName: string }
  | { kind: "visit"; caseId: string }
  | { kind: "fill"; caseId: string }
  | { kind: "revise"; caseId: string; version: number };

const fmtDateTime = (iso: string): string => iso.replace("T", " ").slice(0, 16);

/* ----------------------------- 小组件 ----------------------------- */

function MetricCard({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <article className={"metric-card" + (tone ? " " + tone : "")}>
      <span>{label}</span>
      <strong>{value}</strong>
    </article>
  );
}

function StageBadge({ stage }: { stage: Stage }) {
  const cls = stage === "充填" ? "badge badge-filled" : "badge badge-stage";
  return <span className={cls}>{stage}</span>;
}

function VersionChain({ c }: { c: ToothCase }) {
  return (
    <div className="version-chain">
      {c.versions.map((v, i) => (
        <span key={v.version} className="chain-wrap">
          <span className={"chain-node" + (i === c.versions.length - 1 ? " current" : "")}>
            v{v.version}
            {v.frozen ? " · 冻结" : ""}
            {v.reason ? ` · 修订：${v.reason}` : ""}
          </span>
          {i < c.versions.length - 1 && <i className="chain-arrow">→</i>}
        </span>
      ))}
    </div>
  );
}

function CanalPanel({
  c,
  canal,
  onLength,
  onMed,
  onMasterFile,
}: {
  c: ToothCase;
  canal: Canal;
  onLength: () => void;
  onMed: () => void;
  onMasterFile: (v: string) => void;
}) {
  const frozen = isFilled(c);
  const length = latestLength(canal);
  const wet = wetStreak(canal);
  return (
    <div className={"canal-card" + (wet >= 2 ? " wet" : "")}>
      <div className="canal-head">
        <h4>{canal.name}</h4>
        {wet >= 2 && <span className="badge badge-danger">连续{wet}次未干燥</span>}
        {!length && <span className="badge badge-warn">未测长</span>}
      </div>

      <dl className="canal-metrics">
        <div>
          <dt>工作长度</dt>
          <dd>{length === null ? "—" : `${length.toFixed(1)} mm`}</dd>
        </div>
        <div>
          <dt>主尖锉号</dt>
          <dd>
            <input
              className="mini-input"
              value={canal.masterFile}
              disabled={frozen}
              placeholder="#00"
              onChange={(e) => onMasterFile(e.target.value)}
            />
          </dd>
        </div>
        <div>
          <dt>封药次数</dt>
          <dd>{medCount(canal)}</dd>
        </div>
      </dl>

      {canal.lengthEvents.length > 0 && (
        <ul className="event-list">
          {canal.lengthEvents.map((e, i) => (
            <li key={e.id}>
              <span className="event-date">{e.date}</span>
              <span>测长 {e.length.toFixed(1)}mm</span>
              {i > 0 &&
                canal.lengthEvents[i - 1].length - e.length > 1 &&
                (e.reason ? (
                  <span className="chip chip-reason">复测原因：{e.reason}</span>
                ) : (
                  <span className="chip chip-violation">缩短&gt;1mm · 缺原因</span>
                ))}
            </li>
          ))}
        </ul>
      )}

      {canal.medEvents.length > 0 && (
        <ul className="event-list">
          {canal.medEvents.map((e) => (
            <li key={e.id}>
              <span className="event-date">{e.date}</span>
              <span>第{canal.medEvents.indexOf(e) + 1}次封药</span>
              <span className={"chip " + (e.dry ? "chip-dry" : "chip-wet")}>
                {e.dry ? "已干燥" : "未干燥"}
              </span>
              {e.note && <span className="event-note">{e.note}</span>}
            </li>
          ))}
        </ul>
      )}

      {!frozen && (
        <div className="canal-actions">
          <button onClick={onLength}>测长</button>
          <button onClick={onMed}>封药</button>
        </div>
      )}
    </div>
  );
}

function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="modal-mask" onMouseDown={onClose}>
      <div className="modal" onMouseDown={(e) => e.stopPropagation()}>
        <header className="modal-head">
          <h3>{title}</h3>
          <button className="icon-btn" onClick={onClose} aria-label="关闭">
            ×
          </button>
        </header>
        {children}
      </div>
    </div>
  );
}

/* ----------------------------- 主应用 ----------------------------- */

function App() {
  const [state, dispatch] = useReducer(reducer, undefined, loadState);
  const [filter, setFilter] = useState<StageFilter>("全部");
  const [modal, setModal] = useState<ModalSpec | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  // 表单态
  const [newTooth, setNewTooth] = useState("");
  const [newDiagnosis, setNewDiagnosis] = useState("");
  const [newCanals, setNewCanals] = useState("");
  const [fDate, setFDate] = useState(todayISO());
  const [fLength, setFLength] = useState("");
  const [fReason, setFReason] = useState("");
  const [mDate, setMDate] = useState(todayISO());
  const [mDry, setMDry] = useState<"dry" | "wet">("dry");
  const [mNote, setMNote] = useState("");
  const [vDate, setVDate] = useState(todayISO());
  const [vType, setVType] = useState<NextVisit["type"]>("常规复诊");
  const [fillDate, setFillDate] = useState(todayISO());
  const [revReason, setRevReason] = useState("");

  useEffect(() => saveState(state), [state]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2600);
    return () => clearTimeout(t);
  }, [toast]);

  const openModal = (spec: ModalSpec) => {
    setError(null);
    if (spec.kind === "length") {
      setFDate(todayISO());
      setFLength(spec.prev === null ? "" : String(spec.prev));
      setFReason("");
    }
    if (spec.kind === "med") {
      setMDate(todayISO());
      setMDry("dry");
      setMNote("");
    }
    if (spec.kind === "visit") {
      const v = currentVersion(state.cases.find((x) => x.id === spec.caseId)!);
      setVDate(v.nextVisit?.date ?? todayISO());
      setVType(v.nextVisit?.type ?? "常规复诊");
    }
    if (spec.kind === "fill") setFillDate(todayISO());
    if (spec.kind === "revise") setRevReason("");
    setModal(spec);
  };

  /* ---------- 指标 ---------- */
  const metrics = useMemo(() => {
    const cur = state.cases.map(currentVersion);
    const waiting = cur.filter((v) => !v.frozen && v.nextVisit).length;
    const filled = cur.filter((v) => v.frozen).length;
    const medicating = cur.filter((v) => !v.frozen && toothStage(v) === "封药").length;
    const lengths = cur.flatMap((v) =>
      v.canals.map(latestLength).filter((x): x is number => x !== null)
    );
    const avg = lengths.length
      ? (lengths.reduce((a, b) => a + b, 0) / lengths.length).toFixed(1)
      : "—";
    return { waiting, filled, medicating, avg };
  }, [state.cases]);

  const openConflicts = state.conflicts.filter((x) => x.status === "待处理");

  const filtered = state.cases.filter((c) => {
    if (filter === "全部") return true;
    return toothStage(currentVersion(c)) === filter;
  });

  /* ---------- 冲突登记 ---------- */
  const registerConflict = (caseId: string, g: GuardResult) => {
    if (g.ok || !g.conflict) return;
    const toothNo = state.cases.find((x) => x.id === caseId)?.toothNo ?? "—";
    dispatch({
      type: "ADD_CONFLICT",
      conflict: { caseId, toothNo, ...g.conflict },
    });
    setError(g.conflict.detail);
  };

  const requireWritable = (caseId: string, action: string): boolean => {
    const c = state.cases.find((x) => x.id === caseId);
    if (!c) return false;
    const g = guardFrozen(currentVersion(c), action);
    if (!g.ok) {
      registerConflict(caseId, g);
      return false;
    }
    return true;
  };

  /* ---------- 提交处理 ---------- */
  const addCase = () => {
    const names = newCanals.split(/[,，、\s]+/).filter(Boolean);
    if (!newTooth.trim() || names.length === 0) {
      setError("牙位与至少一个根管名必填");
      return;
    }
    dispatch({
      type: "ADD_CASE",
      toothNo: newTooth,
      diagnosis: newDiagnosis,
      canalNames: names,
    });
    setNewTooth("");
    setNewDiagnosis("");
    setNewCanals("");
    setError(null);
    setToast("已建立牙位病例与根管档案");
  };

  const submitLength = () => {
    if (!modal || modal.kind !== "length") return;
    const length = parseFloat(fLength);
    if (!Number.isFinite(length) || length <= 0) {
      setError("请输入有效工作长度（mm）");
      return;
    }
    if (!requireWritable(modal.caseId, "测长录入")) return;
    const c = state.cases.find((x) => x.id === modal.caseId)!;
    const canal = currentVersion(c).canals.find((x) => x.id === modal.canalId)!;
    const g = guardLengthEvent(canal, {
      id: "",
      date: fDate,
      length,
      reason: fReason,
    });
    if (!g.ok) {
      registerConflict(modal.caseId, g);
      return;
    }
    dispatch({
      type: "ADD_LENGTH",
      caseId: modal.caseId,
      canalId: modal.canalId,
      date: fDate,
      length,
      reason: fReason,
    });
    setModal(null);
    setToast(`${canal.name} 工作长度已记录：${length.toFixed(1)}mm`);
  };

  const submitMed = () => {
    if (!modal || modal.kind !== "med") return;
    if (!requireWritable(modal.caseId, "封药登记")) return;
    const c = state.cases.find((x) => x.id === modal.caseId)!;
    const canal = currentVersion(c).canals.find((x) => x.id === modal.canalId)!;
    dispatch({
      type: "ADD_MED",
      caseId: modal.caseId,
      canalId: modal.canalId,
      date: mDate,
      dry: mDry === "dry",
      note: mNote,
    });
    const afterWet = wetStreak(canal) + (mDry === "wet" ? 1 : 0);
    setModal(null);
    setToast(
      mDry === "dry"
        ? `${canal.name} 封药干燥，可继续复诊流程`
        : afterWet >= 2
          ? `${canal.name} 连续${afterWet}次未干燥：下次复诊只能安排显微会诊`
          : `${canal.name} 已登记封药（未干燥）`
    );
  };

  const submitVisit = () => {
    if (!modal || modal.kind !== "visit") return;
    if (!requireWritable(modal.caseId, "安排复诊")) return;
    const c = state.cases.find((x) => x.id === modal.caseId)!;
    const v = currentVersion(c);
    const next: NextVisit = { date: vDate, type: vType };
    const g = guardNextVisit(v, next);
    if (!g.ok) {
      registerConflict(modal.caseId, g);
      return;
    }
    dispatch({ type: "SET_NEXT_VISIT", caseId: modal.caseId, next });
    setModal(null);
    setToast(`下次复诊：${vDate} ${vType}`);
  };

  const submitFill = () => {
    if (!modal || modal.kind !== "fill") return;
    const c = state.cases.find((x) => x.id === modal.caseId)!;
    const g = guardFill(currentVersion(c));
    if (!g.ok) {
      registerConflict(modal.caseId, g);
      return;
    }
    dispatch({ type: "FILL", caseId: modal.caseId, date: fillDate });
    setModal(null);
    setToast(`${c.toothNo} 已完成充填并冻结`);
  };

  const submitRevise = () => {
    if (!modal || modal.kind !== "revise") return;
    if (!revReason.trim()) {
      setError("修订必须填写原因");
      return;
    }
    dispatch({ type: "REVISE", caseId: modal.caseId, reason: revReason });
    setModal(null);
    setToast("已创建带原因的修订版，旧版保留在修订链中");
  };

  const activeCase =
    modal && modal.kind !== "length" && modal.kind !== "med"
      ? state.cases.find((c) => c.id === modal.caseId)
      : null;

  const visitForcedMicro =
    modal?.kind === "visit"
      ? currentVersion(state.cases.find((x) => x.id === modal.caseId)!).canals.some(
          (cn) => wetStreak(cn) >= 2
        )
      : false;

  const fillBlockers =
    modal?.kind === "fill"
      ? canFillReasons(currentVersion(state.cases.find((x) => x.id === modal.caseId)!))
      : [];

  /* ---------- 渲染 ---------- */
  return (
    <main className="app-shell">
      <section className="hero">
        <div>
          <p className="eyebrow">hxwl-04 · 根管复诊闭环</p>
          <h1>牙科根管治疗</h1>
          <p className="subtitle">
            按牙位 × 根管记录工作长度、主尖锉号、封药次数与下次复诊日；规则引擎在测长、复诊、充填、修订各环节实时拦截，刷新后修订链与冲突记录一致。
          </p>
        </div>
        <div className="stack-card">
          <span>闭环规则</span>
          <strong>
            R1 未测长不充填 · R2 缩短&gt;1mm 填原因 · R3 两次湿封转显微会诊 · R4 充填冻结留痕修订
          </strong>
        </div>
      </section>

      <section className="metrics-grid">
        <MetricCard label="待复诊" value={String(metrics.waiting)} />
        <MetricCard label="已充填（冻结）" value={String(metrics.filled)} tone="tone-filled" />
        <MetricCard label="封药病例" value={String(metrics.medicating)} tone="tone-watch" />
        <MetricCard label="平均工作长度(mm)" value={metrics.avg} />
      </section>

      <section className="workspace">
        <aside className="panel narrow">
          <h2>角色</h2>
          <div className="chips">
            {["牙科医生", "助理", "前台复诊协调员"].map((u) => (
              <span key={u}>{u}</span>
            ))}
          </div>
          <h2>阶段筛选</h2>
          <div className="chips muted filter-chips">
            {STAGE_FILTERS.map((f) => (
              <button
                key={f}
                className={filter === f ? "active" : ""}
                onClick={() => setFilter(f)}
              >
                {f}
              </button>
            ))}
          </div>
          <h2>规则速查</h2>
          <ul className="rule-list">
            {Object.values(RULES).map((r) => (
              <li key={r.code}>
                <strong>{r.code}</strong>
                <span>{r.text}</span>
              </li>
            ))}
          </ul>
        </aside>

        <section className="panel">
          <div className="section-heading">
            <div>
              <p>牙体牙髓 · 建案</p>
              <h2>新增牙位 / 根管</h2>
            </div>
          </div>
          <div className="field-grid">
            <label>
              <span>牙位（FDI）</span>
              <input
                value={newTooth}
                placeholder="如 #26"
                onChange={(e) => setNewTooth(e.target.value)}
              />
            </label>
            <label>
              <span>诊断</span>
              <input
                value={newDiagnosis}
                placeholder="如 慢性根尖周炎"
                onChange={(e) => setNewDiagnosis(e.target.value)}
              />
            </label>
            <label className="span-2">
              <span>根管（多个用逗号/顿号分隔，如 MB、ML、D）</span>
              <input
                value={newCanals}
                placeholder="MB, ML, D"
                onChange={(e) => setNewCanals(e.target.value)}
              />
            </label>
          </div>
          {error && !modal && <p className="inline-error">{error}</p>}
          <div className="form-actions">
            <button className="primary-action" onClick={addCase}>
              新增牙位病例
            </button>
          </div>
        </section>
      </section>

      <section className="panel cases-panel">
        <div className="section-heading">
          <div>
            <p>复诊闭环 · {filtered.length} 个牙位</p>
            <h2>牙位与根管工作区</h2>
          </div>
          <button className="ghost-btn" onClick={() => dispatch({ type: "RESET_SEED" })}>
            重置示例数据
          </button>
        </div>

        <div className="case-list">
          {filtered.map((c) => {
            const v = currentVersion(c);
            const stage = toothStage(v);
            const caseConflicts = openConflicts.filter((x) => x.caseId === c.id);
            return (
              <article key={c.id} className={"case-card" + (v.frozen ? " frozen" : "")}>
                <header className="case-head">
                  <div className="case-title">
                    <h3>{c.toothNo}</h3>
                    <p className="diagnosis">{c.diagnosis || "（未填诊断）"}</p>
                  </div>
                  <div className="case-tags">
                    <StageBadge stage={stage} />
                    {v.frozen && <span className="badge badge-frozen">已充填 · 冻结</span>}
                    {v.filledAt && <span className="muted-text">充填于 {v.filledAt.slice(0, 10)}</span>}
                  </div>
                </header>

                <VersionChain c={c} />

                <div className="visit-row">
                  <div className="visit-info">
                    <span className="visit-label">下次复诊</span>
                    {v.nextVisit ? (
                      <strong>
                        {v.nextVisit.date}
                        <span
                          className={
                            "badge " +
                            (v.nextVisit.type === "显微会诊" ? "badge-danger" : "badge-info")
                          }
                        >
                          {v.nextVisit.type}
                        </span>
                      </strong>
                    ) : (
                      <strong className="muted-text">{v.frozen ? "已闭环" : "未安排"}</strong>
                    )}
                  </div>
                  {!v.frozen && (
                    <button onClick={() => openModal({ kind: "visit", caseId: c.id })}>
                      安排复诊
                    </button>
                  )}
                </div>

                <div className="canal-grid">
                  {v.canals.map((canal) => (
                    <CanalPanel
                      key={canal.id}
                      c={c}
                      canal={canal}
                      onLength={() =>
                        openModal({
                          kind: "length",
                          caseId: c.id,
                          canalId: canal.id,
                          canalName: canal.name,
                          prev: latestLength(canal),
                        })
                      }
                      onMed={() =>
                        openModal({ kind: "med", caseId: c.id, canalId: canal.id, canalName: canal.name })
                      }
                      onMasterFile={(val) =>
                        dispatch({ type: "SET_MASTER_FILE", caseId: c.id, canalId: canal.id, masterFile: val })
                      }
                    />
                  ))}
                </div>

                {caseConflicts.length > 0 && (
                  <div className="case-conflicts">
                    本牙位有 {caseConflicts.length} 条待处理规则冲突（见下方冲突台账）
                  </div>
                )}

                <footer className="case-footer">
                  {v.frozen ? (
                    <button
                      className="revise-btn"
                      onClick={() =>
                        openModal({ kind: "revise", caseId: c.id, version: v.version })
                      }
                    >
                      申请修订（新建 v{v.version + 1}，需填原因）
                    </button>
                  ) : (
                    <button
                      className="fill-btn"
                      onClick={() => openModal({ kind: "fill", caseId: c.id })}
                    >
                      进入充填
                    </button>
                  )}
                </footer>
              </article>
            );
          })}
          {filtered.length === 0 && <p className="empty-hint">当前筛选下暂无牙位病例</p>}
        </div>
      </section>

      <section className="panel conflicts-panel">
        <div className="section-heading">
          <div>
            <p>规则台账 · {openConflicts.length} 条待处理 / {state.conflicts.length} 条总计</p>
            <h2>冲突与修订记录</h2>
          </div>
          <button className="ghost-btn" onClick={() => dispatch({ type: "CLEAR_CONFLICTS" })}>
            清除已处理
          </button>
        </div>
        {state.conflicts.length === 0 ? (
          <p className="empty-hint">暂无冲突：牙位、根管、复诊与修订链全部一致。</p>
        ) : (
          <div className="table-wrap">
            <table className="conflict-table">
              <thead>
                <tr>
                  <th>时间</th>
                  <th>牙位</th>
                  <th>根管</th>
                  <th>字段</th>
                  <th>原值</th>
                  <th>新值</th>
                  <th>触发规则</th>
                  <th>说明</th>
                  <th>状态</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {state.conflicts.map((x: Conflict) => (
                  <tr key={x.id} className={x.status === "已处理" ? "resolved" : ""}>
                    <td className="nowrap">{fmtDateTime(x.at)}</td>
                    <td>{x.toothNo}</td>
                    <td>{x.canal}</td>
                    <td>{x.field}</td>
                    <td>{x.oldValue}</td>
                    <td>{x.newValue}</td>
                    <td className="rule-cell">{x.rule}</td>
                    <td>{x.detail}</td>
                    <td>
                      <span className={"badge " + (x.status === "待处理" ? "badge-warn" : "badge-done")}>
                        {x.status}
                      </span>
                    </td>
                    <td>
                      {x.status === "待处理" && (
                        <button
                          className="mini-btn"
                          onClick={() => dispatch({ type: "RESOLVE_CONFLICT", id: x.id })}
                        >
                          处理
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ---------------- 弹窗 ---------------- */}
      {modal?.kind === "length" && (
        <Modal title={`测长 · ${modal.canalName}`} onClose={() => setModal(null)}>
          <div className="modal-body">
            <label>
              <span>测量日期</span>
              <input type="date" value={fDate} onChange={(e) => setFDate(e.target.value)} />
            </label>
            <label>
              <span>工作长度（mm）</span>
              <input
                type="number"
                step="0.1"
                min="0"
                value={fLength}
                onChange={(e) => setFLength(e.target.value)}
              />
            </label>
            <label className="span-2">
              <span>
                重新测长原因
                {modal.prev !== null &&
                  parseFloat(fLength) < modal.prev &&
                  modal.prev - parseFloat(fLength) > 1 && (
                    <em className="required">（缩短 &gt;1mm，必填 · R2）</em>
                  )}
              </span>
              <input
                value={fReason}
                placeholder={
                  modal.prev !== null && modal.prev - parseFloat(fLength || "0") > 1
                    ? "如：根尖孔吸收 / 参照点变化 / 疏通后复测"
                    : "无缩短时可留空"
                }
                onChange={(e) => setFReason(e.target.value)}
              />
            </label>
            {error && <p className="inline-error span-2">⛔ {error}</p>}
          </div>
          <footer className="modal-foot">
            <button onClick={() => setModal(null)}>取消</button>
            <button className="primary-action" onClick={submitLength}>
              保存测长
            </button>
          </footer>
        </Modal>
      )}

      {modal?.kind === "med" && (
        <Modal title={`封药登记 · ${modal.canalName}`} onClose={() => setModal(null)}>
          <div className="modal-body">
            <label>
              <span>封药日期</span>
              <input type="date" value={mDate} onChange={(e) => setMDate(e.target.value)} />
            </label>
            <label>
              <span>干燥情况</span>
              <select
                value={mDry}
                onChange={(e) => setMDry(e.target.value as "dry" | "wet")}
              >
                <option value="dry">已干燥（棉捻无渗出）</option>
                <option value="wet">未干燥（仍有渗出/分泌物）</option>
              </select>
            </label>
            <label className="span-2">
              <span>备注</span>
              <input value={mNote} placeholder="如 棉捻湿润、叩诊不适" onChange={(e) => setMNote(e.target.value)} />
            </label>
            {error && <p className="inline-error span-2">⛔ {error}</p>}
          </div>
          <footer className="modal-foot">
            <button onClick={() => setModal(null)}>取消</button>
            <button className="primary-action" onClick={submitMed}>
              保存封药
            </button>
          </footer>
        </Modal>
      )}

      {modal?.kind === "visit" && activeCase && (
        <Modal title={`安排下次复诊 · ${activeCase.toothNo}`} onClose={() => setModal(null)}>
          <div className="modal-body">
            <label>
              <span>复诊日期</span>
              <input type="date" value={vDate} onChange={(e) => setVDate(e.target.value)} />
            </label>
            <label>
              <span>复诊类型{visitForcedMicro && <em className="required">（R3 强制显微会诊）</em>}</span>
              <select
                value={visitForcedMicro ? "显微会诊" : vType}
                disabled={visitForcedMicro}
                onChange={(e) => setVType(e.target.value as NextVisit["type"])}
              >
                <option value="常规复诊">常规复诊</option>
                <option value="显微会诊">显微会诊</option>
              </select>
            </label>
            {visitForcedMicro && (
              <p className="rule-note span-2">
                存在连续两次封药未干燥的根管，下次复诊只能安排显微会诊，且在会诊前不能直接充填。
              </p>
            )}
            {error && <p className="inline-error span-2">⛔ {error}</p>}
          </div>
          <footer className="modal-foot">
            <button onClick={() => setModal(null)}>取消</button>
            <button className="primary-action" onClick={submitVisit}>
              保存复诊
            </button>
          </footer>
        </Modal>
      )}

      {modal?.kind === "fill" && activeCase && (
        <Modal title={`进入充填 · ${activeCase.toothNo}`} onClose={() => setModal(null)}>
          <div className="modal-body">
            <label>
              <span>充填日期</span>
              <input type="date" value={fillDate} onChange={(e) => setFillDate(e.target.value)} />
            </label>
            <div className="span-2 fill-check">
              {currentVersion(activeCase).canals.map((cn) => {
                const len = latestLength(cn);
                const wet = wetStreak(cn);
                const blocked = len === null || wet >= 2;
                return (
                  <div key={cn.id} className={"fill-check-row" + (blocked ? " blocked" : " ok")}>
                    <strong>{cn.name}</strong>
                    <span>工作长度：{len === null ? "未测长" : `${len.toFixed(1)}mm`}</span>
                    <span>封药：{medCount(cn)} 次{wet >= 2 ? `（连续${wet}次未干燥）` : ""}</span>
                    <span className="badge">{blocked ? "不满足充填条件" : "可充填"}</span>
                  </div>
                );
              })}
            </div>
            {fillBlockers.length > 0 && (
              <p className="inline-error span-2">
                {fillBlockers.map((b, i) => (
                  <span key={i}>⛔ {b}<br /></span>
                ))}
              </p>
            )}
            {error && <p className="inline-error span-2">⛔ {error}</p>}
          </div>
          <footer className="modal-foot">
            <button onClick={() => setModal(null)}>取消</button>
            <button
              className="fill-btn"
              disabled={fillBlockers.length > 0}
              onClick={submitFill}
            >
              确认充填并冻结
            </button>
          </footer>
        </Modal>
      )}

      {modal?.kind === "revise" && activeCase && (
        <Modal title={`修订申请 · ${activeCase.toothNo}`} onClose={() => setModal(null)}>
          <div className="modal-body">
            <p className="rule-note span-2">
              v{modal.version} 已充填冻结，不能原地改写。确认后将新建 v{modal.version + 1}{" "}
              修订版（解冻可编辑），旧版完整保留在修订链中。
            </p>
            <label className="span-2">
              <span>修订原因<em className="required">（必填 · R4）</em></span>
              <textarea
                rows={3}
                value={revReason}
                placeholder="如：术后影像提示欠填 1.5mm，需重新预备充填"
                onChange={(e) => setRevReason(e.target.value)}
              />
            </label>
            {error && <p className="inline-error span-2">⛔ {error}</p>}
          </div>
          <footer className="modal-foot">
            <button onClick={() => setModal(null)}>取消</button>
            <button className="revise-btn" onClick={submitRevise}>
              创建修订版
            </button>
          </footer>
        </Modal>
      )}

      {toast && <div className="toast">{toast}</div>}
    </main>
  );
}

export default App;
