import { Check, Circle, ListChecks, LoaderCircle } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { MessageMarkdown } from "./message-markdown";
import type { PlanPreview, PlanStepStatus } from "./plan-preview";

interface PlanPanelProps {
  readonly plan: PlanPreview | undefined;
  readonly planModeEnabled: boolean;
  readonly planModeDisabled?: boolean;
  readonly onTogglePlanMode: () => Promise<void> | void;
}

export function PlanPanel({ plan, planModeEnabled, planModeDisabled, onTogglePlanMode }: PlanPanelProps) {
  const { t } = useTranslation();
  const [modePending, setModePending] = useState(false);
  const [modeError, setModeError] = useState(false);
  const completed = plan?.steps.filter((step) => step.status === "completed").length ?? 0;

  const togglePlanMode = async () => {
    setModePending(true);
    setModeError(false);
    try {
      await onTogglePlanMode();
    } catch {
      setModeError(true);
    } finally {
      setModePending(false);
    }
  };

  return (
    <section className="diff-panel plan-panel" data-testid="plan-panel">
      <div className="diff-panel__header plan-panel__header">
        <div>
          <h2 className="diff-panel__title">{t("plan.title")}</h2>
          <span className="plan-panel__progress">
            {plan
              ? t("plan.progress", { completed, total: plan.steps.length })
              : t(planModeEnabled ? "plan.modeOn" : "plan.modeOff")}
          </span>
        </div>
        <button
          aria-checked={planModeEnabled}
          aria-label={t("plan.toggleMode")}
          className="plan-panel__mode-toggle"
          disabled={planModeDisabled || modePending}
          role="switch"
          type="button"
          onClick={() => void togglePlanMode()}
        >
          <span>{t("plan.mode")}</span>
          <span aria-hidden="true" className="plan-panel__switch"><span /></span>
        </button>
      </div>
      {modeError ? <div className="plan-panel__error" role="alert">{t("plan.modeError")}</div> : null}
      <div className="plan-panel__content">
        {plan ? (
          <>
            {plan.explanation ? (
              <div className="plan-panel__explanation">
                <MessageMarkdown text={plan.explanation} />
              </div>
            ) : null}
            <ol className="plan-panel__steps">
              {plan.steps.map((step, index) => (
                <li className={`plan-panel__step plan-panel__step--${step.status}`} key={`${index}:${step.step}`}>
                  <span className="plan-panel__step-icon" aria-hidden="true">{statusIcon(step.status)}</span>
                  <div>
                    <span className="plan-panel__step-label">{step.step}</span>
                    <span className="plan-panel__step-status">{t(`plan.status.${step.status}`)}</span>
                  </div>
                </li>
              ))}
            </ol>
          </>
        ) : (
          <div className="plan-panel__empty">
            <ListChecks aria-hidden="true" />
            <span>{t("plan.empty")}</span>
          </div>
        )}
      </div>
    </section>
  );
}

function statusIcon(status: PlanStepStatus) {
  if (status === "completed") return <Check />;
  if (status === "in_progress") return <LoaderCircle />;
  return <Circle />;
}
