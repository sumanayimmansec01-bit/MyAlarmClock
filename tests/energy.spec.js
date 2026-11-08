// @ts-check
const { test, expect } = require("@playwright/test");

const KEY = "energy-map:v1";
const NOW = new Date("2026-10-18T09:00:00+07:00"); // a Sunday

// Seed a few days of history on the first load only, so reload tests see what the app saved.
async function open(page, entries) {
  await page.clock.install({ time: NOW });
  await page.addInitScript(({ KEY, entries }) => {
    if (sessionStorage.getItem("seeded")) return;
    sessionStorage.setItem("seeded", "1");
    if (entries) {
      const acts = [{ id: "x", emoji: "🚶", name: "เดิน", fx: 2 }];
      localStorage.setItem(KEY, JSON.stringify({ entries, acts }));
    }
  }, { KEY, entries });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/energy/index.html");
  return errors;
}
const at = (iso, name, emoji, fx, min = 30) => ({ id: name + iso, ts: new Date(iso).getTime(), name, emoji, fx, min, note: "" });

test("logging a booster and a drainer updates today's total", async ({ page }) => {
  const errors = await open(page);
  await page.getByRole("button", { name: /เดิน\/ออกกำลังกาย/ }).click();
  await page.getByRole("button", { name: "บันทึก", exact: true }).click();
  await expect(page.locator("#entries")).toContainText("เดิน/ออกกำลังกาย");
  await expect(page.locator("#today .big")).toHaveText("+2");

  await page.getByRole("button", { name: /ประชุมยาว/ }).click();
  await page.getByRole("button", { name: /^1 ชม\./ }).click(); // 60 min of a -2 activity = -4
  await page.getByRole("button", { name: "บันทึก", exact: true }).click();
  await expect(page.locator("#today .big")).toHaveText("−2");
  expect(errors).toEqual([]);
});

test("the user can override the effect of a preset for one entry", async ({ page }) => {
  await open(page);
  await page.getByRole("button", { name: /ประชุมยาว/ }).click();
  await page.locator("#fx").getByRole("button", { name: /^▲ เติมพลัง$/ }).click();
  await page.getByRole("button", { name: "บันทึก", exact: true }).click();
  await expect(page.locator("#today .big")).toHaveText("+1");
});

test("entries persist across reload and can be deleted", async ({ page }) => {
  await open(page);
  await page.getByRole("button", { name: /ฟังเพลง/ }).click();
  await page.getByRole("button", { name: "บันทึก", exact: true }).click();
  await page.reload();
  await expect(page.locator("#entries")).toContainText("ฟังเพลง");
  await page.getByRole("button", { name: "ลบ ฟังเพลง" }).click();
  await expect(page.locator("#entries")).toContainText("ยังไม่มี");
  await page.reload();
  await expect(page.locator("#entries")).toContainText("ยังไม่มี");
});

test("insights: day, week and month views total the right entries", async ({ page }) => {
  const errors = await open(page, [
    at("2026-10-18T07:00:00+07:00", "เดิน", "🚶", 2),            // today  +2
    at("2026-10-18T08:00:00+07:00", "ประชุมยาว", "📅", -2, 60),  // today  -4
    at("2026-10-14T10:00:00+07:00", "เดิน", "🚶", 2),            // this week (Wed) +2
    at("2026-10-02T10:00:00+07:00", "นอนดึก", "🌙", -2),          // this month, earlier week -2
    at("2026-09-20T10:00:00+07:00", "เดิน", "🚶", 2),            // last month
  ]);
  await page.getByRole("navigation").getByRole("button", { name: /สรุป/ }).click();

  const net = page.locator("#stats > div").nth(2).locator("b");
  await expect(net).toHaveText("−2");                              // day: +2 -4
  await expect(page.locator("#drainers")).toContainText("ประชุมยาว");
  await expect(page.locator("#boosters")).toContainText("เดิน");

  await page.getByRole("button", { name: "รายสัปดาห์" }).click();
  await expect(net).toHaveText("0");                              // +2 -4 +2, Mon 12 – Sun 18

  await page.getByRole("button", { name: "รายเดือน" }).click();
  await expect(net).toHaveText("−2");                              // +2 -4 +2 -2
  await expect(page.locator("#tips li").first()).toBeVisible();

  await page.getByRole("button", { name: "ช่วงก่อนหน้า" }).click(); // September
  await expect(net).toHaveText("+2");
  await expect(page.locator("#next")).toBeEnabled();
  await page.getByRole("button", { name: "ช่วงถัดไป" }).click();
  await expect(page.locator("#next")).toBeDisabled();
  expect(errors).toEqual([]);
});

test("empty insights invite the first entry instead of showing numbers", async ({ page }) => {
  await open(page);
  await page.getByRole("navigation").getByRole("button", { name: /สรุป/ }).click();
  await expect(page.locator("#tips")).toContainText("ยังไม่มีข้อมูล");
});

test("a custom activity can be added, used and removed", async ({ page }) => {
  await open(page);
  await page.getByRole("button", { name: /กิจกรรมใหม่/ }).click();
  await page.locator("#act-name").fill("เล่นกับแมว");
  await page.locator("#act-emoji").fill("🐱");
  await page.locator("#act-fx").getByRole("button", { name: /เติมพลังมาก/ }).click();
  await page.getByRole("button", { name: "เพิ่ม", exact: true }).click();
  await page.getByRole("button", { name: /เล่นกับแมว/ }).click();
  await page.getByRole("button", { name: "บันทึก", exact: true }).click();
  await expect(page.locator("#today .big")).toHaveText("+2");

  await page.getByRole("navigation").getByRole("button", { name: /จัดการ/ }).click();
  await page.getByRole("button", { name: "ลบกิจกรรม เล่นกับแมว" }).click();
  await expect(page.locator("#actlist")).not.toContainText("เล่นกับแมว");
});

test("no horizontal scroll on a phone", async ({ page }) => {
  await open(page);
  const w = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
  expect(w[0]).toBeLessThanOrEqual(w[1]);
});
