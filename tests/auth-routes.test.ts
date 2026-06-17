import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/server/auth-service", () => ({
  loginUser: vi.fn(),
  registerUser: vi.fn(),
  serializeSessionCookie: vi.fn(() => "jobdesk_session=test; Path=/; HttpOnly"),
}));

import { loginUser, registerUser } from "../src/server/auth-service";
import { POST as login } from "../app/api/auth/login/route";
import { POST as register } from "../app/api/auth/register/route";

const mockedLoginUser = vi.mocked(loginUser);
const mockedRegisterUser = vi.mocked(registerUser);

describe("auth routes", () => {
  const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("maps duplicate registration emails to an account-exists response", async () => {
    mockedRegisterUser.mockResolvedValueOnce({ status: "email_taken" });

    const response = await register(
      jsonRequest("http://localhost/api/auth/register", {
        displayName: "Test User",
        email: "test@example.com",
        password: "password123",
      }),
    );

    await expect(response.json()).resolves.toEqual({
      error: "An account already exists for this email.",
      kind: "email_taken",
    });
    expect(response.status).toBe(409);
  });

  it("does not expose registration database errors to the client", async () => {
    mockedRegisterUser.mockRejectedValueOnce(
      new Error('Failed query: insert into "users" values (...)'),
    );

    const response = await register(
      jsonRequest("http://localhost/api/auth/register", {
        displayName: "Test User",
        email: "test@example.com",
        password: "password123",
      }),
    );

    await expect(response.json()).resolves.toEqual({
      error: "Unable to create account. Please try again or contact support.",
      kind: "registration_failed",
    });
    expect(response.status).toBe(500);
    expect(consoleError).toHaveBeenCalledWith(
      "JobDesk account registration failed",
      expect.any(Error),
    );
  });

  it("does not expose login database errors to the client", async () => {
    mockedLoginUser.mockRejectedValueOnce(new Error('Failed query: select from "users"'));

    const response = await login(
      jsonRequest("http://localhost/api/auth/login", {
        email: "test@example.com",
        password: "password123",
      }),
    );

    await expect(response.json()).resolves.toEqual({
      error: "Unable to sign in. Please try again or contact support.",
      kind: "login_failed",
    });
    expect(response.status).toBe(500);
    expect(consoleError).toHaveBeenCalledWith("JobDesk account login failed", expect.any(Error));
  });
});

function jsonRequest(url: string, body: unknown) {
  return new Request(url, {
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
}
