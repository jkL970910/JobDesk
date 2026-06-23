"use client";

import { useEffect, useState } from "react";

type SuggestedUpdateRevision = {
  revisedText?: string;
  revisionInstruction?: string;
};

type SuggestedUpdatePanelProps = {
  acceptLabel?: string;
  aiRevisionLabel?: string;
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
  originalAnswer?: string;
  originalPrompt?: string;
  showOriginalPrompt?: boolean;
  referenceItems?: Array<{
    label: string;
    text: string;
  }>;
  pendingAction?: "accept" | "discard" | "manual_edit" | "ai_revision" | "save_context" | null;
  previewItems?: Array<{
    label: string;
    values: string[];
  }>;
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
  aiRevisionLabel = "Ask AI to revise",
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
  originalAnswer,
  originalPrompt,
  showOriginalPrompt = true,
  referenceItems = [],
  pendingAction = null,
  previewItems = [],
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
  const [messageText, setMessageText] = useState("");

  useEffect(() => {
    setDraftText(initialText);
    setMessageText("");
  }, [initialText]);

  const cleanDraft = draftText.trim();
  const draftChanged = cleanDraft !== initialText.trim();
  const canSendMessage = messageText.trim().length >= 3;
  const isAiRevisionPending = disabled && pendingAction === "ai_revision";
  const isManualEditPending = disabled && pendingAction === "manual_edit";

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
          {showOriginalPrompt && originalPrompt ? (
            <div className="enrichment-proposal__prompt">
              <span>Original question</span>
              <p>{originalPrompt}</p>
            </div>
          ) : null}
          {previewItems.length > 0 ? (
            <div className="enrichment-proposal__field-preview">
              <span>{draftLabel}</span>
              {previewItems.map((item) => (
                <article key={`${item.label}-${item.values.join("|")}`}>
                  <strong>{item.label}</strong>
                  {item.values.map((value) => (
                    <p key={value}>{value}</p>
                  ))}
                </article>
              ))}
            </div>
          ) : null}
          <details className="enrichment-proposal__edit-details" open={previewItems.length === 0}>
            <summary>{previewItems.length > 0 ? "Edit suggestion text" : draftLabel}</summary>
            <label className="enrichment-proposal__editor">
              <span>{previewItems.length > 0 ? "Editable draft" : draftLabel}</span>
              <textarea
                className="jd-input jd-input--compact"
                disabled={disabled}
                onChange={(event) => setDraftText(event.target.value)}
                value={draftText}
              />
            </label>
          </details>
          {sourceQuote &&
          sourceQuote.trim() &&
          sourceQuote.trim() !== initialText.trim() &&
          !initialText.includes(sourceQuote.trim()) ? (
            <p className="enrichment-proposal__quote">Supporting detail: {sourceQuote}</p>
          ) : null}
          {referenceItems.length > 0 ? (
            <div className="enrichment-proposal__references">
              <span>Existing context</span>
              {referenceItems.map((item) => (
                <details key={`${item.label}-${item.text}`}>
                  <summary>{item.label}</summary>
                  <p>{item.text}</p>
                </details>
              ))}
            </div>
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
          <label className="enrichment-proposal__answer">
            <span>{aiRevisionLabel}</span>
            <textarea
              className="jd-input jd-input--compact"
              disabled={disabled}
              onChange={(event) => {
                setMessageText(event.target.value);
                onAnswerChange?.(event.target.value);
              }}
              placeholder={aiRevisionPlaceholder}
              value={messageText}
            />
          </label>
          {isAiRevisionPending ? (
            <div className="enrichment-proposal__progress" role="status" aria-live="polite">
              <span />
              <p>JobDesk is revising this suggestion with your latest instruction.</p>
            </div>
          ) : null}
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
          {isManualEditPending ? "Saving edit..." : saveEditedLabel}
        </button>
        <button
          className="secondary-button"
          disabled={disabled || !canSendMessage}
          type="button"
          onClick={() => onRevise({ revisionInstruction: messageText })}
        >
          {isAiRevisionPending ? "Revising..." : "Send to AI"}
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
