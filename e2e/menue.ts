import { expect, type Page } from "@playwright/test";

/**
 * Am Handy steckt die Navigation hinter „Menü“; am Desktop ist sie immer da und der Aufruf tut nichts. Wartet erst, bis
 * die Shell steht (Knopf oder Navigation sichtbar), sonst liefe er vor dem Laden ins Leere
 */
export async function menueOeffnen(page: Page) {
  const knopf = page.getByRole("button", { name: "Menü" });
  const nav = page.getByRole("navigation", { name: "Hauptnavigation" });
  await expect(knopf.or(nav).first()).toBeVisible();
  if ((await knopf.isVisible()) && (await knopf.getAttribute("aria-expanded")) !== "true") await knopf.click();
}

/** Am Handy liegt das offene Menü über dem Inhalt und fängt Klicks ab; vor einem Klick dahinter zuklappen. Am Desktop ohne Wirkung */
export async function menueSchliessen(page: Page) {
  const knopf = page.getByRole("button", { name: "Menü" });
  if ((await knopf.isVisible()) && (await knopf.getAttribute("aria-expanded")) === "true") await knopf.click();
}
