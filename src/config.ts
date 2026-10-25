import content from './config.json';

interface Option { number: number; label: string; action: string; answer?: string }
export interface Department {
  key: string; number: number; label: string; emoji: string;
  chatIdVariable: string; options: Option[];
}
export const departments: Department[] = content.departments;
export const texts = content.texts;
export function format(text: string, values: Record<string, string | number>): string {
  return text.replace(/\{(\w+)\}/g, (match, key) => String(values[key] ?? match));
}
// Fail builds/tests early when a menu is edited incorrectly.
const unique = (values: (string | number)[]) => new Set(values).size === values.length;
if (!unique(departments.map(d => d.key)) || !unique(departments.map(d => d.number))) throw new Error('Setores devem ter chaves e números únicos.');
for (const d of departments) {
  if (!/^[a-z][a-z0-9_]*$/.test(d.key) || !Number.isInteger(d.number) || d.number < 1 ||
      d.label.length > 100 || !/^[A-Z][A-Z0-9_]*_CHAT_ID$/.test(d.chatIdVariable) ||
      !unique(d.options.map(o => o.number)) || !d.options.some(o => o.action === 'handoff')) throw new Error('Configuração de setor inválida.');
  for (const o of d.options) {
    if (!Number.isInteger(o.number) || o.number < 1 || o.label.length > 100 ||
        !['answer', 'handoff'].includes(o.action) ||
        (o.action === 'answer' && (!o.answer || o.answer.length > 3000))) throw new Error('Configuração de submenu inválida.');
  }
}
