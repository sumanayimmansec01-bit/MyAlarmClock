// @ts-check
const { test, expect } = require("@playwright/test");

const MIN = 60_000;

// Every alert also vibrates, so counting vibrate() calls counts alerts.
async function open(page, { rounds, sound } = {}) {
  await page.clock.install({ time: new Date("2026-10-18T09:00:00+07:00") });
  await page.addInitScript(({ rounds, sound }) => {
    window.__alerts = 0;
    navigator.vibrate = () => { window.__alerts++; return true; };
    // seed storage on the first load only, so reload tests see what the app saved
    if (sessionStorage.getItem("seeded")) return;
    sessionStorage.setItem("seeded", "1");
    if (rounds) localStorage.setItem("multi-round-timer:v1", JSON.stringify(rounds));
    if (sound) localStorage.setItem("multi-round-timer:v1:sound", sound);
  }, { rounds, sound });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/index.html");
  return errors;
}

// The app ticks every 250 ms; step the fake clock a minute at a time so long
// rounds stay fast to simulate while every tick still sees the time move on.
async function advance(page, ms) {
  for (; ms > MIN; ms -= MIN) await page.clock.fastForward(MIN);
  await page.clock.fastForward(ms);
  await page.clock.runFor(300);
}

const alerts = (page) => page.evaluate(() => window.__alerts);
const ui = (page) => ({
  start: page.locator("#startBtn"),
  reset: page.locator("#resetBtn"),
  time: page.locator("#time"),
  label: page.locator("#roundLabel"),
  endAt: page.locator("#endAt"),
  rows: page.locator("#rounds .row"),
  input: page.locator("#addInput"),
  add: page.locator("#addForm button[type=submit]"),
  error: page.locator("#addError"),
  clear: page.locator("#clearBtn"),
  total: page.locator("#total"),
});

test.describe("setup", () => {
  test("opens with the default 30, 30 rounds", async ({ page }) => {
    const errors = await open(page);
    const u = ui(page);
    await expect(u.rows).toHaveCount(2);
    await expect(u.rows.nth(0)).toContainText("30 นาที");
    await expect(u.time).toHaveText("30:00");
    await expect(u.label).toHaveText("พร้อมเริ่ม • 2 รอบ");
    await expect(u.total).toHaveText("2 รอบ • รวม 1:00:00");
    await expect(u.reset).toBeDisabled();
    expect(errors).toEqual([]);
  });

  test("quick-add chips append rounds", async ({ page }) => {
    await open(page, { rounds: [] });
    const u = ui(page);
    await expect(u.start).toBeDisabled();
    await page.getByRole("button", { name: "เพิ่มรอบ 15 นาที" }).click();
    await page.getByRole("button", { name: "เพิ่มรอบ 45 นาที" }).click();
    await expect(u.rows).toHaveCount(2);
    await expect(u.rows.nth(1)).toContainText("45 นาที");
    await expect(u.time).toHaveText("15:00");
    await expect(u.start).toBeEnabled();
  });

  test("typed list accepts minutes, decimals and min:sec", async ({ page }) => {
    await open(page, { rounds: [] });
    const u = ui(page);
    await u.input.fill("30, 30 1.5 2:05");
    await u.add.click();
    await expect(u.rows).toHaveCount(4);
    await expect(u.rows.nth(2)).toContainText("1:30 นาที");
    await expect(u.rows.nth(3)).toContainText("2:05 นาที");
    await expect(u.input).toHaveValue("");
  });

  for (const bad of ["abc", "0", "5:75", "30,,x"]) {
    test(`rejects invalid input "${bad}"`, async ({ page }) => {
      await open(page, { rounds: [] });
      const u = ui(page);
      await u.input.fill(bad);
      await u.add.click();
      await expect(u.error).toBeVisible();
      await expect(u.rows).toHaveCount(0);
    });
  }

  test("deletes one round and clears all", async ({ page }) => {
    await open(page, { rounds: [600, 1200, 1800] });
    const u = ui(page);
    await page.getByRole("button", { name: "ลบรอบ 2" }).click();
    await expect(u.rows).toHaveCount(2);
    await expect(u.rows.nth(1)).toContainText("30 นาที");
    await u.clear.click();
    await expect(u.rows).toHaveCount(0);
    await expect(u.start).toBeDisabled();
  });

  test("remembers rounds and sound after reload", async ({ page }) => {
    await open(page, { rounds: [] });
    await page.getByRole("button", { name: "เพิ่มรอบ 10 นาที" }).click();
    await page.getByRole("radio", { name: "บี๊บดิจิทัล" }).click();
    await page.reload();
    await expect(ui(page).rows).toHaveCount(1);
    await expect(page.getByRole("radio", { name: "บี๊บดิจิทัล" })).toHaveAttribute("aria-checked", "true");
  });
});

test.describe("running", () => {
  test("30, 30 rings once per round and stops by itself", async ({ page }) => {
    await open(page, { rounds: [1800, 1800] });
    const u = ui(page);
    await u.start.click();
    await expect(u.label).toHaveText("รอบ 1 จาก 2");
    await expect(u.endAt).toContainText("09:30");
    await expect(u.endAt).toContainText("10:00");

    await advance(page, 29 * MIN);
    await expect(u.time).toHaveText("01:00");
    expect(await alerts(page)).toBe(0);

    await advance(page, 1 * MIN + 500);
    await expect(u.label).toHaveText("รอบ 2 จาก 2");
    expect(await alerts(page)).toBe(1);
    await expect(u.rows.nth(0)).toHaveClass(/done/);
    await expect(u.rows.nth(1)).toHaveClass(/current/);

    await advance(page, 30 * MIN);
    await expect(u.label).toHaveText("ครบทุกรอบแล้ว");
    await expect(u.time).toHaveText("00:00");
    await expect(u.start).toHaveText("เริ่มใหม่");
    expect(await alerts(page)).toBe(2);

    // nothing keeps ringing afterwards
    await advance(page, 30 * MIN);
    expect(await alerts(page)).toBe(2);
  });

  test("pause holds the remaining time and resume continues it", async ({ page }) => {
    await open(page, { rounds: [600] });
    const u = ui(page);
    await u.start.click();
    await advance(page, 4 * MIN);
    await u.start.click();
    await expect(u.start).toHaveText("ทำต่อ");
    await expect(u.time).toHaveText("06:00");
    await advance(page, 20 * MIN);
    await expect(u.time).toHaveText("06:00");
    expect(await alerts(page)).toBe(0);
    await u.start.click();
    await advance(page, 6 * MIN + 500);
    await expect(u.label).toHaveText("ครบทุกรอบแล้ว");
    expect(await alerts(page)).toBe(1);
  });

  test("reset returns to the ready state", async ({ page }) => {
    await open(page, { rounds: [1800, 1800] });
    const u = ui(page);
    await u.start.click();
    await advance(page, 31 * MIN);
    await u.reset.click();
    await expect(u.label).toHaveText("พร้อมเริ่ม • 2 รอบ");
    await expect(u.time).toHaveText("30:00");
    await expect(u.rows.nth(0)).not.toHaveClass(/done/);
  });

  test("round list is locked while running", async ({ page }) => {
    await open(page, { rounds: [1800] });
    await ui(page).start.click();
    await expect(page.getByRole("button", { name: "ลบรอบ 1" })).toBeHidden();
    await expect(page.locator(".setup-only")).toHaveCSS("pointer-events", "none");
  });

  test("restart after finishing runs all rounds again", async ({ page }) => {
    await open(page, { rounds: [60, 60] });
    const u = ui(page);
    await u.start.click();
    await advance(page, 2 * MIN + 500);
    await expect(u.label).toHaveText("ครบทุกรอบแล้ว");
    await u.start.click();
    await expect(u.label).toHaveText("รอบ 1 จาก 2");
    await expect(u.time).toHaveText("01:00");
    await advance(page, 2 * MIN + 500);
    expect(await alerts(page)).toBe(4);
  });

  test("after finishing, rounds can be edited without pressing reset", async ({ page }) => {
    await open(page, { rounds: [60, 60] });
    const u = ui(page);
    await u.start.click();
    await advance(page, 2 * MIN + 500);
    await expect(u.label).toHaveText("ครบทุกรอบแล้ว");
    await page.getByRole("button", { name: "ลบรอบ 2" }).click();
    await expect(u.rows).toHaveCount(1);
    await expect(u.label).toHaveText("พร้อมเริ่ม • 1 รอบ");
    await expect(u.time).toHaveText("01:00");
    await page.getByRole("button", { name: "เพิ่มรอบ 5 นาที" }).click();
    await expect(u.rows).toHaveCount(2);
    await expect(u.start).toHaveText("เริ่ม");
    // rounds that have not run yet must not be struck through
    await expect(page.locator("#rounds .row.done")).toHaveCount(0);
  });

  test("adding a round after finishing shows it as not yet run", async ({ page }) => {
    await open(page, { rounds: [60] });
    const u = ui(page);
    await u.start.click();
    await advance(page, 1 * MIN + 500);
    await expect(u.label).toHaveText("ครบทุกรอบแล้ว");
    await expect(u.rows.nth(0)).toHaveClass(/done/);

    await page.getByRole("button", { name: "เพิ่มรอบ 30 นาที" }).click();
    await expect(u.rows).toHaveCount(2);
    await expect(page.locator("#rounds .row.done")).toHaveCount(0);
    await expect(u.rows.nth(1).locator(".m")).toHaveCSS("text-decoration-line", "none");
    await expect(u.label).toHaveText("พร้อมเริ่ม • 2 รอบ");

    await u.input.fill("15, 15");
    await u.add.click();
    await expect(page.locator("#rounds .row.done")).toHaveCount(0);
  });

  test("phone asleep past several round ends: catches up, rings once", async ({ page }) => {
    await open(page, { rounds: [600, 600, 600] });
    const u = ui(page);
    await u.start.click();
    // jump the clock without firing timers, like a throttled background tab
    await page.clock.fastForward(25 * MIN);
    await page.clock.runFor(500);
    await expect(u.label).toHaveText("รอบ 3 จาก 3");
    await expect(u.time).toHaveText("05:00");
    expect(await alerts(page)).toBe(1);
  });
});

test.describe("sound", () => {
  test("two-note chime is the default and only chime and beep remain", async ({ page }) => {
    await open(page);
    await expect(page.getByRole("radio")).toHaveText(["กริ๊ง 2 โน้ต", "บี๊บดิจิทัล"]);
    await expect(page.getByRole("radio", { name: "กริ๊ง 2 โน้ต" })).toHaveAttribute("aria-checked", "true");
    await page.getByRole("radio", { name: "บี๊บดิจิทัล" }).click();
    await expect(page.getByRole("radio", { name: "บี๊บดิจิทัล" })).toHaveAttribute("aria-checked", "true");
    expect(await alerts(page)).toBe(1);
  });

  for (const removed of ["temple", "bell"]) {
    test(`a saved "${removed}" choice falls back to the chime`, async ({ page }) => {
      await open(page, { sound: removed });
      await expect(page.getByRole("radio", { name: "กริ๊ง 2 โน้ต" })).toHaveAttribute("aria-checked", "true");
    });
  }

  test("test-sound button plays the chosen sound", async ({ page }) => {
    await open(page);
    await page.getByRole("button", { name: /ทดสอบเสียง/ }).click();
    expect(await alerts(page)).toBe(1);
  });
});

test("layout fits the phone screen without sideways scroll", async ({ page }) => {
  await open(page, { rounds: [1800, 1800, 3600, 5400] });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  await expect(page.locator("#startBtn")).toBeInViewport();
});

test("start fills the row, reset is small, each round has a delete button", async ({ page }) => {
  await open(page, { rounds: [1800, 1800, 600] });
  const u = ui(page);
  const start = await u.start.boundingBox();
  const reset = await u.reset.boundingBox();
  const panel = await page.locator("section.panel").first().boundingBox();
  expect(Math.abs(start.width - panel.width)).toBeLessThanOrEqual(1);
  expect(reset.height).toBeLessThan(start.height / 1.5);
  expect(reset.width).toBeLessThan(start.width / 2);

  for (let i = 1; i <= 3; i++) {
    await expect(page.getByRole("button", { name: `ลบรอบ ${i}` })).toBeVisible();
    await expect(page.getByRole("button", { name: `ลบรอบ ${i}` })).toHaveText("ลบ");
  }
  await page.getByRole("button", { name: "ลบรอบ 3" }).click();
  await expect(u.rows).toHaveCount(2);
  await expect(u.total).toHaveText("2 รอบ • รวม 1:00:00");
});

test("pause and resume buttons use different colours from start and each other", async ({ page }) => {
  await open(page, { rounds: [600] });
  const u = ui(page);
  const bg = () => u.start.evaluate((el) => getComputedStyle(el).backgroundColor);
  const startColour = await bg();
  await u.start.click();
  await expect(u.start).toHaveText("หยุดชั่วคราว");
  const pauseColour = await bg();
  await u.start.click();
  await expect(u.start).toHaveText("ทำต่อ");
  const resumeColour = await bg();
  expect(new Set([startColour, pauseColour, resumeColour]).size).toBe(3);
  await u.start.click();
  expect(await bg()).toBe(pauseColour);
  await u.reset.click();
  expect(await bg()).toBe(startColour);
});
