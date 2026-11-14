import type { Rolle } from "../../shared/rollen.ts";
import { m } from "../paraglide/messages.js";

export function rolleLabel(rolle: Rolle): string {
  return { inhaber: m.role_inhaber, steuerberatung: m.role_steuerberatung, pruefer: m.role_pruefer }[rolle]();
}
