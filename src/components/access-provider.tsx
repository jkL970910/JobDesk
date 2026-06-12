"use client";

import {
  createContext,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";

type AccessContextValue = {
  token: string;
  configured: boolean;
  setToken: (token: string) => void;
  fetchJson: typeof fetch;
};

const AccessContext = createContext<AccessContextValue | null>(null);
const storageKey = "jobdesk_access_token";

export function AccessProvider({
  children,
  configured,
}: {
  children: ReactNode;
  configured: boolean;
}) {
  const [token, setTokenState] = useState(() => {
    if (typeof window === "undefined") return "";
    return window.localStorage.getItem(storageKey) ?? "";
  });

  const value = useMemo<AccessContextValue>(() => {
    function setToken(nextToken: string) {
      const normalized = nextToken.trim();
      setTokenState(normalized);
      if (typeof window !== "undefined") {
        if (normalized) window.localStorage.setItem(storageKey, normalized);
        else window.localStorage.removeItem(storageKey);
      }
    }

    const fetchJson: typeof fetch = (input, init = {}) => {
      const headers = new Headers(init.headers);
      if (configured && token) {
        headers.set("Authorization", `Bearer ${token}`);
      }
      return fetch(input, { ...init, headers });
    };

    return { token, configured, setToken, fetchJson };
  }, [configured, token]);

  return (
    <AccessContext.Provider value={value}>
      {configured ? <AccessTokenPanel /> : null}
      {children}
    </AccessContext.Provider>
  );
}

export function useAccess() {
  const context = useContext(AccessContext);
  if (!context) {
    throw new Error("useAccess must be used inside AccessProvider.");
  }
  return context;
}

function AccessTokenPanel() {
  const { token, setToken } = useAccess();
  return (
    <div className="access-panel">
      <label>
        <span>Access token</span>
        <input
          type="password"
          value={token}
          onChange={(event) => setToken(event.target.value)}
          placeholder="Enter JOBDESK_ACCESS_TOKEN"
        />
      </label>
      <p>Protected API calls use this browser-local token.</p>
    </div>
  );
}
