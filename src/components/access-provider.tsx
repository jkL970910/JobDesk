"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

type AuthUser = {
  id: string;
  email: string;
  displayName: string | null;
};

type AccessContextValue = {
  configured: boolean;
  fetchJson: typeof fetch;
  refreshUser: () => Promise<void>;
  setToken: (token: string) => void;
  token: string;
  user: AuthUser | null;
};

const AccessContext = createContext<AccessContextValue | null>(null);
const storageKey = "jobdesk_access_token";

export function AccessProvider({
  accountAuthConfigured,
  children,
  configured,
}: {
  accountAuthConfigured: boolean;
  children: ReactNode;
  configured: boolean;
}) {
  const [token, setTokenState] = useState(() => {
    if (typeof window === "undefined") return "";
    return window.localStorage.getItem(storageKey) ?? "";
  });
  const [user, setUser] = useState<AuthUser | null>(null);
  const [authLoading, setAuthLoading] = useState(configured);

  async function refreshUser() {
    if (!accountAuthConfigured) {
      setUser(null);
      setAuthLoading(false);
      return;
    }
    try {
      const response = await fetch("/api/auth/me", { credentials: "include" });
      const payload = (await response.json().catch(() => null)) as
        | { data?: { user?: AuthUser | null } }
        | null;
      setUser(payload?.data?.user ?? null);
    } finally {
      setAuthLoading(false);
    }
  }

  useEffect(() => {
    void refreshUser();
  }, [accountAuthConfigured]);

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
      return fetch(input, { ...init, credentials: "include", headers });
    };

    return { configured, fetchJson, refreshUser, setToken, token, user };
  }, [configured, token, user]);

  return (
    <AccessContext.Provider value={value}>
      {accountAuthConfigured ? (
        user ? (
          <>
            <AccountPanel />
            {children}
          </>
        ) : authLoading ? (
          <AuthShell title="Loading account..." />
        ) : (
          <AuthPanel />
        )
      ) : (
        <>
          {configured ? <LegacyAccessPanel /> : null}
          {children}
        </>
      )}
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

function AuthPanel() {
  const { refreshUser } = useAccess();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [status, setStatus] = useState("Sign in to access your JobDesk workspace.");
  const [pending, setPending] = useState(false);

  async function submit() {
    setPending(true);
    setStatus(mode === "login" ? "Signing in..." : "Creating account...");
    try {
      const response = await fetch(`/api/auth/${mode === "login" ? "login" : "register"}`, {
        body: JSON.stringify({ displayName, email, password }),
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      const payload = (await response.json().catch(() => null)) as { error?: string } | null;
      if (!response.ok) {
        setStatus(payload?.error ?? "Authentication failed.");
        return;
      }
      await refreshUser();
    } finally {
      setPending(false);
    }
  }

  return (
    <AuthShell title={mode === "login" ? "Sign in to JobDesk" : "Create your JobDesk account"}>
      <div className="auth-tabs" role="tablist" aria-label="Authentication mode">
        <button data-active={mode === "login"} type="button" onClick={() => setMode("login")}>
          Login
        </button>
        <button data-active={mode === "register"} type="button" onClick={() => setMode("register")}>
          Register
        </button>
      </div>
      <label>
        <span>Email</span>
        <input
          autoComplete="email"
          onChange={(event) => setEmail(event.target.value)}
          placeholder="you@example.com"
          type="email"
          value={email}
        />
      </label>
      {mode === "register" ? (
        <label>
          <span>Name</span>
          <input
            autoComplete="name"
            onChange={(event) => setDisplayName(event.target.value)}
            placeholder="Optional display name"
            type="text"
            value={displayName}
          />
        </label>
      ) : null}
      <label>
        <span>Password</span>
        <input
          autoComplete={mode === "login" ? "current-password" : "new-password"}
          onChange={(event) => setPassword(event.target.value)}
          placeholder="At least 8 characters"
          type="password"
          value={password}
        />
      </label>
      <button
        className="primary-button"
        disabled={pending || !email.trim() || password.length < 8}
        onClick={() => void submit()}
        type="button"
      >
        {mode === "login" ? "Sign in" : "Create account"}
      </button>
      <p>{status}</p>
    </AuthShell>
  );
}

function AccountPanel() {
  const { refreshUser, user } = useAccess();

  async function logout() {
    await fetch("/api/auth/logout", { credentials: "include", method: "POST" });
    await refreshUser();
  }

  return (
    <div className="access-panel">
      <div>
        <span>Signed in</span>
        <strong>{user?.displayName || user?.email}</strong>
      </div>
      <div className="access-panel__actions">
        <button className="secondary-button" type="button" onClick={() => void logout()}>
          Sign out
        </button>
      </div>
    </div>
  );
}

function LegacyAccessPanel() {
  const { setToken, token } = useAccess();
  return (
    <div className="access-panel">
      <div>
        <span>Legacy access</span>
        <strong>Bearer token mode</strong>
      </div>
      <label>
        <span>Access token</span>
        <input
          onChange={(event) => setToken(event.target.value)}
          placeholder="Enter JOBDESK_ACCESS_TOKEN"
          type="password"
          value={token}
        />
      </label>
    </div>
  );
}

function AuthShell({
  children,
  title,
}: {
  children?: ReactNode;
  title: string;
}) {
  return (
    <main className="auth-shell">
      <section className="auth-card">
        <p className="panel-kicker">Account</p>
        <h1>{title}</h1>
        <p>
          Keep resume sources, evidence, generated resumes, and job workspaces scoped to your account.
        </p>
        {children}
      </section>
    </main>
  );
}
