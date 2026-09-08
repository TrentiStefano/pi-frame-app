import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import type { AppLanguage } from "../desktop-state";
import { isAppLanguage, resolveSystemAppLanguage, translationResources } from "./resources";

const initialLanguage: AppLanguage = isAppLanguage(window.piApp?.initialAppLanguage)
  ? window.piApp.initialAppLanguage
  : resolveSystemAppLanguage(navigator.language);

void i18next.use(initReactI18next).init({
  resources: translationResources,
  lng: initialLanguage,
  fallbackLng: "en",
  supportedLngs: ["en", "zh-CN"],
  interpolation: { escapeValue: false },
  returnNull: false,
});

document.documentElement.lang = initialLanguage;

export const i18n = i18next;

export function setRendererLanguage(language: AppLanguage): void {
  document.documentElement.lang = language;
  if (i18next.language !== language) {
    void i18next.changeLanguage(language);
  }
}
