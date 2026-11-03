/** App shell: sign-in, landing screen per role, menu per role, guarded routes, theme, phone width. */
import { join } from "node:path";

export default async function ({ page, check, base, out }) {
  const expected = {
    owner: { home: "dashboard", items: 14 },
    admin: { home: "myday", items: 14 },
    bd_support: { home: "myday", items: 9 },
    specialist: { home: "myday", items: 7 },
    read_only: { home: "myday", items: 4 }
  };
  for (const [role, e] of Object.entries(expected)) {
    const p = await page(role);
    await p.goto(base + "/");
    await p.waitForURL(`**/${e.home}`, { timeout: 15_000 });
    check(`${role} lands on ${e.home}`, p.url().endsWith(`/${e.home}`));
    const items = await p.locator("#megap a.mg-i").count();
    check(`${role} menu has ${e.items} screens`, items === e.items, `found ${items}`);
    check(`${role} no page errors`, p.errors.length === 0, p.errors.join(" | "));
    await p.context().close();
  }

  // A role cannot open a screen it may not see: it lands on its home screen instead.
  const ro = await page("read_only");
  await ro.goto(base + "/access");
  await ro.waitForURL("**/myday");
  check("read only sent from Access to My day", ro.url().endsWith("/myday"));
  await ro.context().close();

  // Mega menu opens, shows descriptions, closes on Escape, and returns focus.
  const p = await page("owner");
  await p.goto(base + "/dashboard");
  await p.click('.mega-t[data-g="sell"]');
  check("mega menu opens", await p.locator("#megap").isVisible());
  check("menu items carry descriptions", (await p.locator("#megap .mg-d").first().textContent())?.includes("Your moves"));
  await p.screenshot({ path: join(out, "shell-menu-light.png") });
  await p.keyboard.press("Escape");
  check("Escape closes the menu", !(await p.locator("#megap").isVisible()));
  check("focus returns to the menu button", await p.evaluate(() => document.activeElement?.classList.contains("mega-t")));
  await p.click('.mega-t[data-g="sell"]');
  await p.click('#megap a[href="/pipeline"]');
  await p.waitForURL("**/pipeline");
  check("menu navigates and shows the current screen", (await p.locator(".mega-cur").textContent()) === "Pipeline");
  check("header shows the push day", /Day \d+ of 60|Starts Oct 29/.test(await p.locator(".brand span").textContent()));

  // Theme cycles Auto, Light, Dark and survives a reload.
  await p.click(".themebtn"); await p.click(".themebtn");
  check("theme switches to dark", (await p.evaluate(() => document.documentElement.dataset.theme)) === "dark");
  await p.reload();
  check("theme kept after reload", (await p.evaluate(() => document.documentElement.dataset.theme)) === "dark");
  await p.screenshot({ path: join(out, "shell-dark.png") });
  await p.context().close();

  // Phone width: no sideways page scroll.
  const m = await page("bd_support", { width: 390 });
  await m.goto(base + "/myday");
  await m.waitForSelector("header.top");
  const overflow = await m.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check("390 px wide: no sideways scroll", overflow <= 0, `${overflow}px`);
  await m.click('.mega-t[data-g="sell"]');
  await m.screenshot({ path: join(out, "shell-390-menu.png") });
  await m.context().close();
}
