import React, { useEffect, useState } from "react";

import { notify } from "@ui/components/ui/notify";
import { getFnfRecoveryCap, saveFnfRecoveryCap } from "../api/payrollSetup";

/**
 * How much of a leaver's final wages a full and final may take for loans and
 * advances. Half is the law's limit; a company may hold it lower. The rest
 * stays owed by the person. Only the owner or an admin changes it.
 */
export function FnfRecoverySetting() {
  const [saved, setSaved] = useState(null);
  const [percent, setPercent] = useState("50");
  const [failed, setFailed] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    getFnfRecoveryCap()
      .then((s) => {
        setSaved(s);
        setPercent(String(s.percent));
      })
      .catch((e) => setFailed(String(e?.message || "Could not read this setting.")));
  }, []);

  if (failed) return <p className="ui-caption" role="alert">{failed}</p>;
  if (!saved) return null;

  const share = Number(percent);
  const shareOk = percent.trim() !== "" && Number.isInteger(share) && share >= 0 && share <= 50;
  const dirty = shareOk && share !== saved.percent;

  const save = async () => {
    setSaving(true);
    try {
      const next = await saveFnfRecoveryCap({ percent: share });
      setSaved(next);
      setPercent(String(next.percent));
      notify.success(`Full and final settlements recover up to ${next.percent}% of the final wages.`);
    } catch (e) {
      notify.error(String(e?.message || "Could not save this setting."));
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="space-y-3 ui-touch-44" aria-labelledby="fnf-cap-title">
      <div>
        <h2 id="fnf-cap-title" className="ui-t-sec">Loans and advances in a full and final</h2>
        <p className="ui-caption max-w-[65ch]">
          A full and final recovers loans and advances up to this share of the final wages (Code on Wages 2019, s.18(3)). Final wages are salary for days worked, notice pay owed, leave encashment and other earnings, never gratuity or reimbursements. The rest stays owed by the person, on their loan or advance, for HR to collect outside payroll.
        </p>
      </div>
      {saved.canEdit ? (
        <>
          <label className="block max-w-[12rem]">
            <span className="ui-label">Share of final wages, in %</span>
            <input
              type="number"
              inputMode="numeric"
              min={0}
              max={50}
              className="ui-input w-full"
              value={percent}
              onChange={(e) => setPercent(e.target.value)}
              aria-invalid={!shareOk}
            />
            <span className="ui-caption block">{shareOk ? "50% is the most the law allows." : "A whole number from 0 to 50."}</span>
          </label>
          <div>
            <button type="button" className="ui-btn ui-btn-secondary" disabled={!dirty || saving} onClick={save}>
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
        </>
      ) : (
        <p className="text-sm">
          <span className="ui-num tabular-nums">{saved.percent}%</span> of the final wages.
          <span className="ui-caption block">Only the owner or an admin changes this.</span>
        </p>
      )}
    </section>
  );
}
