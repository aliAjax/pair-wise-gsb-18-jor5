import { useMemo, useState } from "react";
import "./styles.css";
import type { Canal, ConflictEntry, Stage, Store } from "./types";
import {
  RULES,
  STAGE_LABEL,
  TODAY,
  integrityChecks,
  latestLength,
  toothStage,
} from "./rules";
import {
  addTooth,
  dismissConflict,
  fillCanal,
  recordDressing,
  reviseFrozen,
  saveCanalEdit,
  type CanalEdit,
  type RevisableField,
} from "./engine";
import { loadStore, persistStore, resetStore } from "./storage";
import ToothCard from "./components/ToothCard";
import ConflictPanel from "./components/ConflictPanel";
import ReviseModal from "./components/ReviseModal";

const project = {
  id: "hxwl-04",
  port: 5104,
  title: "牙科根管治疗 · 复诊闭环",
  subtitle:
    "按牙位与根管记录工作长度、主尖锉号、封药次数与下次复诊；规则拦截直接充填，已充填病例仅可带原因修订。",
};

const FILTERS: Stage[] = ["open", "measure", "med", "micro", "filled"];

interface ReviseTarget {
  toothId: string;
  toothVersion: number;
  canal: Canal;
}

function applyResult(
  base: Store,
  result: { store: Store | null; conflicts: ConflictEntry[] }
) {
  // 无论是否拦截，冲突一律留痕；store 为 null 时状态不变
  if (result.store) {
    persistStore(result.store);
    return { store: result.store, conflicts: result.conflicts };
  }
  return { store: base, conflicts: result.conflicts };
}

function App() {
  const [store, setStore] = useState<Store>(() => loadStore());
  const [integrity, setIntegrity] = useState(() => integrityChecks(loadStore()));
  const [filter, setFilter] = useState<Stage | "all">("all");
  const [reviseTarget, setReviseTarget] = useState<ReviseTarget | null>(null);
  const [flash, setFlash] = useState<string>("");
  const [newToothOpen, setNewToothOpen] = useState(false);
  const [newId, setNewId] = useState("");
  const [newDiagnosis, setNewDiagnosis] = useState("");
  const [newCanals, setNewCanals] = useState("");

  const allConflicts = useMemo(
    () => [...integrity, ...store.conflicts].sort((a, b) => (a.at < b.at ? 1 : -1)),
    [integrity, store.conflicts]
  );

  const metrics = useMemo(() => {
    const unfilledCanals = store.teeth.flatMap((t) => t.canals.filter((c) => !c.filled));
    const filledCanals = store.teeth.flatMap((t) => t.canals.filter((c) => c.filled));
    const lengths = store.teeth
      .flatMap((t) => t.canals)
      .map(latestLength)
      .filter((v): v is number => v !== null);
    const medTeeth = new Set(
      store.teeth
        .filter((t) => t.canals.some((c) => c.medCount > 0 && !c.filled))
        .map((t) => t.id)
    );
    return [
      { label: "待复诊根管", value: String(unfilledCanals.filter((c) => c.nextVisitDate).length) },
      { label: "已充填根管", value: String(filledCanals.length) },
      {
        label: "平均工作长度",
        value: lengths.length ? `${(lengths.reduce((a, b) => a + b, 0) / lengths.length).toFixed(1)}mm` : "—",
      },
      { label: "封药牙位", value: String(medTeeth.size) },
    ];
  }, [store.teeth]);

  const visibleTeeth = useMemo(
    () => (filter === "all" ? store.teeth : store.teeth.filter((t) => toothStage(t) === filter)),
    [store.teeth, filter]
  );

  function commit(result: ReturnType<typeof saveCanalEdit>, okMsg?: string) {
    const next = applyResult(store, result);
    setStore(next.store);
    setIntegrity(integrityChecks(next.store));
    if (result.conflicts.length) {
      setFlash(result.conflicts.map((c) => `[${c.rule}] ${c.message}`).join(" "));
    } else if (okMsg) {
      setFlash(okMsg);
    }
    window.setTimeout(() => setFlash(""), 4000);
  }

  function handleEdit(toothId: string, canalId: string, edit: CanalEdit) {
    commit(saveCanalEdit(store, toothId, canalId, edit), "根管记录已保存。");
  }
  function handleDressing(toothId: string, canalId: string, wet: boolean) {
    commit(recordDressing(store, toothId, canalId, wet), wet ? "已记录封药（仍未干燥）。" : "已记录封药（干燥）。");
  }
  function handleFill(toothId: string, canalId: string) {
    commit(fillCanal(store, toothId, canalId), "根管已进入充填，该根管随即冻结。");
  }
  function handleRevise(field: RevisableField, newValue: string, reason: string) {
    if (!reviseTarget) return;
    const result = reviseFrozen(store, reviseTarget.toothId, reviseTarget.canal.id, field, newValue, reason);
    commit(result, "修订已提交：旧版已保留，版本号递增。");
    if (result.store) setReviseTarget(null);
  }
  function handleDismiss(id: string) {
    const next = dismissConflict(store, id);
    persistStore(next);
    setStore(next);
    setIntegrity(integrityChecks(next));
  }
  function handleRefresh() {
    const reloaded = loadStore();
    setStore(reloaded);
    setIntegrity(integrityChecks(reloaded));
    setFlash(`已按持久化数据刷新（${reloaded.savedAt}），牙位 / 根管 / 复诊 / 修订链重新校验完成。`);
    window.setTimeout(() => setFlash(""), 4000);
  }
  function handleReset() {
    const seeded = resetStore();
    setStore(seeded);
    setIntegrity(integrityChecks(seeded));
  }
  function handleAddTooth() {
    const result = addTooth(
      store,
      newId,
      newDiagnosis,
      newCanals.split(/[,，、\s]+/).filter(Boolean)
    );
    commit(result, `新牙位 ${newId} 已建档（根管初始为未测长）。`);
    if (result.store) {
      setNewToothOpen(false);
      setNewId("");
      setNewDiagnosis("");
      setNewCanals("");
    }
  }

  return (
    <main className="app-shell">
      <section className="hero">
        <div>
          <p className="eyebrow">{project.id} · port {project.port} · 今日 {TODAY}</p>
          <h1>{project.title}</h1>
          <p className="subtitle">{project.subtitle}</p>
          <div className="hero-actions">
            <button className="primary-action" onClick={handleRefresh}>模拟刷新 / 重新校验</button>
            <button onClick={() => setNewToothOpen((v) => !v)}>新增牙位</button>
            <button className="link-btn" onClick={handleReset}>恢复演示数据</button>
          </div>
          <p className="persist-state">持久化：localStorage · 最近保存 {store.savedAt}</p>
        </div>
        <div className="stack-card rules-card">
          <span>闭环规则</span>
          <ul>
            {Object.values(RULES).map((r) => (
              <li key={r.label}><b>{r.label}</b>：{r.text}</li>
            ))}
          </ul>
        </div>
      </section>

      {flash && <div className="flash-bar">{flash}</div>}

      <section className="metrics-grid">
        {metrics.map((m) => (
          <article className="metric-card" key={m.label}>
            <span>{m.label}</span>
            <strong>{m.value}</strong>
          </article>
        ))}
      </section>

      {newToothOpen && (
        <section className="panel new-tooth">
          <div className="section-heading">
            <div><p>建档</p><h2>新增牙位与根管</h2></div>
          </div>
          <div className="field-grid">
            <label className="field"><span>牙位（如 #25）</span><input value={newId} onChange={(e) => setNewId(e.target.value)} placeholder="#25" /></label>
            <label className="field"><span>诊断</span><input value={newDiagnosis} onChange={(e) => setNewDiagnosis(e.target.value)} placeholder="如 慢性牙髓炎" /></label>
            <label className="field field-wide"><span>根管名称（逗号分隔）</span><input value={newCanals} onChange={(e) => setNewCanals(e.target.value)} placeholder="MB, ML, D" /></label>
          </div>
          <div className="canal-actions">
            <button className="primary-action" onClick={handleAddTooth}>建档</button>
            <button onClick={() => setNewToothOpen(false)}>取消</button>
          </div>
        </section>
      )}

      <section className="workspace">
        <aside className="panel narrow">
          <h2>按阶段筛选</h2>
          <div className="chips muted">
            <button className={filter === "all" ? "active" : ""} onClick={() => setFilter("all")}>全部</button>
            {FILTERS.map((f) => (
              <button key={f} className={filter === f ? "active" : ""} onClick={() => setFilter(f)}>
                {STAGE_LABEL[f]}
              </button>
            ))}
          </div>
          <h2>角色</h2>
          <div className="chips">
            <span>牙科医生</span>
            <span>助理</span>
            <span>前台复诊协调员</span>
          </div>
          <h2>操作约定</h2>
          <ul className="side-notes">
            <li>未测长：充填按钮禁用，预约充填会被拦截。</li>
            <li>长度缩短 &gt;1mm：原因未填时保存被拦截。</li>
            <li>连续两次“仍未干燥”：自动改派显微会诊。</li>
            <li>已充填：只能走“更正 → 修订链”。</li>
          </ul>
        </aside>

        <section className="teeth-panel">
          {visibleTeeth.length === 0 ? (
            <p className="muted empty-hint">该筛选下暂无牙位。</p>
          ) : (
            visibleTeeth.map((tooth) => (
              <ToothCard
                key={tooth.id}
                tooth={tooth}
                revisions={store.revisions}
                onEdit={(canalId, edit) => handleEdit(tooth.id, canalId, edit)}
                onDressing={(canalId, wet) => handleDressing(tooth.id, canalId, wet)}
                onFill={(canalId) => handleFill(tooth.id, canalId)}
                onRevise={(canal) =>
                  setReviseTarget({ toothId: tooth.id, toothVersion: tooth.version, canal })
                }
              />
            ))
          )}
        </section>
      </section>

      <ConflictPanel conflicts={allConflicts} onDismiss={handleDismiss} />

      {reviseTarget && (
        <ReviseModal
          toothId={reviseTarget.toothId}
          toothVersion={reviseTarget.toothVersion}
          canal={reviseTarget.canal}
          onClose={() => setReviseTarget(null)}
          onSubmit={handleRevise}
        />
      )}
    </main>
  );
}

export default App;
