/** Rollen eines Zugangs: Inhaber darf alles, Steuerberatung und Prüfer nur lesen */
export const ROLLEN = ["inhaber", "steuerberatung", "pruefer"] as const;
export type Rolle = (typeof ROLLEN)[number];

export const darfSchreiben = (rolle: Rolle | null | undefined): boolean => rolle === "inhaber";
