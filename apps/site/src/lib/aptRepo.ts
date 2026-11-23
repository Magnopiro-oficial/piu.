// Repositório apt do Piu (scripts/apt-repo.mjs), publicado em <site>/apt/ pelo workflow pages-site.yml.
// O workflow passa APT_KEY_FPR (impressão digital da chave que assinou o Release) só quando o repositório
// vai junto no deploy; sem ele (secret APT_GPG_PRIVATE_KEY ausente ou build local), a página não mostra
// as instruções do apt. Para ver o bloco localmente: APT_KEY_FPR=<40 hexa> npm run build.

/** Endereço público quando SITE_URL não vem no build (dev local). */
const DEFAULT_SITE = 'https://magnopiro-oficial.github.io';

const fpr = (process.env.APT_KEY_FPR ?? '').trim().toUpperCase();

/** Impressão digital da chave do repositório (40 hexa), ou vazio = repositório fora deste deploy. */
export const APT_KEY_FPR = /^[0-9A-F]{40}$/.test(fpr) ? fpr : '';
export const APT_ENABLED = !!APT_KEY_FPR;

/** URL absoluta de <site>/apt (sem barra no fim), a mesma que vai na linha do sources.list. */
export function aptUrl(site: URL | undefined): string {
  const base = import.meta.env.BASE_URL.replace(/\/$/, '');
  const origin = (site?.origin ?? DEFAULT_SITE).replace(/\/$/, '');
  return `${origin}${base}/apt`;
}

/** Comandos de instalação (iguais em todos os idiomas: só os textos em volta mudam). */
export function aptCommands(repoUrl: string) {
  const keyring = '/etc/apt/keyrings/piu.gpg';
  return {
    key: `sudo install -d -m 0755 /etc/apt/keyrings && curl -fsSL ${repoUrl}/piu-archive-keyring.gpg | sudo tee ${keyring} > /dev/null`,
    source: `echo "deb [signed-by=${keyring}] ${repoUrl} stable main" | sudo tee /etc/apt/sources.list.d/piu.list`,
    desktop: 'sudo apt update && sudo apt install piu',
    node: 'sudo apt update && sudo apt install piu-node',
    provider: 'sudo apt update && sudo apt install piu-provider-desktop',
  };
}
