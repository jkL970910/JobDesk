"use client";

export type RetrievalEvidenceExplanation = {
  id: string;
  text: string;
  public_safe_summary?: string | null;
  retrieval_score: number;
  matched_requirement: string | null;
  matched_question: string | null;
  keyword_matches: string[];
  semantic_score: number;
  metric_bonus: number;
  recency_bonus: number;
  eligibility_reason: string;
  blocked_reason: string | null;
  primary_linkage: {
    kind: "work_experience" | "initiative" | "portfolio_project" | "legacy_project" | "unlinked";
    id: string | null;
    label: string;
  };
  reason_for_selection: string[];
};

export type RetrievalSourceMaterialExplanation = {
  source_document_id: string;
  title: string;
  source_type: string;
  chunk_excerpt: string;
  matched_phrase: string | null;
  why_this_may_help: string;
  required_next_step: "convert_or_enrich_evidence_before_resume_use";
  retrieval_score: number;
  lifecycle_status: string;
  parse_quality_status: string | null;
};

export function RetrievalExplanationPanel({
  evidence,
  onJumpToSourceMaterial,
  sourceMaterial,
  title = "Retrieval explanation",
}: {
  evidence: RetrievalEvidenceExplanation[];
  onJumpToSourceMaterial?: (source: RetrievalSourceMaterialExplanation) => void;
  sourceMaterial: RetrievalSourceMaterialExplanation[];
  title?: string;
}) {
  if (evidence.length === 0 && sourceMaterial.length === 0) return null;

  return (
    <section className="section-block retrieval-explanation-panel" aria-label={title}>
      <div className="claim-review__header">
        <div>
          <h3>{title}</h3>
          <p className="claim-review__note">
            Usable evidence is listed separately from source chunks that still need conversion or enrichment.
          </p>
        </div>
      </div>

      {evidence.length > 0 ? (
        <div className="result-stack result-stack--inner">
          {evidence.map((item) => (
            <article className="claim-card" key={item.id} data-status="supported">
              <div className="requirement__top">
                <p className="requirement__text">{item.public_safe_summary?.trim() || item.text}</p>
                <span className="requirement__type">usable evidence</span>
              </div>
              {item.matched_requirement ? (
                <p className="requirement__quote">Matched requirement: {item.matched_requirement}</p>
              ) : null}
              {item.matched_question ? (
                <p className="requirement__quote">Matched question: {item.matched_question}</p>
              ) : null}
              <div className="chip-row">
                {item.keyword_matches.slice(0, 6).map((keyword) => (
                  <span className="chip" key={`${item.id}-${keyword}`}>
                    {keyword}
                  </span>
                ))}
                <span className="chip">semantic {item.semantic_score.toFixed(1)}</span>
                {item.metric_bonus > 0 ? <span className="chip">metric +{item.metric_bonus}</span> : null}
                {item.recency_bonus > 0 ? <span className="chip">recency +{item.recency_bonus}</span> : null}
              </div>
              <p className="requirement__quote">Why selected: {item.reason_for_selection.join(" · ")}</p>
              <p className="requirement__quote">Eligibility: {item.eligibility_reason}</p>
              <p className="requirement__quote">Primary linkage: {item.primary_linkage.label}</p>
              {item.blocked_reason ? (
                <p className="claim-card__warning">Blocked: {item.blocked_reason}</p>
              ) : null}
            </article>
          ))}
        </div>
      ) : null}

      {sourceMaterial.length > 0 ? (
        <div className="result-stack result-stack--inner">
          {sourceMaterial.map((item) => (
            <article className="claim-card" key={`${item.source_document_id}-${item.title}-${item.chunk_excerpt}`}>
              <div className="requirement__top">
                <p className="requirement__text">{item.title}</p>
                <span className="requirement__type">possible source material</span>
              </div>
              <p className="requirement__quote">{item.chunk_excerpt}</p>
              {item.matched_phrase ? (
                <p className="requirement__quote">Matched phrase: {item.matched_phrase}</p>
              ) : null}
              <p className="requirement__quote">Why this may help: {item.why_this_may_help}</p>
              <p className="requirement__quote">
                Required next step: convert or enrich evidence before resume use.
              </p>
              <div className="chip-row">
                <span className="chip">{item.source_type}</span>
                <span className="chip">{item.lifecycle_status}</span>
                {item.parse_quality_status ? <span className="chip">{item.parse_quality_status}</span> : null}
              </div>
              {onJumpToSourceMaterial ? (
                <div className="actions actions--compact">
                  <button
                    className="secondary-button"
                    type="button"
                    onClick={() => onJumpToSourceMaterial(item)}
                  >
                    Add / Enrich Evidence
                  </button>
                </div>
              ) : null}
            </article>
          ))}
        </div>
      ) : null}
    </section>
  );
}
