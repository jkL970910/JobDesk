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
  onAccept: () => void;
  onDiscard: () => void;
  onRevise: (revision: SuggestedUpdateRevision) => void;
  revisionLabel?: string;
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
  onAccept,
  onDiscard,
  onRevise,
  revisionLabel = "Revise with AI",
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
