import { confirmError, dobError, emailError, nameError, passwordError, rolesError } from "../lib/validation";

const today = new Date(2026, 10, 14); // 14 Nov 2026

test("password needs 12+ chars with a letter and a digit", () => {
  expect(passwordError("Short1")).toMatch(/12/);
  expect(passwordError("alllettersnodigits")).toMatch(/number/);
  expect(passwordError("LongerPass2026!")).toBeNull();
});

test("confirmation must match", () => {
  expect(confirmError("LongerPass2026!", "")).toBeTruthy();
  expect(confirmError("LongerPass2026!", "LongerPass2026")).toMatch(/match/);
  expect(confirmError("LongerPass2026!", "LongerPass2026!")).toBeNull();
});

test("date of birth: 18 to 100, real dates only", () => {
  expect(dobError(null, today)).toBeTruthy();
  expect(dobError("2008-11-15", today)).toMatch(/18/); // turns 18 tomorrow
  expect(dobError("2008-11-14", today)).toBeNull(); // 18 today
  expect(dobError("1920-01-01", today)).toMatch(/valid/);
  expect(dobError("1995-02-31", today)).toMatch(/exist/);
  expect(dobError("1995-06-15", today)).toBeNull();
});

test("name, email and roles", () => {
  expect(nameError(" A ")).toBeTruthy();
  expect(nameError("Priya Nair")).toBeNull();
  expect(emailError("nope")).toBeTruthy();
  expect(emailError("p@example.in")).toBeNull();
  expect(rolesError([])).toBeTruthy();
  expect(rolesError(["batsman"])).toBeNull();
});
