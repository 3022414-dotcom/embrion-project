import { describe, it, expect, vi, beforeEach } from "vitest";
import * as loginService from "../../src/modules/auth/login.service.js";
import * as userRepo from "../../src/modules/auth/user.repository.js";
import * as attemptRepo from "../../src/modules/auth/login-attempt.repository.js";
import bcrypt from "bcryptjs";

const mockSql = {} as Parameters<typeof loginService.login>[0];

const mockSign: loginService.SignFn = (payload) =>
  `mock-token.${JSON.stringify(payload)}`;

const activeCoordinator = {
  id: "user-1",
  email: "coordinator@clinic.test",
  passwordHash: bcrypt.hashSync("password123", 4),
  role: "coordinator" as const,
  clinicId: "clinic-001",
  isActive: true,
  createdAt: new Date(),
};

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("loginService.login — happy path", () => {
  it("returns { status: 'ok', token } for valid coordinator credentials", async () => {
    vi.spyOn(attemptRepo, "countRecent").mockResolvedValue(0);
    vi.spyOn(userRepo, "findByEmail").mockResolvedValue(activeCoordinator);
    vi.spyOn(attemptRepo, "clearByEmail").mockResolvedValue(undefined);

    const result = await loginService.login(mockSql, {
      email: "coordinator@clinic.test",
      password: "password123",
      sign: mockSign,
    });

    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      expect(result.token).toBeTruthy();
    }
  });

  it("clears failed-attempt counter on success", async () => {
    const clearSpy = vi.spyOn(attemptRepo, "clearByEmail").mockResolvedValue(undefined);
    vi.spyOn(attemptRepo, "countRecent").mockResolvedValue(2);
    vi.spyOn(userRepo, "findByEmail").mockResolvedValue(activeCoordinator);

    await loginService.login(mockSql, {
      email: "coordinator@clinic.test",
      password: "password123",
      sign: mockSign,
    });

    expect(clearSpy).toHaveBeenCalledWith(mockSql, "coordinator@clinic.test");
  });

  it("normalises email to lowercase before lookup", async () => {
    const findSpy = vi.spyOn(userRepo, "findByEmail").mockResolvedValue(activeCoordinator);
    vi.spyOn(attemptRepo, "countRecent").mockResolvedValue(0);
    vi.spyOn(attemptRepo, "clearByEmail").mockResolvedValue(undefined);

    await loginService.login(mockSql, {
      email: "COORDINATOR@CLINIC.TEST",
      password: "password123",
      sign: mockSign,
    });

    expect(findSpy).toHaveBeenCalledWith(mockSql, "coordinator@clinic.test");
  });

  it("JWT payload includes sub, role, and clinic_id for coordinator", async () => {
    vi.spyOn(attemptRepo, "countRecent").mockResolvedValue(0);
    vi.spyOn(userRepo, "findByEmail").mockResolvedValue(activeCoordinator);
    vi.spyOn(attemptRepo, "clearByEmail").mockResolvedValue(undefined);

    const capturedPayloads: Record<string, unknown>[] = [];
    const capturingSigner: loginService.SignFn = (payload, opts) => {
      capturedPayloads.push(payload);
      return mockSign(payload, opts);
    };

    await loginService.login(mockSql, {
      email: "coordinator@clinic.test",
      password: "password123",
      sign: capturingSigner,
    });

    expect(capturedPayloads[0]).toMatchObject({
      sub: "user-1",
      role: "coordinator",
      clinic_id: "clinic-001",
    });
  });

  it("JWT payload includes sub and role but NOT clinic_id for admin", async () => {
    const adminUser = {
      id: "admin-1",
      email: "admin@clinic.test",
      passwordHash: bcrypt.hashSync("password123", 4),
      role: "admin" as const,
      clinicId: null,
      isActive: true,
      createdAt: new Date(),
    };

    vi.spyOn(attemptRepo, "countRecent").mockResolvedValue(0);
    vi.spyOn(userRepo, "findByEmail").mockResolvedValue(adminUser);
    vi.spyOn(attemptRepo, "clearByEmail").mockResolvedValue(undefined);

    const capturedPayloads: Record<string, unknown>[] = [];
    const capturingSigner: loginService.SignFn = (payload, opts) => {
      capturedPayloads.push(payload);
      return mockSign(payload, opts);
    };

    await loginService.login(mockSql, {
      email: "admin@clinic.test",
      password: "password123",
      sign: capturingSigner,
    });

    expect(capturedPayloads[0]).toMatchObject({ sub: "admin-1", role: "admin" });
    expect(capturedPayloads[0]).not.toHaveProperty("clinic_id");
  });
});

describe("loginService.login — invalid credentials", () => {
  it("returns { status: 'invalid' } for unknown email, records attempt", async () => {
    vi.spyOn(attemptRepo, "countRecent").mockResolvedValue(0);
    vi.spyOn(userRepo, "findByEmail").mockResolvedValue(null);
    const recordSpy = vi.spyOn(attemptRepo, "record").mockResolvedValue(undefined);

    const result = await loginService.login(mockSql, {
      email: "unknown@clinic.test",
      password: "password123",
      sign: mockSign,
    });

    expect(result.status).toBe("invalid");
    expect(recordSpy).toHaveBeenCalledWith(mockSql, "unknown@clinic.test");
  });

  it("returns { status: 'invalid' } for wrong password, records attempt", async () => {
    vi.spyOn(attemptRepo, "countRecent").mockResolvedValue(0);
    vi.spyOn(userRepo, "findByEmail").mockResolvedValue(activeCoordinator);
    const recordSpy = vi.spyOn(attemptRepo, "record").mockResolvedValue(undefined);

    const result = await loginService.login(mockSql, {
      email: "coordinator@clinic.test",
      password: "wrong-password",
      sign: mockSign,
    });

    expect(result.status).toBe("invalid");
    expect(recordSpy).toHaveBeenCalledWith(mockSql, "coordinator@clinic.test");
  });
});

describe("loginService.login — inactive account", () => {
  it("returns { status: 'inactive' } when is_active is false", async () => {
    const inactiveUser = { ...activeCoordinator, isActive: false };
    vi.spyOn(attemptRepo, "countRecent").mockResolvedValue(0);
    vi.spyOn(userRepo, "findByEmail").mockResolvedValue(inactiveUser);

    const result = await loginService.login(mockSql, {
      email: "coordinator@clinic.test",
      password: "password123",
      sign: mockSign,
    });

    expect(result.status).toBe("inactive");
  });
});

describe("loginService.login — rate limiting", () => {
  it("returns { status: 'rate_limited' } after 5 prior failures", async () => {
    vi.spyOn(attemptRepo, "countRecent").mockResolvedValue(5);

    const result = await loginService.login(mockSql, {
      email: "coordinator@clinic.test",
      password: "password123",
      sign: mockSign,
    });

    expect(result.status).toBe("rate_limited");
    if (result.status === "rate_limited") {
      expect(result.retryAfterSeconds).toBeGreaterThan(0);
    }
  });

  it("returns rate_limited even with correct password when limit reached", async () => {
    vi.spyOn(attemptRepo, "countRecent").mockResolvedValue(10);
    // findByEmail should NOT be called when rate-limited
    const findSpy = vi.spyOn(userRepo, "findByEmail");

    const result = await loginService.login(mockSql, {
      email: "coordinator@clinic.test",
      password: "password123",
      sign: mockSign,
    });

    expect(result.status).toBe("rate_limited");
    expect(findSpy).not.toHaveBeenCalled();
  });
});
