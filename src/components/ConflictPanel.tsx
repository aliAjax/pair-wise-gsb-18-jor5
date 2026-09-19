import type { ConflictEntry } from "../types";

const ACTION_LABEL: Record<ConflictEntry["action"], string> = {
  blocked: "已拦截",
  rerouted: "已改派",
  recorded: "已留痕",
  integrity: "刷新校验",
};

export default function ConflictPanel({
  conflicts,
  onDismiss,
}: {
  conflicts: ConflictEntry[];
  onDismiss: (id: string) => void;
}) {
  return (
    <section className="panel conflict-panel">
      <div className="section-heading">
        <div>
          <p>规则留痕</p>
          <h2>冲突与拦截</h2>
        </div>
        <span className="conflict-count">{conflicts.length} 条</span>
      </div>
      {conflicts.length === 0 ? (
        <p className="muted empty-hint">当前没有规则冲突。刷新后会自动重新校验牙位、根管、复诊与修订链。</p>
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
                <th>说明 / 处理</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {conflicts.map((c) => (
                <tr key={c.id} className={`act-${c.action}`}>
                  <td>{c.at}</td>
                  <td><b>{c.toothId}</b></td>
                  <td>{c.canalName}</td>
                  <td>{c.field}</td>
                  <td className="old-val">{c.oldValue || "—"}</td>
                  <td className="new-val">{c.newValue || "—"}</td>
                  <td><span className="rule-tag">{c.ruleLabel}</span></td>
                  <td className="msg-cell">
                    {c.message}
                    <em className="action-tag">{ACTION_LABEL[c.action]}</em>
                  </td>
                  <td>
                    <button className="link-btn" onClick={() => onDismiss(c.id)}>清除</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
