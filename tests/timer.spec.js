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

// Rounds are edited by tapping a segment of the strip (or ＋ to add), which
// opens the round editor sheet; settings live in their own sheet.
const editor = (page) => page.locator("#roundSheet");
async function addRound(page, minutes) {
  await page.locator("#addRound").click();
  await editor(page).getByRole("button", { name: `${minutes} นาที`, exact: true }).click();
  await page.locator("#saveRound").click();
}
// Leaves the editor open when it shows an input error, so tests can read it.
async function typeRounds(page, text) {
  await page.locator("#addRound").click();
  await page.locator("#roundInput").fill(text);
  await page.locator("#saveRound").click();
}
async function deleteRound(page, n) {
  await page.locator("#strip .seg").nth(n - 1).click();
  await page.locator("#deleteRound").click();
}
async function clearRounds(page) {
  await page.locator("#addRound").click();
  await page.locator("#clearBtn").click();
}
async function inSettings(page, act) {
  const sheet = page.locator("#settingsSheet");
  if (!(await sheet.evaluate((d) => d.open))) await page.locator("#settingsBtn").click();
  await act();
  await sheet.locator("[data-close]").click();
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
  rows: page.locator("#strip .seg:not(.add)"),
  input: page.locator("#roundInput"),
  error: page.locator("#roundError"),
  finishAt: page.locator("#finishAt"),
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
    await addRound(page, 15);
    await addRound(page, 45);
    await expect(u.rows).toHaveCount(2);
    await expect(u.rows.nth(1)).toContainText("45 นาที");
    await expect(u.time).toHaveText("15:00");
    await expect(u.start).toBeEnabled();
  });

  test("typed list accepts minutes, decimals and min:sec", async ({ page }) => {
    await open(page, { rounds: [] });
    const u = ui(page);
    await typeRounds(page, "30, 30 1.5 2:05");
    await expect(u.rows).toHaveCount(4);
    await expect(u.rows.nth(2)).toContainText("1:30 นาที");
    await expect(u.rows.nth(3)).toContainText("2:05 นาที");
  });

  for (const bad of ["abc", "0", "5:75", "30,,x"]) {
    test(`rejects invalid input "${bad}"`, async ({ page }) => {
      await open(page, { rounds: [] });
      const u = ui(page);
      await typeRounds(page, bad);
      await expect(u.error).toBeVisible();
      await expect(u.rows).toHaveCount(0);
    });
  }

  test("deletes one round and clears all", async ({ page }) => {
    await open(page, { rounds: [600, 1200, 1800] });
    const u = ui(page);
    await deleteRound(page, 2);
    await expect(u.rows).toHaveCount(2);
    await expect(u.rows.nth(1)).toContainText("30 นาที");
    await clearRounds(page);
    await expect(u.rows).toHaveCount(0);
    await expect(u.start).toBeDisabled();
  });

  test("remembers rounds and sound after reload", async ({ page }) => {
    await open(page, { rounds: [] });
    await addRound(page, 20);
    await inSettings(page, () => page.locator("#sounds").getByRole("radio", { name: "บี๊บดิจิทัล", includeHidden: true }).click());
    await page.reload();
    await expect(ui(page).rows).toHaveCount(1);
    await expect(page.locator("#sounds").getByRole("radio", { name: "บี๊บดิจิทัล", includeHidden: true })).toHaveAttribute("aria-checked", "true");
  });
});

test.describe("running", () => {
  test("30, 30 rings once per round and stops by itself", async ({ page }) => {
    await open(page, { rounds: [1800, 1800] });
    const u = ui(page);
    await u.start.click();
    await expect(u.label).toHaveText("รอบ 1 จาก 2");
    await expect(u.endAt).toContainText("09:30");
    await expect(u.finishAt).toContainText("10:00");

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
    await expect(ui(page).rows.nth(0)).toBeDisabled();
    await expect(page.locator("#addRound")).toHaveCount(0);
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
    await deleteRound(page, 2);
    await expect(u.rows).toHaveCount(1);
    await expect(u.label).toHaveText("พร้อมเริ่ม • 1 รอบ");
    await expect(u.time).toHaveText("01:00");
    await addRound(page, 40);
    await expect(u.rows).toHaveCount(2);
    await expect(u.start).toHaveText("เริ่ม");
    // rounds that have not run yet must not be struck through
    await expect(page.locator("#strip .seg.done")).toHaveCount(0);
  });

  test("adding a round after finishing shows it as not yet run", async ({ page }) => {
    await open(page, { rounds: [60] });
    const u = ui(page);
    await u.start.click();
    await advance(page, 1 * MIN + 500);
    await expect(u.label).toHaveText("ครบทุกรอบแล้ว");
    await expect(u.rows.nth(0)).toHaveClass(/done/);

    await addRound(page, 30);
    await expect(u.rows).toHaveCount(2);
    await expect(page.locator("#strip .seg.done")).toHaveCount(0);
    await expect(u.rows.nth(0)).not.toHaveClass(/done/);
    await expect(u.rows.nth(1)).not.toHaveClass(/done/);
    await expect(u.label).toHaveText("พร้อมเริ่ม • 2 รอบ");

    await typeRounds(page, "15, 15");
    await expect(page.locator("#strip .seg.done")).toHaveCount(0);
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
  test("the slow-rising bowl is the default; five sounds are offered", async ({ page }) => {
    await open(page);
    await expect(page.locator("#sounds [role=radio]")).toHaveText(["ขันค่อยๆ ดัง (นุ่มที่สุด)", "ขันทิเบต (นุ่ม)", "ไม้เคาะ (นุ่ม)", "กริ๊ง 2 โน้ต", "บี๊บดิจิทัล"]);
    await expect(page.locator("#sounds").getByRole("radio", { name: "ขันค่อยๆ ดัง (นุ่มที่สุด)", includeHidden: true })).toHaveAttribute("aria-checked", "true");
    await inSettings(page, () => page.locator("#sounds").getByRole("radio", { name: "บี๊บดิจิทัล", includeHidden: true }).click());
    await expect(page.locator("#sounds").getByRole("radio", { name: "บี๊บดิจิทัล", includeHidden: true })).toHaveAttribute("aria-checked", "true");
    expect(await alerts(page)).toBe(1);
  });

  for (const removed of ["temple", "bell"]) {
    test(`a saved "${removed}" choice falls back to the default`, async ({ page }) => {
      await open(page, { sound: removed });
      await expect(page.locator("#sounds").getByRole("radio", { name: "ขันค่อยๆ ดัง (นุ่มที่สุด)", includeHidden: true })).toHaveAttribute("aria-checked", "true");
    });
  }

  test("test-sound button plays the chosen sound", async ({ page }) => {
    await open(page);
    await inSettings(page, () => page.getByRole("button", { name: /ทดสอบเสียง/ }).click());
    expect(await alerts(page)).toBe(1);
  });
});

test("main screen fits one phone screen without scrolling", async ({ page }) => {
  await open(page, { rounds: [1800, 1800, 3600, 5400, 2400, 2400, 2400, 2400] });
  const size = await page.evaluate(() => ({
    sideways: document.documentElement.scrollWidth - window.innerWidth,
    down: document.documentElement.scrollHeight - window.innerHeight,
  }));
  expect(size.sideways).toBeLessThanOrEqual(0);
  expect(size.down).toBeLessThanOrEqual(0);
  for (const id of ["#settingsBtn", "#dial", "#strip", "#addRound", "#startBtn"]) {
    await expect(page.locator(id)).toBeInViewport({ ratio: 1 });
  }
});

test("fits a small 360 x 640 phone too", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 640 });
  await open(page, { rounds: [2400, 2400, 2400, 2400] });
  expect(await page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight)).toBeLessThanOrEqual(0);
  await ui(page).start.click();
  await expect(page.locator("#resetBtn")).toBeInViewport({ ratio: 1 });
});

test("the strip shows each round sized by its length and fills while timing", async ({ page }) => {
  await open(page, { rounds: [60, 90, 1800] });
  const segs = ui(page).rows;
  await expect(segs.locator(".min")).toHaveText(["1 นาที", "1:30 นาที", "30 นาที"]);
  const [a, c] = [await segs.nth(0).boundingBox(), await segs.nth(2).boundingBox()];
  expect(c.width).toBeGreaterThan(a.width * 3);
  await expect(ui(page).finishAt).toHaveText("แตะรอบเพื่อแก้");
  await ui(page).start.click();
  await advance(page, 1 * MIN + 45_000);
  await expect(segs.nth(0)).toHaveClass(/done/);
  await expect(segs.nth(1)).toHaveClass(/current/);
  const fill = await segs.nth(1).evaluate((e) => e.style.getPropertyValue("--p"));
  expect(parseFloat(fill)).toBeGreaterThan(40);
  expect(parseFloat(fill)).toBeLessThan(60);
  await expect(ui(page).finishAt).toContainText("เสร็จราว");
});

test("tapping a round opens its editor: steps, quick picks, typing, delete", async ({ page }) => {
  await open(page, { rounds: [1800, 1800, 600] });
  const u = ui(page);
  await u.rows.nth(1).click();
  await expect(editor(page)).toBeVisible();
  await expect(page.locator("#roundTitle")).toHaveText("รอบที่ 2");
  await expect(page.locator("#draft")).toHaveText("30 นาที");
  await page.locator("#stepUp").click();
  await expect(page.locator("#draft")).toHaveText("35 นาที");
  await page.locator("#stepDown").click();
  await page.locator("#stepDown").click();
  await expect(page.locator("#draft")).toHaveText("25 นาที");
  await page.locator("#saveRound").click();
  await expect(editor(page)).toBeHidden();
  await expect(u.rows.nth(1).locator(".min")).toHaveText("25 นาที");

  // Cancel leaves the round as it was.
  await u.rows.nth(0).click();
  await editor(page).getByRole("button", { name: "60 นาที", exact: true }).click();
  await page.locator("#roundCancel").click();
  await expect(u.rows.nth(0).locator(".min")).toHaveText("30 นาที");

  // Typing several values replaces this round and adds the rest after it.
  await u.rows.nth(2).click();
  await page.locator("#roundInput").fill("1:30, 20");
  await page.locator("#saveRound").click();
  await expect(u.rows.locator(".min")).toHaveText(["30 นาที", "25 นาที", "1:30 นาที", "20 นาที"]);

  await deleteRound(page, 1);
  await expect(u.rows).toHaveCount(3);
  await expect(u.total).toHaveText("3 รอบ • รวม 46:30");
});

test("＋ adds a round as long as the last one unless changed", async ({ page }) => {
  await open(page, { rounds: [2400] });
  await page.locator("#addRound").click();
  await expect(page.locator("#roundTitle")).toHaveText("เพิ่มรอบ");
  await expect(page.locator("#draft")).toHaveText("40 นาที");
  await expect(page.locator("#deleteRound")).toBeHidden();
  await page.locator("#saveRound").click();
  await expect(ui(page).rows.locator(".min")).toHaveText(["40 นาที", "40 นาที"]);
});

test("the main button is one round button with a label underneath", async ({ page }) => {
  await open(page, { rounds: [1800] });
  const u = ui(page);
  const go = await page.locator("#startBtn .go").boundingBox();
  expect(Math.abs(go.width - go.height)).toBeLessThanOrEqual(1);
  await expect(u.start).toHaveText("เริ่ม");
  await expect(u.reset).toBeHidden(); // nothing to reset yet
  await u.start.click();
  await expect(u.reset).toBeVisible();
});

test("sheets close with Done, Cancel or a tap outside", async ({ page }) => {
  await open(page);
  const sheet = page.locator("#settingsSheet");
  await page.locator("#settingsBtn").click();
  await expect(sheet).toBeVisible();
  await sheet.locator("[data-close]").click();
  await expect(sheet).toBeHidden();
  await page.locator("#settingsBtn").click();
  await page.mouse.click(10, 10); // backdrop above the sheet
  await expect(sheet).toBeHidden();
  await page.locator("#addRound").click();
  await expect(editor(page)).toBeVisible();
  await page.mouse.click(10, 10);
  await expect(editor(page)).toBeHidden();
});

test("pause and resume buttons use different colours from start and each other", async ({ page }) => {
  await open(page, { rounds: [600] });
  const u = ui(page);
  const bg = () => page.locator("#startBtn .go").evaluate((el) => getComputedStyle(el).backgroundColor);
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

test("quick picks are 15, 20, 30, 40, 45, 60 minutes", async ({ page }) => {
  await open(page, { rounds: [] });
  await expect(page.locator("#quick button")).toHaveText(["15", "20", "30", "40", "45", "60"]);
  await addRound(page, 40);
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
    await expect(page.locator("#preps").getByRole("radio", { name: "10 วิ", includeHidden: true })).toHaveAttribute("aria-checked", "true");
    await inSettings(page, () => page.locator("#preps").getByRole("radio", { name: "ไม่มี", includeHidden: true }).click());
    await page.reload();
    await expect(page.locator("#preps").getByRole("radio", { name: "ไม่มี", includeHidden: true })).toHaveAttribute("aria-checked", "true");
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
    await inSettings(page, () => page.locator("#dimToggle").uncheck());
    await inSettings(page, () => page.locator("#preps").getByRole("radio", { name: "ไม่มี", includeHidden: true }).click());
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

  test("final sound defaults to 'same as other rounds' and is remembered", async ({ page }) => {
    await open(page, { settings: null });
    const final = page.locator("#finalSounds");
    await expect(final.getByRole("radio", { includeHidden: true })).toHaveText(["เหมือนรอบอื่น", "ขันค่อยๆ ดัง (นุ่มที่สุด)", "ขันทิเบต (นุ่ม)", "ไม้เคาะ (นุ่ม)", "กริ๊ง 2 โน้ต", "บี๊บดิจิทัล"]);
    await expect(final.getByRole("radio", { name: "เหมือนรอบอื่น", includeHidden: true })).toHaveAttribute("aria-checked", "true");
    await inSettings(page, () => final.getByRole("radio", { name: "ไม้เคาะ (นุ่ม)", includeHidden: true }).click());
    await page.reload();
    await expect(final.getByRole("radio", { name: "ไม้เคาะ (นุ่ม)", includeHidden: true })).toHaveAttribute("aria-checked", "true");
  });

  // How many notes one strike of each sound is made of.
  const NOTES = { rise: 6, bowl: 8, wood: 4, chime: 2, beep: 3 };
  for (const [key, notes] of Object.entries(NOTES)) {
    test(`${key} plays once and stops`, async ({ page }) => {
      await page.addInitScript(() => {
        window.__off = new OfflineAudioContext(1, 44100 * 12, 44100);
        window.__off.resume = () => Promise.resolve();
        window.AudioContext = function () { return window.__off; };
      });
      await open(page, { sound: key });
      await inSettings(page, () => page.locator("#testSound").click());
      expect((await tones(page)).length).toBe(notes);
      const { peak, seconds } = await page.evaluate(async () => {
        const d = (await window.__off.startRendering()).getChannelData(0);
        let peak = 0, last = 0;
        for (let i = 0; i < d.length; i++) {
          const a = Math.abs(d[i]);
          if (a > peak) peak = a;
          if (a > 0.01) last = i;
        }
        return { peak, seconds: last / 44100 };
      });
      expect(peak).toBeLessThanOrEqual(1);
      expect(seconds).toBeLessThanOrEqual({ rise: 10, bowl: 4.5 }[key] ?? 1.5);
    });
  }

  test("the rising bowl starts from silence so it does not startle", async ({ page }) => {
    await page.addInitScript(() => {
      window.__off = new OfflineAudioContext(1, 44100 * 12, 44100);
      window.__off.resume = () => Promise.resolve();
      window.AudioContext = function () { return window.__off; };
    });
    await open(page, { sound: "rise", settings: { prep: 0, dim: false, volume: "loud" } });
    await inSettings(page, () => page.locator("#testSound").click());
    const loudness = await page.evaluate(async () => {
      const d = (await window.__off.startRendering()).getChannelData(0);
      const peakIn = (from, to) => { let p = 0; for (let i = from * 44100; i < to * 44100; i++) p = Math.max(p, Math.abs(d[i])); return p; };
      return { first: peakIn(0, 0.5), loudest: peakIn(0, 10) };
    });
    expect(loudness.first).toBeLessThan(loudness.loudest * 0.2);
  });

  test("volume setting scales the alert and is remembered", async ({ page }) => {
    const peakFor = async (volume) => {
      const p = await page.context().newPage();
      await p.addInitScript(() => {
        window.__off = new OfflineAudioContext(1, 44100 * 3, 44100);
        window.__off.resume = () => Promise.resolve();
        window.AudioContext = function () { return window.__off; };
      });
      await open(p, { sound: "chime", settings: { prep: 0, dim: false, volume } });
      return p.evaluate(async () => {
        document.getElementById("testSound").click();
        const d = (await window.__off.startRendering()).getChannelData(0);
        return d.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
      });
    };
    await open(page, { settings: null });
    const volumes = page.locator("#volumes");
    await expect(volumes.getByRole("radio", { includeHidden: true })).toHaveText(["เบา", "กลาง", "ดัง"]);
    await expect(volumes.getByRole("radio", { name: "กลาง", includeHidden: true })).toHaveAttribute("aria-checked", "true");
    await inSettings(page, () => volumes.getByRole("radio", { name: "เบา", includeHidden: true }).click());
    await page.reload();
    await expect(volumes.getByRole("radio", { name: "เบา", includeHidden: true })).toHaveAttribute("aria-checked", "true");

    // (these pages share storage with the one above, so they run last)
    const soft = await peakFor("soft"), loud = await peakFor("loud");
    expect(soft).toBeLessThan(loud * 0.5);
  });

  test("there is no alert-length setting", async ({ page }) => {
    await open(page);
    await expect(page.getByText("ความยาวเสียงเตือน")).toHaveCount(0);
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

test.describe("sitting history", () => {
  const SETTINGS = { prep: 0, dim: false };
  const openLog = async (page) => {
    await page.locator("#settingsBtn").click();
    await page.locator("#openLog").click();
    await expect(page.locator("#logSheet")).toBeVisible();
  };
  const list = (page) => page.locator("#logList");

  test("says so when there is nothing yet", async ({ page }) => {
    await open(page, { settings: SETTINGS });
    await openLog(page);
    await expect(list(page)).toContainText("ยังไม่มีประวัติ");
  });

  test("records a whole sitting: start, alerts on time, finish", async ({ page }) => {
    await open(page, { rounds: [60, 60], settings: SETTINGS });
    await ui(page).start.click();
    await advance(page, 2 * MIN + 500);
    await openLog(page);
    const log = list(page);
    await expect(log).toContainText("เริ่ม 09:00:00");
    await expect(log).toContainText("จบครบทุกรอบ • เตือน 2 ครั้ง");
    await expect(log).toContainText("กดเริ่ม • 2 รอบ");
    await expect(log).toContainText("เตือนจบรอบ 1");
    await expect(log).toContainText("ควรเตือน 09:01:00");
    await expect(log).toContainText("เตือนจบรอบ 2 (รอบสุดท้าย)");
    await expect(log).toContainText("ตรงเวลา");
    await expect(log).not.toContainText("ช้า");
  });

  test("shows an alert that came late because the page was asleep", async ({ page }) => {
    await open(page, { rounds: [600, 600, 600], settings: SETTINGS });
    await ui(page).start.click();
    await page.clock.fastForward(25 * MIN); // timers did not run, like a hidden page
    await page.clock.runFor(500);
    await openLog(page);
    const log = list(page);
    await expect(log).toContainText("ควรเตือน 09:10:00");
    await expect(log).toContainText("ช้า 15 นาที");
    await expect(log).toContainText("ข้าม 1 รอบที่เลยเวลาไปแล้ว");
    await expect(log).toContainText("เตือนช้า 1 ครั้ง");
  });

  test("notes when the page was hidden and for how long", async ({ page }) => {
    await open(page, { rounds: [1800], settings: SETTINGS });
    await ui(page).start.click();
    const setVisibility = (v) => page.evaluate((v) => {
      Object.defineProperty(document, "visibilityState", { value: v, configurable: true });
      document.dispatchEvent(new Event("visibilitychange"));
    }, v);
    await setVisibility("hidden");
    await advance(page, 5 * MIN);
    await setVisibility("visible");
    await openLog(page);
    await expect(list(page)).toContainText("หน้านี้ถูกซ่อน");
    await expect(list(page)).toContainText("กลับมาที่หน้านี้");
    await expect(list(page)).toContainText("หายไป 5 นาที");
  });

  test("flags an alert fired while the audio system was suspended", async ({ page }) => {
    await page.addInitScript(() => {
      const Real = window.AudioContext;
      window.AudioContext = function (...args) {
        const ctx = new Real(...args);
        Object.defineProperty(ctx, "state", { get: () => "suspended" });
        ctx.resume = () => Promise.resolve();
        return ctx;
      };
    });
    await open(page, { rounds: [60], settings: SETTINGS });
    await ui(page).start.click();
    await advance(page, 1 * MIN + 500);
    await openLog(page);
    await expect(list(page)).toContainText("ระบบเสียงถูกพัก");
  });

  test("flags a sitting cut short when the app was closed or reloaded", async ({ page }) => {
    await open(page, { rounds: [1800], settings: SETTINGS });
    await ui(page).start.click();
    await advance(page, 3 * MIN);
    await page.reload();
    await openLog(page);
    await expect(list(page)).toContainText("ถูกขัดจังหวะ");
    await expect(list(page)).toContainText("แอพถูกปิดหรือรีโหลดก่อนจบ");
    await expect(list(page)).toContainText("เหตุการณ์สุดท้ายที่บันทึกไว้");
  });

  test("a sitting that was reset or paused is described as such", async ({ page }) => {
    await open(page, { rounds: [600], settings: SETTINGS });
    const u = ui(page);
    await u.start.click();
    await advance(page, 4 * MIN);
    await u.start.click(); // pause
    await u.start.click(); // resume
    await u.reset.click();
    await openLog(page);
    await expect(list(page)).toContainText("กดเลิก");
    await expect(list(page)).toContainText("หยุดชั่วคราว");
    await expect(list(page)).toContainText("เหลือ 6 นาที");
    await expect(list(page)).toContainText("ทำต่อ");
  });

  test("records whether keeping the screen on worked", async ({ page }) => {
    await page.addInitScript(() => {
      const api = { async request() { throw new DOMException("no", "NotAllowedError"); } };
      Object.defineProperty(Navigator.prototype, "wakeLock", { get: () => api, configurable: true });
    });
    await open(page, { rounds: [600], settings: SETTINGS });
    await ui(page).start.click();
    await openLog(page);
    await expect(list(page)).toContainText("กันจอดับ: มือถือไม่อนุญาต");
  });

  test("newest sitting first, and history survives a reload", async ({ page }) => {
    await open(page, { rounds: [60], settings: SETTINGS });
    const u = ui(page);
    await u.start.click();
    await advance(page, 1 * MIN + 500);
    await u.start.click(); // start again from "finished"
    await advance(page, 30_000);
    await page.reload();
    await openLog(page);
    const sessions = list(page).locator(".log-session");
    await expect(sessions).toHaveCount(2);
    await expect(sessions.nth(0)).toContainText("ถูกขัดจังหวะ"); // the second, cut short
    await expect(sessions.nth(1)).toContainText("จบครบทุกรอบ");
  });

  test("clear removes the history", async ({ page }) => {
    await open(page, { rounds: [60], settings: SETTINGS });
    await ui(page).start.click();
    await advance(page, 1 * MIN + 500);
    await openLog(page);
    await expect(list(page).locator(".log-session")).toHaveCount(1);
    await page.locator("#clearLog").click();
    await expect(list(page)).toContainText("ยังไม่มีประวัติ");
    await page.reload();
    await openLog(page);
    await expect(list(page)).toContainText("ยังไม่มีประวัติ");
  });

  test("copy puts a readable text version on the clipboard", async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await open(page, { rounds: [60], settings: SETTINGS });
    await ui(page).start.click();
    await advance(page, 1 * MIN + 500);
    await openLog(page);
    await page.locator("#copyLog").click();
    await expect(page.locator("#copyNote")).toContainText("คัดลอกแล้ว");
    const text = await page.evaluate(() => navigator.clipboard.readText());
    expect(text).toContain("เริ่ม 09:00:00");
    expect(text).toContain("เตือนจบรอบ 1 (รอบสุดท้าย)");
    expect(text).toContain("ควรเตือน 09:01:00");
  });

  test("keeps only the latest 400 events", async ({ page }) => {
    await page.addInitScript(() => {
      if (sessionStorage.getItem("seeded-log")) return;
      sessionStorage.setItem("seeded-log", "1");
      const old = Array.from({ length: 500 }, (_, i) => ({ t: 1_700_000_000_000 + i, e: i === 0 ? "start" : "vis", v: "hidden", r: [60] }));
      old.push({ t: 1_700_000_001_000, e: "finish" });
      localStorage.setItem("multi-round-timer:v1:log", JSON.stringify(old));
    });
    await open(page, { rounds: [60], settings: SETTINGS });
    await ui(page).start.click();
    const size = await page.evaluate(() => JSON.parse(localStorage.getItem("multi-round-timer:v1:log")).length);
    expect(size).toBeLessThanOrEqual(400);
  });
});
