import { expect, test } from "@playwright/test";

test("Dateien auf eine beliebige Seite ziehen und ablegen: sie landen im Eingang", async ({ page }, info) => {
  const name = `abgelegt-${info.project.name}.txt`;
  await page.goto("/fristen");
  // Ziehen und Ablegen wie aus dem Dateimanager: DataTransfer mit einer Datei, Ereignisse am Fenster
  await page.evaluate((dateiname) => {
    const daten = new DataTransfer();
    daten.items.add(new File([`Inhalt ${dateiname}`], dateiname, { type: "text/plain" }));
    window.dispatchEvent(new DragEvent("dragenter", { dataTransfer: daten, bubbles: true, cancelable: true }));
    window.dispatchEvent(new DragEvent("drop", { dataTransfer: daten, bubbles: true, cancelable: true }));
  }, name);
  const meldung = page.getByRole("status").filter({ hasText: "aufgenommen" });
  await expect(meldung).toContainText("1 Dokument aufgenommen");
  await meldung.getByRole("link", { name: "Zum Eingang" }).click();
  await expect(page.getByRole("link", { name })).toBeVisible();
});
