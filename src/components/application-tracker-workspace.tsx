"use client";

import { useEffect, useState, useTransition } from "react";

import { useAccess } from "./access-provider";
import type { ApplicationStatus } from "../schemas/shared";

type TrackerJob = {
  id: string;
  title: string;
  job_facts: {
    company: string | null;
    role_title: string | null;
    location: string | null;
  };
  analyzedAt: string | null;
  requirementCount: number;
  application_status?: ApplicationStatus;
  job_legitimacy: {
    tier: string;
  };
};

const statusOptions: Array<{
  value: ApplicationStatus;
  label: string;
  detail: string;
}> = [
  { value: "evaluated", label: "Evaluated", detail: "Reviewed but not applied." },
  { value: "applied", label: "Applied", detail: "Application submitted." },
  { value: "responded", label: "Responded", detail: "Employer replied." },
  { value: "interview", label: "Interview", detail: "Interview loop active." },
  { value: "offer", label: "Offer", detail: "Offer received." },
  { value: "rejected", label: "Rejected", detail: "Closed by employer." },
  { value: "discarded", label: "Discarded", detail: "Closed by user." },
  { value: "skip", label: "Skip", detail: "Not worth pursuing." },
];

export function ApplicationTrackerWorkspace() {
  const { fetchJson } = useAccess();
  const [jobs, setJobs] = useState<TrackerJob[]>([]);
  const [selectedJobId, setSelectedJobId] = useState("");
  const [status, setStatus] = useState<ApplicationStatus>("evaluated");
  const [message, setMessage] = useState(
    "Load role workspaces to track the application loop.",
  );
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    void loadJobs();
  }, []);

  async function loadJobs() {
    const response = await fetchJson("/api/jobs/recent?limit=20");
    if (!response.ok) {
      setError(await formatLoadError(response, "Could not load applications."));
      return;
    }
    const payload = (await response.json()) as { data?: TrackerJob[] };
    const nextJobs = payload.data ?? [];
    setJobs(nextJobs);
    const nextSelected = selectedJobId || nextJobs[0]?.id || "";
    setSelectedJobId(nextSelected);
    const selected = nextJobs.find((job) => job.id === nextSelected) ?? nextJobs[0];
    if (selected?.application_status) setStatus(selected.application_status);
  }

  function selectJob(jobId: string) {
    setSelectedJobId(jobId);
    const job = jobs.find((item) => item.id === jobId);
    if (job?.application_status) setStatus(job.application_status);
    setError(null);
  }

  function saveStatus() {
    if (!selectedJobId) return;
    setError(null);
    startTransition(async () => {
      const response = await fetchJson(`/api/jobs/${selectedJobId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "update_application_status", status }),
      });
      const payload = (await response.json().catch(() => null)) as
        | { data?: { applicationStatus?: ApplicationStatus }; error?: string; kind?: string }
        | null;
      if (!response.ok) {
        setError(payload?.error ?? "Failed to update application status.");
        return;
      }
      setMessage(`Application status updated to ${statusLabel(status)}.`);
      await loadJobs();
      window.dispatchEvent(new Event("jobdesk:jobs-updated"));
    });
  }

  const selectedJob = jobs.find((job) => job.id === selectedJobId);
  const counts = statusOptions.map((option) => ({
    ...option,
    count: jobs.filter((job) => (job.application_status ?? "evaluated") === option.value).length,
  }));

  return (
    <section className="workspace__grid workspace__grid--stacked">
      <div className="panel panel--control">
        <div className="panel__header">
          <div>
            <h2 className="panel__title">Application tracker</h2>
            <p className="panel__note">
              Move role workspaces through the manual application pipeline.
            </p>
          </div>
        </div>
        {jobs.length > 0 ? (
          <div className="recent-jobs recent-jobs--compact">
            {jobs.map((job) => (
              <button
                className="recent-job"
                key={job.id}
                type="button"
                data-selected={job.id === selectedJobId}
                onClick={() => selectJob(job.id)}
              >
                <span>{job.job_facts.role_title ?? job.title}</span>
                <small>
                  {job.job_facts.company ?? "Unknown company"} ·{" "}
                  {statusLabel(job.application_status)}
                </small>
              </button>
            ))}
          </div>
        ) : (
          <div className="empty-state empty-state--compact">
            Analyze a target JD before tracking application status.
          </div>
        )}
      </div>

      <div className="panel">
        <div className="panel__header">
          <div>
            <h2 className="panel__title">Pipeline status</h2>
            <p className="panel__note">
              Status changes stay manual and never send external actions.
            </p>
          </div>
        </div>
        {selectedJob ? (
          <div className="tracker-detail">
            <div className="job-facts">
              <strong>{selectedJob.job_facts.role_title ?? selectedJob.title}</strong>
              <span>{selectedJob.job_facts.company ?? "Unknown company"}</span>
              <span>
                {selectedJob.requirementCount} requirements ·{" "}
                {selectedJob.job_legitimacy.tier.replaceAll("_", " ")}
              </span>
            </div>
            <div className="tracker-status-grid">
              {statusOptions.map((option) => (
                <label
                  className="tracker-status"
                  data-selected={status === option.value}
                  key={option.value}
                >
                  <input
                    checked={status === option.value}
                    name="application-status"
                    onChange={() => setStatus(option.value)}
                    type="radio"
                  />
                  <span>{option.label}</span>
                  <small>{option.detail}</small>
                </label>
              ))}
            </div>
            <div className="actions">
              <button
                className="primary-button"
                disabled={isPending}
                onClick={saveStatus}
                type="button"
              >
                {isPending ? "Saving..." : "Save Status"}
              </button>
              <span className={error ? "status status--error" : "status"}>
                {error ?? message}
              </span>
            </div>
          </div>
        ) : (
          <div className="empty-state empty-state--compact">
            Select an analyzed job to update its pipeline status.
          </div>
        )}
        <div className="tracker-counts">
          {counts.map((item) => (
            <span key={item.value}>
              {item.label}: {item.count}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}

function statusLabel(status: ApplicationStatus | undefined) {
  return statusOptions.find((option) => option.value === (status ?? "evaluated"))?.label ?? "Evaluated";
}

async function formatLoadError(response: Response, fallback: string) {
  const payload = (await response.json().catch(() => null)) as
    | { error?: string }
    | null;
  if (response.status === 401) {
    return "Access token required. Enter your token at the top of the page, then try again.";
  }
  return payload?.error ?? fallback;
}
