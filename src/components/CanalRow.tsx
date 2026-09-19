import { useEffect, useState } from "react";
import type { Canal, NextVisitType, Tooth } from "../types";
import { VISIT_LABEL, canalStage, latestLength, stageClass, wetStreak } from "../rules";
import type { CanalEdit } from "../engine";

interface Props {
  tooth: Tooth;
  canal: Canal;
  onEdit: (canalId: string, edit: CanalEdit) => void;
  onDressing: (canalId: string, wet: boolean) => void;
  onFill: (canalId: string) => void;
  onRevise: (canal: Canal) => void;
}

function toEdit(canal: Canal): CanalEdit {
  const len = latestLength(canal);
  return {
    lengthText: len === null ? "" : String(len),
    reason: canal.lengthHistory[canal.lengthHistory.length - 1]?.reason ?? "",
    masterApicalFile: canal.masterApicalFile,
    nextVisit: canal.nextVisit,
    nextVisitDate: canal.nextVisitDate,
  };
}

export default function CanalRow({ tooth, canal, onEdit, onDressing, onFill, onRevise }: Props) {
  const [draft, setDraft] = useState<CanalEdit>(() => toEdit(canal));

  // 提交/刷新后以持久化状态为准，重置本行草稿
  useEffect(() => {
    setDraft(toEdit(canal));
  }, [canal]);

  const len = latestLength(canal);
  const streak = wetStreak(canal);
  const draftNum = draft.lengthText.trim() === "" ? null : Number(draft.lengthText);
  const shorten =
    len !== null && draftNum !== null && !Number.isNaN(draftNum) && draftNum < len - 1;

  if (canal.filled) {
    return (
      <div className="canal-row frozen">
        <div className="canal-head">
          <span className={`stage-tag ${stageClass("filled")}`}>已充填 · 冻结</span>
          <strong>{canal.name}</strong>
          <span className="muted">充填日 {canal.filledAt}</span>
        </div>
        <div className="canal-summary">
          <span>工作长度 <b>{len}mm</b></span>
          <span>主尖锉 <b>{canal.masterApicalFile || "—"}</b></span>
          <span>封药 <b>{canal.medCount}</b> 次</span>
        </div>
        <div className="canal-actions">
          <button className="revise-btn" onClick={() => onRevise(canal)}>
            更正（新建带原因修订）
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="canal-row">
      <div className="canal-head">
        <span className={`stage-tag ${stageClass(canalStage(canal))}`}>
          {canal.nextVisit === "microscope" ? "显微会诊" : streak >= 2 ? "封药·未干燥×2" : canal.medCount > 0 ? "封药" : len !== null ? "测长" : "开髓"}
        </span>
        <strong>{canal.name}</strong>
        {streak >= 2 && <em className="warn-chip">连续 {streak} 次未干燥 · 禁充填</em>}
      </div>

      <div className="canal-fields">
        <label className="field">
          <span>工作长度 mm {len === null && <i className="req">未测长</i>}</span>
          <input
            value={draft.lengthText}
            placeholder={len === null ? "测长后填写" : String(len)}
            onChange={(e) => setDraft({ ...draft, lengthText: e.target.value })}
          />
        </label>
        <label className={`field reason ${shorten ? "required" : ""}`}>
          <span>重新测长原因 {shorten && <i className="req">缩短&gt;1mm 必填</i>}</span>
          <input
            value={draft.reason}
            placeholder={shorten ? "必须填写原因后才能保存" : "长度缩短超过 1mm 时填写"}
            onChange={(e) => setDraft({ ...draft, reason: e.target.value })}
          />
        </label>
        <label className="field">
          <span>主尖锉号</span>
          <input
            value={draft.masterApicalFile}
            placeholder="如 #30"
            onChange={(e) => setDraft({ ...draft, masterApicalFile: e.target.value })}
          />
        </label>
        <label className="field">
          <span>下次复诊</span>
          <select
            value={draft.nextVisit}
            onChange={(e) => setDraft({ ...draft, nextVisit: e.target.value as NextVisitType })}
          >
            <option value="">未安排</option>
            <option value="dressing">继续封药</option>
            <option value="obturation">充填</option>
            <option value="microscope">显微会诊</option>
          </select>
        </label>
        <label className="field">
          <span>下次复诊日</span>
          <input
            type="date"
            value={draft.nextVisitDate}
            onChange={(e) => setDraft({ ...draft, nextVisitDate: e.target.value })}
          />
        </label>
      </div>

      <div className="canal-meta">
        <span>封药次数 <b>{canal.medCount}</b></span>
        <span>复诊计划 <b>{VISIT_LABEL[canal.nextVisit] || "—"}</b>{canal.nextVisitDate ? ` · ${canal.nextVisitDate}` : ""}</span>
        <details className="length-history">
          <summary>长度复测记录（{canal.lengthHistory.length}）</summary>
          {canal.lengthHistory.length === 0 ? (
            <p className="muted">尚未测长</p>
          ) : (
            <ol>
              {canal.lengthHistory.map((r, i) => (
                <li key={i}>
                  {r.at} · {r.value}mm{r.reason ? ` · 原因：${r.reason}` : ""}
                </li>
              ))}
            </ol>
          )}
        </details>
      </div>

      <div className="canal-actions">
        <button className="primary-action" onClick={() => onEdit(canal.id, draft)}>
          保存根管记录
        </button>
        <button onClick={() => onDressing(canal.id, false)} title="本次封药复诊时根管已干燥">
          封药（已干燥）
        </button>
        <button className="warn-btn" onClick={() => onDressing(canal.id, true)} title="本次封药复诊时根管仍未干燥">
          封药（仍未干燥）
        </button>
        <button
          className="fill-btn"
          onClick={() => onFill(canal.id)}
          disabled={len === null || streak >= 2}
          title={len === null ? "未测长不得充填" : streak >= 2 ? "连续两次未干燥，只能显微会诊" : "确认进入充填"}
        >
          进入充填
        </button>
      </div>
    </div>
  );
}
