#!/bin/sh
# Instala o .deb num Debian de verdade (contêiner com systemd como PID 1) e confere, com o dpkg, o apt e
# o systemd do próprio Debian:
#   - o apt resolve Depends: nodejs (>= 20.19) com o nodejs do Debian 13 (20.19);
#   - o postinst cria o usuário piu-node (sysusers.d, no grupo dialout) e liga o serviço;
#   - o serviço sobe com o endurecimento da unidade, como piu-node, e serve o painel em https://localhost:8420;
#   - o código de pareamento fica em /var/lib/piu-node/pairing-code (0600, pasta 0700) e não vai para o journal;
#   - systemd-analyze verify sem erro e a nota de systemd-analyze security;
#   - remove mantém /var/lib/piu-node; purge apaga.
#
#   sh test/docker-e2e.sh [arquivo.deb]       (padrão: dist/piu-node_*_all.deb; precisa de Docker)
#   PIU_E2E_IMAGE=debian:trixie               (outra base: ubuntu:25.04, ...; precisa ter nodejs >= 20.19 no apt)
#   PIU_E2E_PLATFORM=linux/arm64              (Raspberry Pi 64 bits; no x86 precisa de emulação qemu/binfmt)
set -eu

here="$(cd "$(dirname "$0")/.." && pwd)"
deb="${1:-$(ls "$here"/dist/piu-node_*_all.deb | tail -n 1)}"
image="${PIU_E2E_IMAGE:-debian:trixie}"
platform="${PIU_E2E_PLATFORM:-}"

[ -f "$deb" ] || { echo "docker-e2e: .deb não encontrado ($deb): rode npm run build" >&2; exit 1; }
echo "docker-e2e: $deb em $image ${platform:-(plataforma local)}"

# Sem docker build: o contêiner instala o systemd e troca o sh por ele (exec), que vira o PID 1.
boot='apt-get update -qq && DEBIAN_FRONTEND=noninteractive apt-get install -y -qq --no-install-recommends systemd systemd-sysv dbus curl ca-certificates >/dev/null && exec /lib/systemd/systemd'
cid="$(docker run -d ${platform:+--platform "$platform"} --privileged --cgroupns=host -v /sys/fs/cgroup:/sys/fs/cgroup:rw --tmpfs /run --tmpfs /run/lock --tmpfs /tmp --stop-signal SIGRTMIN+3 "$image" sh -c "$boot")"
trap 'docker rm -f "$cid" >/dev/null 2>&1 || true' EXIT
x() { docker exec "$cid" sh -c "$1"; }
fail() { echo "docker-e2e: FALHOU: $*" >&2; x 'journalctl -u piu-node --no-pager -n 60' >&2 || true; exit 1; }

for _ in $(seq 1 600); do
	s="$(x 'systemctl is-system-running 2>/dev/null' || true)"
	case "$s" in running | degraded) break ;; esac
	sleep 1
done
echo "docker-e2e: systemd $s"

docker cp "$deb" "$cid:/root/piu-node.deb"
x 'apt-get update -qq && DEBIAN_FRONTEND=noninteractive apt-get install -y -qq /root/piu-node.deb' || fail 'apt install'
x 'node -v'
x 'dpkg -s piu-node | grep -E "^(Status|Version|Depends):"'

x 'id piu-node' | tee /dev/stderr | grep -q '(dialout)' || fail 'usuário piu-node fora do grupo dialout'
x 'systemctl is-enabled piu-node' | grep -qx enabled || fail 'serviço não habilitado'

for _ in $(seq 1 40); do
	x 'test -s /var/lib/piu-node/pairing-code' 2>/dev/null && break
	sleep 0.5
done
x 'systemctl is-active piu-node' | grep -qx active || fail 'serviço não está ativo'
x 'systemctl show -p User -p MainPID -p NoNewPrivileges -p ProtectSystem -p ProtectHome -p PrivateTmp piu-node'
pid="$(x 'systemctl show -p MainPID --value piu-node')"
x "stat -c %U /proc/$pid" | grep -qx piu-node || fail 'processo não roda como piu-node'
x 'stat -c "%a %U:%G %n" /var/lib/piu-node /var/lib/piu-node/pairing-code'
[ "$(x 'stat -c %a /var/lib/piu-node')" = 700 ] || fail 'pasta de dados não é 0700'
[ "$(x 'stat -c %a /var/lib/piu-node/pairing-code')" = 600 ] || fail 'pairing-code não é 0600'
x 'grep -qE "^[0-9]{8}$" /var/lib/piu-node/pairing-code' || fail 'pairing-code sem 8 dígitos'
x 'journalctl -u piu-node --no-pager' >/tmp/piu-e2e-journal.txt 2>&1 || true
grep -q 'Código de pareamento em /var/lib/piu-node/pairing-code' /tmp/piu-e2e-journal.txt || fail 'journal não diz onde ler o código'
code="$(x 'cat /var/lib/piu-node/pairing-code')"
! grep -q "$code" /tmp/piu-e2e-journal.txt || fail 'o código apareceu no journal'
rm -f /tmp/piu-e2e-journal.txt

for _ in $(seq 1 20); do
	st="$(x 'curl -sk -o /dev/null -w "%{http_code}" https://localhost:8420/' || true)"
	[ "$st" = 200 ] && break
	sleep 0.5
done
[ "$st" = 200 ] || fail "painel respondeu $st"
[ "$(x 'curl -sk -o /dev/null -w "%{http_code}" https://localhost:8420/api/session')" = 401 ] || fail 'API sem sessão deveria dar 401'
echo "docker-e2e: painel 200, /api/session 401"

x 'systemd-analyze verify /usr/lib/systemd/system/piu-node.service' || fail 'systemd-analyze verify'
x 'systemd-analyze security piu-node.service --no-pager | tail -n 1'

# Queda do processo (SIGKILL): Restart=on-failure sobe de novo (o reinício pelo painel sai com 75, idem).
x "kill -KILL $pid"
sleep 4
x 'systemctl is-active piu-node' | grep -qx active || fail 'não voltou depois do SIGTERM'

x 'DEBIAN_FRONTEND=noninteractive apt-get remove -y -qq piu-node' >/dev/null || fail 'remove'
x 'test -d /var/lib/piu-node' || fail 'remove apagou /var/lib/piu-node'
x 'test ! -e /usr/lib/systemd/system/piu-node.service' || fail 'remove deixou a unidade'
x 'dpkg --purge piu-node' >/dev/null || fail 'purge'
x 'test ! -e /var/lib/piu-node' || fail 'purge não apagou /var/lib/piu-node'
echo "docker-e2e: OK ($image ${platform:-$(uname -m)}, $(x "uname -m"))"
