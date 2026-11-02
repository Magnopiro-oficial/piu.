/** "Cardeal Silva" → "CS" */
export const initialsOf = (name: string) => name.trim().split(/\s+/).map(w => w[0] ?? '').slice(0, 2).join('').toUpperCase();
/** "Cardeal" → "@cardeal" (sem acentos nem símbolos). */
export const handleOf = (name: string) => '@' + name.toLowerCase().normalize('NFD').replace(/[^a-z0-9]/g, '');
export const nowHM = () => { const d = new Date(); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); };
