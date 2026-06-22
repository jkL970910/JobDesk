"use client";

import { useEffect, useState } from "react";

type SuggestedUpdateRevision = {
  revisedText?: string;
  revisionInstruction?: string;
};

type SuggestedUpdatePanelProps = {
  acceptLabel?: string;
  aiRevisionPlaceholder?: string;
  className?: string;
  disabled: boolean;
  discardLabel?: string;
  draftLabel?: string;
  initialText: string;
  nextStepDescription: string;
  nextStepLabel?: string;
  onAnswerChange?: (answer: string) => void;
  onAccept: () => void;
  onDiscard: () => void;
  onRevise: (revision: SuggestedUpdateRevision) => void;
  onSaveContext?: () => void;
  originalAnswer?: string;
  originalPrompt?: string;
  revisionLabel?: string;
  revisionHistory?: Array<{
    actor: "user" | "ai";
    createdAt: string;
    id: string;
    instruction: string | null;
    mode: "manual_edit" | "ai_revision";
    revisedText: string;
  }>;
  saveEditedLabel?: string;
  sourceQuote?: string;
  statusLabel: string;
  statusState: string;
  targetLabel: string;
  title: string;
  titleEyebrow?: string;
};

export function SuggestedUpdatePanel({
  acceptLabel = "Save draft",
  aiRevisionPlaceholder = "Example: make this more specific and keep only confirmed facts",
  className,
  disabled,
  discardLabel = "Discard suggestion",
  draftLabel = "Draft text",
  initialText,
  nextStepDescription,
  nextStepLabel = "What happens next",
  onAnswerChange,
  onAccept,
  onDiscard,
  onRevise,
  onSaveContext,
  originalAnswer,
  originalPrompt,
  revisionLabel = "Revise with AI",
  revisionHistory = [],
  saveEditedLabel = "Save edited preview",
  sourceQuote,
  statusLabel,
  statusState,
  targetLabel,
  title,
  titleEyebrow = "Ready to review",
}: SuggestedUpdatePanelProps) {
  const [draftText, setDraftText] = useState(initialText);
  const [revisionInstruction, setRevisionInstruction] = useState("");

  useEffect(() => {
    setDraftText(initialText);
    setRevisionInstruction("");
  }, [initialText]);

  const cleanDraft = draftText.trim();
  const draftChanged = cleanDraft !== initialText.trim();
  const canReviseWithAi = revisionInstruction.trim().length >= 3;

  return (
    <div className={["enrichment-proposal", className].filter(Boolean).join(" ")}>
      <div className="enrichment-proposal__header">
        <div>
          <span>{titleEyebrow}</span>
          <strong>{title}</strong>
        </div>
        <em data-state={statusState}>{statusLabel}</em>
      </div>
      <div className="enrichment-proposal__workspace">
        <section className="enrichment-proposal__output">
          {originalPrompt ? (
            <div className="enrichment-proposal__prompt">
              <span>Original question</span>
              <p>{originalPrompt}</p>
            </div>
          ) : null}
          <label className="enrichment-proposal__editor">
            <span>{draftLabel}</span>
            <textarea
              className="jd-input jd-input--compact"
              disabled={disabled}
              onChange={(event) => setDraftText(event.target.value)}
              value={draftText}
            />
          </label>
          {sourceQuote && sourceQuote.trim() && sourceQuote.trim() !== initialText.trim() ? (
            <p className="enrichment-proposal__quote">Source quote: {sourceQuote}</p>
          ) : null}
          <dl className="enrichment-proposal__meta">
            <div>
              <dt>Target</dt>
              <dd>{targetLabel}</dd>
            </div>
            <div>
              <dt>{nextStepLabel}</dt>
              <dd>{nextStepDescription}</dd>
            </div>
          </dl>
        </section>
        <aside className="enrichment-proposal__conversation">
          {onAnswerChange ? (
            <label className="enrichment-proposal__answer">
              <span>Your context</span>
              <textarea
                className="jd-input jd-input--compact"
                disabled={disabled}
                onChange={(event) => onAnswerChange(event.target.value)}
                placeholder="Add facts, constraints, metrics, or what the AI should preserve."
                value={originalAnswer ?? ""}
              />
            </label>
          ) : null}
          <label className="enrichment-proposal__revision">
            <span>{revisionLabel}</span>
            <input
              className="jd-input jd-input--compact"
              disabled={disabled}
              onChange={(event) => setRevisionInstruction(event.target.value)}
              placeholder={aiRevisionPlaceholder}
              value={revisionInstruction}
            />
          </label>
          <div className="enrichment-proposal__history">
            <span>Change history</span>
            {revisionHistory.length > 0 ? (
              revisionHistory.map((revision) => (
                <article key={revision.id}>
                  <strong>{revision.mode === "manual_edit" ? "Manual edit" : "AI revision"}</strong>
                  {revision.instruction ? <p>{revision.instruction}</p> : null}
                  <small>{formatHistoryTime(revision.createdAt)}</small>
                </article>
              ))
            ) : (
              <p>No revisions yet.</p>
            )}
          </div>
        </aside>
      </div>
      <div className="enrichment-proposal__actions">
        <button
          className="secondary-button"
          disabled={disabled || !draftChanged || cleanDraft.length < 12}
          type="button"
          onClick={() => onRevise({ revisedText: draftText })}
        >
          {saveEditedLabel}
        </button>
        <button
          className="secondary-button"
          disabled={disabled || !canReviseWithAi}
          type="button"
          onClick={() => onRevise({ revisionInstruction })}
        >
          {revisionLabel}
        </button>
        {onSaveContext ? (
          <button
            className="secondary-button"
            disabled={disabled || !originalAnswer?.trim() || originalAnswer.trim().length < 12}
            type="button"
            onClick={onSaveContext}
          >
            Update context & preview
          </button>
        ) : null}
        <button className="primary-button" disabled={disabled} type="button" onClick={onAccept}>
          {acceptLabel}
        </button>
        <button className="secondary-button" disabled={disabled} type="button" onClick={onDiscard}>
          {discardLabel}
        </button>
      </div>
    </div>
  );
}

function formatHistoryTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(undefined, {
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    month: "short",
  });
}
