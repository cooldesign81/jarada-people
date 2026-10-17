import { fixedItems, severanceEstimate, num, won } from "../../js/payroll-calc.js";
let f = 0; const eq = (n, a, b) => { if (JSON.stringify(a) !== JSON.stringify(b)) { f++; console.log("FAIL", n, JSON.stringify(a), JSON.stringify(b)); } else console.log("PASS", n); };
eq("num commas", num("3,000,000"), 3000000); eq("num empty", num(""), 0); eq("won", won(1234567), "1,234,567원");
const c = { baseSalary: "3000000", mealAllowance: "100000", additionalLabel1: "자기 계발비", additionalSalary1: "50000", additionalLabel2: "", additionalSalary2: "", incentiveAmount: "200000" };
const fi = fixedItems(c); eq("fixed total excludes incentive", fi.total, 3150000); eq("fixed rows", fi.rows.map((r) => r.label), ["기본급", "식대", "자기 계발비"]);
eq("legacy additionalSalary -> add1", fixedItems({ baseSalary: "1000", additionalSalary: "500" }).total, 1500);
eq("no joinedAt", severanceEstimate({}, c, "2026-10-17").ok, false);
eq("under 1 year not eligible", severanceEstimate({ joinedAt: "2026-03-01" }, c, "2026-10-17").eligible, false);
const s = severanceEstimate({ joinedAt: "2024-03-02" }, { baseSalary: "3000000" }, "2026-03-02"); // 731일
eq("days inclusive", s.days, 731); eq("daily", s.daily, Math.round(3000000 * 3 / 92)); eq("amount", s.amount, Math.round(3000000 * 3 / 92 * 30 * 731 / 365));
eq("resign date overrides asOf", severanceEstimate({ joinedAt: "2020-01-01" }, { baseSalary: "3000000" }, "2026-10-17", "2021-01-01").days, 367);
process.exit(f ? 1 : 0);
