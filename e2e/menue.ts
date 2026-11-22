import type { Page } from "@playwright/test";

/** Am Handy steckt die Navigation hinter „Menü“; am Desktop ist sie immer da und der Aufruf tut nichts */
export async function menueOeffnen(page: Page) {
  const knopf = page.getByRole("button", { name: "Menü" });
  if ((await knopf.isVisible()) && (await knopf.getAttribute("aria-expanded")) !== "true") await knopf.click();
}
