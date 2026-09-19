import { useState } from "react";
import type { Canal, Revision, Tooth } from "../types";
import { STAGE_LABEL, describeCanal, stageClass, toothStage } from "../rules";
import type { CanalEdit } from "../engine";
import CanalRow from "./CanalRow";

interface Props {
  tooth: Tooth;
  revisions: Revision[];
  onEdit: (canalId: string, edit: CanalEdit) => void;
  onDressing: (canalId: string, wet: boolean) => void;
  onFill: (canalId: string) => void;
  onRevise: (canal: Canal) => void;
}

export default function ToothCard({ tooth, revisions, onEdit, onDressing, onFill, onRevise }: Props) {
  const [showChain, setShowChain] = useState(false);
  const stage = toothStage(tooth);
  const chain = revisions
    .filter((r) => r.toothId === tooth.id)
    .sort((a, b) => b.versionBefore - a.versionBefore);
  const allFilled = tooth.canals.every((c) => c.filled);

  return (
    <article className={`tooth-card ${allFilled ? "is-frozen" : ""}`}>
      <header className="tooth-head">
        <div className="tooth-id">
          <h3>{tooth.id}</h3>
          <span className={`stage-tag ${stageClass(stage)}`}>{STAGE_LABEL[stage]}</span>
          <span className="version-tag">v{tooth.version}{chain.length > 0 && ` · 修订 ${chain.length} 次`}</span>
          {allFilled && <span className="frozen-tag">已充填 · 病例冻结</span>}
        </div>
        <p className="diagnosis">{tooth.diagnosis}</p>
        <div className="tooth-meta">
          <span>{tooth.canals.length} 个根管</span>
          <span>最近更新 {tooth.updatedAt}</span>
          {chain.length > 0 && (
            <button className="link-btn" onClick={() => setShowChain((v) => !v)}>
              {showChain ? "收起修订链" : `查看修订链（${chain.length}）`}
            </button>
          )}
        </div>
      </header>

      <div className="canal-list">
        {tooth.canals.map((canal) => (
          <CanalRow
            key={canal.id}
            tooth={tooth}
            canal={canal}
            onEdit={onEdit}
            onDressing={onDressing}
            onFill={onFill}
            onRevise={onRevise}
          />
        ))}
      </div>

      {showChain && (
        <div className="revision-chain">
          <h4>修订链（旧版全部保留）</h4>
          {chain.map((rev) => (
            <details key={rev.id} className="revision-item">
              <summary>
                <b>{rev.at}</b> · 根管 {rev.canalName} · {rev.field}：
                <span className="old-val">{rev.oldValue}</span> → <span className="new-val">{rev.newValue}</span>
                <em>v{rev.versionBefore}→v{rev.versionAfter}</em>
              </summary>
              <div className="revision-body">
                <p><b>修订原因：</b>{rev.reason}</p>
                <p className="muted"><b>旧版快照：</b>{describeCanal(rev.snapshot)}</p>
              </div>
            </details>
          ))}
        </div>
      )}
    </article>
  );
}
