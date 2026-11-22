import { expect, test } from "@playwright/test";

test("Liste per Klick auf den Spaltenkopf sortieren", async ({ page }, info) => {
  const name = `sortiert-${info.project.name}.txt`;
  await page.goto("/eingang");
  await page.getByTestId("upload").setInputFiles({ name, mimeType: "text/plain", buffer: Buffer.from(name) });
  await expect(page.getByRole("link", { name })).toBeVisible();
  await page.goto("/archiv?darstellung=liste");
  const eingang = page.getByRole("columnheader", { name: /Eingang/ });
  await expect(eingang).toHaveAttribute("aria-sort", "descending");
  await eingang.getByRole("button").click();
  await expect(page).toHaveURL(/sortierung=alt/);
  await expect(eingang).toHaveAttribute("aria-sort", "ascending");
  await page.getByRole("columnheader", { name: /Name/ }).getByRole("button").click();
  await expect(page).toHaveURL(/sortierung=titel/);
  await expect(page.getByLabel("Sortierung")).toHaveValue("titel");
});
