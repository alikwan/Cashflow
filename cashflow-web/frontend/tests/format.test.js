// Task C1 — unit tests for the ported formatters (src/lib/format.js).
// These pin the EXACT behavior of the source `fmt` functions from
// design-reference/project/src/data.js (lines ~349-361). The functions are
// pure, so the port must be byte-for-byte equivalent.
import { fmtInt, fmtM, unitM, fmtFull, fmtUSD, fmtPct, USD_RATE } from "../src/lib/format";

test("fmtInt rounds and adds thousands separators", () => {
  expect(fmtInt(1234.6)).toBe("1,235");
  expect(fmtInt(0)).toBe("0");
});

test("fmtM switches to billions (2 decimals) at abs >= 1000", () => {
  expect(fmtM(1500)).toBe("1.50");
  expect(fmtM(7120)).toBe("7.12");
});

test("fmtM rounds to an integer for 10 <= abs < 1000 (no dec1)", () => {
  expect(fmtM(216)).toBe("216");
  expect(fmtM(216.4)).toBe("216");
});

test("fmtM uses 1 decimal when abs < 10 or opts.dec1", () => {
  expect(fmtM(9.5)).toBe("9.5");
  expect(fmtM(216, { dec1: true })).toBe("216.0");
});

test("unitM picks مليار at >= 1000, مليون below", () => {
  expect(unitM(1500)).toBe("مليار د.ع");
  expect(unitM(216)).toBe("مليون د.ع");
});

test("fmtPct multiplies by 100 and appends %", () => {
  expect(fmtPct(0.51)).toBe("51%");
  expect(fmtPct(0.5123, 1)).toBe("51.2%");
});

test("fmtFull renders the full dinar amount", () => {
  // n is in millions; full = round(n * 1e6) with thousands separators + ' د.ع'
  expect(fmtFull(1)).toBe("1,000,000 د.ع");
});

test("fmtUSD defaults to USD_RATE when rate is falsy", () => {
  expect(USD_RATE).toBe(1350);
  // 1.35M dinar at 1350 => $1,000
  expect(fmtUSD(1.35)).toBe("$1,000");
  // explicit rate overrides
  expect(fmtUSD(1, 1000)).toBe("$1,000");
});
