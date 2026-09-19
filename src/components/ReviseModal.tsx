import { useState } from "react";
import type { Canal } from "../types";
import type { RevisableField } from "../engine";
import { latestLength } from "../rules";

interface Props {
  toothId: string;
  toothVersion: number;
  canal: Canal;
  onClose: () => void;
  onSubmit: (field: RevisableField, newValue: string, reason: string) => void;
}

export default function ReviseModal({ toothId, toothVersion, canal, onClose, onSubmit }: Props) {
  const [field, setField] = useState<RevisableField>("length");
  const [newValue, setNewValue] = useState(() => {
    const len = latestLength(canal);
    return len === null ? "" : String(len);
  });
  const [reason, setReason] = useState("");

  const len = latestLength(canal);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>冻结病例更正 · {toothId} / {canal.name}</h3>
        <p className="muted">
          已充填病例已冻结：本次更正将新建修订记录，旧版数据原样保留，牙位版本由 v{toothVersion} 升至 v{toothVersion + 1}。
        </p>
        <label className="field">
          <span>更正字段</span>
          <select
            value={field}
            onChange={(e) => {
              const f = e.target.value as RevisableField;
              setField(f);
              setNewValue(
                f === "length" ? (len === null ? "" : String(len)) : f === "masterApicalFile" ? canal.masterApicalFile : "true"
              );
            }}
          >
            <option value="length">工作长度</option>
            <option value="masterApicalFile">主尖锉号</option>
            <option value="filled">充填状态</option>
          </select>
        </label>
        <label className="field">
          <span>新值</span>
          {field === "filled" ? (
            <select value={newValue} onChange={(e) => setNewValue(e.target.value)}>
              <option value="true">已充填</option>
              <option value="false">撤回为未充填</option>
            </select>
          ) : (
            <input
              value={newValue}
              placeholder={field === "length" ? "新的工作长度 mm" : "新的主尖锉号"}
              onChange={(e) => setNewValue(e.target.value)}
            />
          )}
        </label>
        <label className="field required">
          <span><i className="req">必填</i> 更正 / 重新测长原因</span>
          <textarea
            rows={3}
            value={reason}
            placeholder="例如：术后复核发现参考点变化，依据新影像重测；旧版保留可追溯"
            onChange={(e) => setReason(e.target.value)}
          />
        </label>
        <div className="modal-actions">
          <button onClick={onClose}>取消</button>
          <button className="primary-action" onClick={() => onSubmit(field, newValue, reason)}>
            提交修订（保留旧版）
          </button>
        </div>
      </div>
    </div>
  );
}
