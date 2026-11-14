import type { HelpCorpus } from '../src/features/help/kb'
export const SENSITIVE: RegExp
export function helpSlug(text: string): string
export function buildCorpus(): HelpCorpus
export function settingsSections(): { tabLabel: Record<string, string>; tabHint: Record<string, string>; groupOf: Record<string, string> }
export function helpCorpusPlugin(): import('vite').Plugin
