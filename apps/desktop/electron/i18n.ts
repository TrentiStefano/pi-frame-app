import i18next, { type TOptions } from "i18next";
import type { AppLanguage } from "../src/desktop-state";
import { translationResources } from "../src/i18n/resources";

const mainI18n = i18next.createInstance();

void mainI18n.init({
  resources: translationResources,
  lng: "en",
  fallbackLng: "en",
  supportedLngs: ["en", "zh-CN"],
  interpolation: { escapeValue: false },
  returnNull: false,
});

export function setMainLanguage(language: AppLanguage): void {
  if (mainI18n.language !== language) {
    void mainI18n.changeLanguage(language);
  }
}

export function mainT(key: string, options?: TOptions): string {
  return mainI18n.t(key, options);
}
