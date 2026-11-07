// @ts-check
const { test, expect } = require("@playwright/test");

const MIN = 60_000;

// Every alert also vibrates, so counting vibrate() calls counts alerts.
// Oscillator starts are recorded too, so tests can tell which sound played.
// Unless a test asks otherwise, the countdown and the dim screen are switched
// off so the timing tests below see round 1 start at once.
async function open(page, { rounds, sound, settings = { prep: 0, dim: false } } = {}) {
  await page.clock.install({ time: new Date("2026-10-18T09:00:00+07:00") });
  await page.addInitScript(({ rounds, sound, settings }) => {
    window.__alerts = 0;
    window.__tones = [];
    navigator.vibrate = () => { window.__alerts++; return true; };
    const start = OscillatorNode.prototype.start;
    OscillatorNode.prototype.start = function (...args) {
      window.__tones.push({ freq: this.frequency.value, type: this.type });
      return start.apply(this, args);
    };
    // seed storage on the first load only, so reload tests see what the app saved
    if (sessionStorage.getItem("seeded")) return;
    sessionStorage.setItem("seeded", "1");
    if (rounds) localStorage.setItem("multi-round-timer:v1", JSON.stringify(rounds));
    if (sound) localStorage.setItem("multi-round-timer:v1:sound", sound);
    if (settings) localStorage.setItem("multi-round-timer:v1:settings", JSON.stringify(settings));
  }, { rounds, sound, settings });
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
    await page.getByRole("button", { name: "เพิ่มรอบ 20 นาที" }).click();
    await page.locator("#sounds").getByRole("radio", { name: "บี๊บดิจิทัล" }).click();
    await page.reload();
    await expect(ui(page).rows).toHaveCount(1);
    await expect(page.locator("#sounds").getByRole("radio", { name: "บี๊บดิจิทัล" })).toHaveAttribute("aria-checked", "true");
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
    await page.getByRole("button", { name: "เพิ่มรอบ 40 นาที" }).click();
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
  test("two-note chime is the default; bowl, wood, chime and beep are offered", async ({ page }) => {
    await open(page);
    await expect(page.locator("#sounds [role=radio]")).toHaveText(["ขันทิเบต (นุ่ม)", "ไม้เคาะ (นุ่ม)", "กริ๊ง 2 โน้ต", "บี๊บดิจิทัล"]);
    await expect(page.locator("#sounds").getByRole("radio", { name: "กริ๊ง 2 โน้ต" })).toHaveAttribute("aria-checked", "true");
    await page.locator("#sounds").getByRole("radio", { name: "บี๊บดิจิทัล" }).click();
    await expect(page.locator("#sounds").getByRole("radio", { name: "บี๊บดิจิทัล" })).toHaveAttribute("aria-checked", "true");
    expect(await alerts(page)).toBe(1);
  });

  for (const removed of ["temple", "bell"]) {
    test(`a saved "${removed}" choice falls back to the chime`, async ({ page }) => {
      await open(page, { sound: removed });
      await expect(page.locator("#sounds").getByRole("radio", { name: "กริ๊ง 2 โน้ต" })).toHaveAttribute("aria-checked", "true");
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

test.describe("screen stays on", () => {
  // Fake Screen Wake Lock so each phone behaviour can be reproduced.
  async function fakeWakeLock(page, mode) {
    await page.addInitScript((mode) => {
      window.__locks = { requested: 0, active: 0, last: null };
      if (mode === "unsupported") { delete Navigator.prototype.wakeLock; return; }
      const api = {
        async request() {
          __locks.requested++;
          if (mode === "denied" || (mode === "deny-once" && __locks.requested === 1)) {
            throw new DOMException("not allowed", "NotAllowedError");
          }
          const lock = new EventTarget();
          lock.released = false;
          lock.release = async () => {
            if (lock.released) return;
            lock.released = true;
            __locks.active--;
            lock.dispatchEvent(new Event("release"));
          };
          __locks.active++;
          __locks.last = lock;
          return lock;
        },
      };
      Object.defineProperty(Navigator.prototype, "wakeLock", { get: () => api, configurable: true });
    }, mode);
  }
  const wake = (page) => page.locator("#wake");
  const locks = (page) => page.evaluate(() => ({ ...window.__locks, last: undefined }));

  test("keeps the screen on while running and lets it sleep after", async ({ page }) => {
    await fakeWakeLock(page, "granted");
    await open(page, { rounds: [60, 60] });
    const u = ui(page);
    await expect(wake(page)).toBeHidden();
    await u.start.click();
    await expect(wake(page)).toHaveText(/กันจอดับอยู่/);
    expect((await locks(page)).active).toBe(1);

    await u.start.click(); // pause
    await expect(wake(page)).toBeHidden();
    expect((await locks(page)).active).toBe(0);

    await u.start.click(); // resume
    await expect(wake(page)).toHaveText(/กันจอดับอยู่/);
    await advance(page, 2 * MIN + 500);
    await expect(u.label).toHaveText("ครบทุกรอบแล้ว");
    await expect(wake(page)).toBeHidden();
    expect((await locks(page)).active).toBe(0);
  });

  test("asks again when the phone drops the lock mid-session", async ({ page }) => {
    await fakeWakeLock(page, "granted");
    await open(page, { rounds: [1800] });
    await ui(page).start.click();
    await expect(wake(page)).toHaveText(/กันจอดับอยู่/);
    await page.evaluate(() => window.__locks.last.release()); // e.g. battery saver
    await expect.poll(async () => (await locks(page)).requested).toBe(2);
    expect((await locks(page)).active).toBe(1);
    await expect(wake(page)).toHaveText(/กันจอดับอยู่/);
  });

  test("warns when the phone refuses and retries on tap", async ({ page }) => {
    await fakeWakeLock(page, "deny-once");
    await open(page, { rounds: [1800] });
    await ui(page).start.click();
    await expect(wake(page)).toHaveText(/ไม่อนุญาตให้กันจอดับ/);
    await wake(page).click();
    await expect(wake(page)).toHaveText(/กันจอดับอยู่/);
    expect((await locks(page)).active).toBe(1);
  });

  test("tells the user when the browser has no wake lock", async ({ page }) => {
    await fakeWakeLock(page, "unsupported");
    await open(page, { rounds: [1800] });
    await ui(page).start.click();
    await expect(wake(page)).toHaveText(/เบราว์เซอร์นี้กันจอดับไม่ได้/);
    await expect(ui(page).label).toHaveText("รอบ 1 จาก 1");
  });

  test("reset releases the lock", async ({ page }) => {
    await fakeWakeLock(page, "granted");
    await open(page, { rounds: [1800] });
    await ui(page).start.click();
    await expect(wake(page)).toBeVisible();
    await ui(page).reset.click();
    await expect(wake(page)).toBeHidden();
    expect((await locks(page)).active).toBe(0);
  });
});

test("quick-add buttons are 15, 20, 30, 40, 45, 60 minutes", async ({ page }) => {
  await open(page, { rounds: [] });
  await expect(page.locator("#chips .chip")).toHaveText(["+15", "+20", "+30", "+40", "+45", "+60"]);
  await page.getByRole("button", { name: "เพิ่มรอบ 40 นาที" }).click();
  await expect(ui(page).rows.nth(0)).toContainText("40 นาที");
});

test.describe("countdown before the first round", () => {
  test("counts down, then starts round 1 without an alert", async ({ page }) => {
    await open(page, { rounds: [1800, 1800], settings: { prep: 10, dim: false } });
    const u = ui(page);
    await u.start.click();
    await expect(u.label).toHaveText("เตรียมตัว จัดท่านั่ง");
    await expect(u.time).toHaveText("00:10");
    await expect(u.start).toHaveText("ข้าม เริ่มรอบแรกเลย");
    await expect(page.getByRole("button", { name: "ลบรอบ 1" })).toBeHidden();

    await page.clock.runFor(10_300);
    await expect(u.label).toHaveText("รอบ 1 จาก 2");
    await expect(u.time).toHaveText("30:00");
    expect(await alerts(page)).toBe(0);
    // round 1 ends 30 minutes after the countdown, not after the tap
    await expect(u.endAt).toContainText("09:30");
  });

  test("skip starts round 1 straight away", async ({ page }) => {
    await open(page, { rounds: [600], settings: { prep: 30, dim: false } });
    const u = ui(page);
    await u.start.click();
    await page.clock.runFor(5_000);
    await u.start.click();
    await expect(u.label).toHaveText("รอบ 1 จาก 1");
    await expect(u.time).toHaveText("10:00");
    await expect(u.start).toHaveText("หยุดชั่วคราว");
  });

  test("reset during the countdown goes back to ready", async ({ page }) => {
    await open(page, { rounds: [600], settings: { prep: 20, dim: false } });
    const u = ui(page);
    await u.start.click();
    await u.reset.click();
    await expect(u.label).toHaveText("พร้อมเริ่ม • 1 รอบ");
    await page.clock.runFor(30_000);
    await expect(u.label).toHaveText("พร้อมเริ่ม • 1 รอบ");
  });

  test("the choice is remembered", async ({ page }) => {
    await open(page, { rounds: [600], settings: null });
    await expect(page.locator("#preps").getByRole("radio", { name: "10 วิ" })).toHaveAttribute("aria-checked", "true");
    await page.locator("#preps").getByRole("radio", { name: "ไม่มี" }).click();
    await page.reload();
    await expect(page.locator("#preps").getByRole("radio", { name: "ไม่มี" })).toHaveAttribute("aria-checked", "true");
  });
});

test.describe("dim screen", () => {
  const dim = (page) => page.locator("#dim");

  test("goes black with a faint clock while timing; tap shows the controls", async ({ page }) => {
    await open(page, { rounds: [600, 600], settings: { prep: 10, dim: true } });
    const u = ui(page);
    await expect(dim(page)).toBeHidden();
    await u.start.click();
    await expect(dim(page)).toBeVisible();
    await expect(page.locator("#dimLabel")).toHaveText("เตรียมตัว");
    await page.clock.runFor(10_300);
    await expect(page.locator("#dimLabel")).toHaveText("รอบ 1 จาก 2");
    await expect(page.locator("#dimTime")).toHaveText("10:00");

    await dim(page).click();
    await expect(dim(page)).toBeHidden();
    await expect(u.start).toHaveText("หยุดชั่วคราว");
    await page.clock.runFor(16_000); // left alone, it dims again
    await expect(dim(page)).toBeVisible();

    await dim(page).click();
    await u.start.click(); // pause
    await expect(dim(page)).toBeHidden();
    await page.clock.runFor(20_000);
    await expect(dim(page)).toBeHidden();
  });

  test("lifts when the last round finishes", async ({ page }) => {
    await open(page, { rounds: [60], settings: { prep: 0, dim: true } });
    await ui(page).start.click();
    await expect(dim(page)).toBeVisible();
    await advance(page, 1 * MIN + 500);
    await expect(dim(page)).toBeHidden();
    await expect(ui(page).label).toHaveText("ครบทุกรอบแล้ว");
  });

  test("can be switched off", async ({ page }) => {
    await open(page, { rounds: [600], settings: null });
    await expect(page.locator("#dimToggle")).toBeChecked();
    await page.locator("#dimToggle").uncheck();
    await page.locator("#preps").getByRole("radio", { name: "ไม่มี" }).click();
    await ui(page).start.click();
    await expect(dim(page)).toBeHidden();
  });
});

test.describe("alert sounds", () => {
  const tones = (page) => page.evaluate(() => window.__tones.splice(0));

  test("the last round uses its own sound", async ({ page }) => {
    await open(page, { rounds: [60, 60], sound: "chime", settings: { prep: 0, dim: false, finalSound: "bowl" } });
    await ui(page).start.click();
    await tones(page);
    await advance(page, 1 * MIN + 500);
    expect((await tones(page)).map((t) => t.freq)).toContain(880); // chime after round 1
    await advance(page, 1 * MIN);
    const last = (await tones(page)).map((t) => t.freq);
    expect(last).toContain(262); // singing bowl after the last round
    expect(last).not.toContain(880);
    expect(await alerts(page)).toBe(2);
  });

  test("'same as other rounds' reuses the round sound", async ({ page }) => {
    await open(page, { rounds: [60], sound: "beep", settings: { prep: 0, dim: false, finalSound: "same" } });
    await ui(page).start.click();
    await tones(page);
    await advance(page, 1 * MIN + 500);
    const last = await tones(page);
    expect(last.every((t) => t.type === "square" && t.freq === 1760)).toBe(true);
  });

  test("final sound defaults to the singing bowl and is remembered", async ({ page }) => {
    await open(page, { settings: null });
    const final = page.locator("#finalSounds");
    await expect(final.getByRole("radio")).toHaveText(["เหมือนรอบอื่น", "ขันทิเบต (นุ่ม)", "ไม้เคาะ (นุ่ม)", "กริ๊ง 2 โน้ต", "บี๊บดิจิทัล"]);
    await expect(final.getByRole("radio", { name: "ขันทิเบต (นุ่ม)" })).toHaveAttribute("aria-checked", "true");
    await final.getByRole("radio", { name: "ไม้เคาะ (นุ่ม)" }).click();
    await page.reload();
    await expect(final.getByRole("radio", { name: "ไม้เคาะ (นุ่ม)" })).toHaveAttribute("aria-checked", "true");
  });

  for (const key of ["bowl", "wood", "chime", "beep"]) {
    for (const length of [2, 10]) {
      test(`${key} rings for about ${length} s when set to ${length} s`, async ({ page }) => {
        // Route the app's audio into an offline context so the alert can be measured.
        await page.addInitScript((len) => {
          window.__off = new OfflineAudioContext(1, 44100 * (len + 6), 44100);
          window.__off.resume = () => Promise.resolve();
          window.AudioContext = function () { return window.__off; };
        }, length);
        await open(page, { sound: key, settings: { prep: 0, dim: false, length } });
        const { peak, seconds } = await page.evaluate(async () => {
          document.getElementById("testSound").click();
          const d = (await window.__off.startRendering()).getChannelData(0);
          let peak = 0, last = 0;
          for (let i = 0; i < d.length; i++) {
            const a = Math.abs(d[i]);
            if (a > peak) peak = a;
            if (a > 0.01) last = i; // still clearly audible (louder than -40 dB)
          }
          return { peak, seconds: last / 44100 };
        });
        expect(peak).toBeLessThanOrEqual(1);
        expect(seconds).toBeGreaterThanOrEqual(length * 0.85);
        expect(seconds).toBeLessThanOrEqual(length * 1.1);
      });
    }
  }

  test("length choice is remembered", async ({ page }) => {
    await open(page, { settings: null });
    const lengths = page.locator("#lengths");
    await expect(lengths.getByRole("radio")).toHaveText(["2 วิ", "4 วิ", "6 วิ", "10 วิ", "15 วิ", "20 วิ"]);
    await expect(lengths.getByRole("radio", { name: "4 วิ" })).toHaveAttribute("aria-checked", "true");
    await lengths.getByRole("radio", { name: "15 วิ" }).click();
    await page.reload();
    await expect(lengths.getByRole("radio", { name: "15 วิ" })).toHaveAttribute("aria-checked", "true");
  });
});

test("dim screen repeats the warning when the screen may turn off", async ({ page }) => {
  await page.addInitScript(() => {
    const api = { async request() { throw new DOMException("no", "NotAllowedError"); } };
    Object.defineProperty(Navigator.prototype, "wakeLock", { get: () => api, configurable: true });
  });
  await open(page, { rounds: [600], settings: { prep: 0, dim: true } });
  await ui(page).start.click();
  await expect(page.locator("#dimHint")).toHaveText(/จออาจดับเอง/);
});
