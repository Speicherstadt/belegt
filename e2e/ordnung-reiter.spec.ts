import { expect, test } from "@playwright/test";

test("Ordnung in Reitern mit Filter nach Namen", async ({ page }, info) => {
  const p = info.project.name;
  await page.request.post("/api/tags", { data: { name: `Reiter Apfel ${p}`, farbe: "gruen" } });
  await page.request.post("/api/tags", { data: { name: `Reiter Birne ${p}`, farbe: "gelb" } });
  await page.goto("/ordnung");
  await expect(page.getByRole("tab", { name: "Korrespondenten" })).toHaveAttribute("aria-selected", "true");
  await page.getByRole("tab", { name: "Tags" }).click();
  await expect(page).toHaveURL(/bereich=tags/);
  const tags = page.locator("section", { has: page.getByRole("heading", { name: "Tags", exact: true }) });
  await expect(tags.getByText(`Reiter Birne ${p}`)).toBeVisible();
  await page.getByRole("searchbox", { name: "Nach Namen filtern" }).fill(`Apfel ${p}`);
  await expect(tags.getByText(`Reiter Apfel ${p}`)).toBeVisible();
  await expect(tags.getByText(`Reiter Birne ${p}`)).toHaveCount(0);
});
