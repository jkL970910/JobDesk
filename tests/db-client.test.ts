import { describe, expect, it } from "vitest";

import { normalizeDatabaseUrlForPg } from "../src/db/client";

describe("normalizeDatabaseUrlForPg", () => {
  it("preserves current pg sslmode aliases by making verify-full explicit", () => {
    expect(normalizeDatabaseUrlForPg("postgres://user:pass@example.com/db?sslmode=require")).toBe(
      "postgres://user:pass@example.com/db?sslmode=verify-full",
    );
    expect(normalizeDatabaseUrlForPg("postgres://user:pass@example.com/db?sslmode=prefer")).toBe(
      "postgres://user:pass@example.com/db?sslmode=verify-full",
    );
    expect(normalizeDatabaseUrlForPg("postgres://user:pass@example.com/db?sslmode=verify-ca")).toBe(
      "postgres://user:pass@example.com/db?sslmode=verify-full",
    );
  });

  it("does not force SSL when the connection string is local or explicit disable", () => {
    expect(normalizeDatabaseUrlForPg("postgres://user:pass@localhost/db")).toBe(
      "postgres://user:pass@localhost/db",
    );
    expect(normalizeDatabaseUrlForPg("postgres://user:pass@localhost/db?sslmode=disable")).toBe(
      "postgres://user:pass@localhost/db?sslmode=disable",
    );
  });
});
