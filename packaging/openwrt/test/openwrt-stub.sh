# Imitação mínima do que o rc.common, o /lib/functions.sh e o procd.sh oferecem ao init script,
# para testar /etc/init.d/piu-node fora do OpenWrt. Não é o código do OpenWrt: só o comportamento
# que o script usa.
#
# config_load lê o arquivo UCI como shell: `config`, `option` e `list` são sintaxe válida de sh,
# e as funções abaixo guardam os valores nas mesmas variáveis CONFIG_<seção>_<opção> que o
# OpenWrt usa (listas também em _ITEM<n> e _LENGTH).

config() { CONFIG_SECTION="$2"; }
option() { eval "CONFIG_${CONFIG_SECTION}_$1=\$2"; }
list() {
	local n
	eval "n=\${CONFIG_${CONFIG_SECTION}_$1_LENGTH:-0}"
	n=$((n + 1))
	eval "CONFIG_${CONFIG_SECTION}_$1_ITEM$n=\$2"
	eval "CONFIG_${CONFIG_SECTION}_$1_LENGTH=$n"
	eval "CONFIG_${CONFIG_SECTION}_$1=\"\${CONFIG_${CONFIG_SECTION}_$1:+\$CONFIG_${CONFIG_SECTION}_$1 }\$2\""
}

config_load() { . "$UCI_CONFIG_DIR/$1"; }

config_get() { eval "$1=\${CONFIG_$2_$3:-\$4}"; }

config_get_bool() {
	local _tmp
	config_get _tmp "$2" "$3" "$4"
	case "$_tmp" in
		1|on|true|yes|enabled) _tmp=1 ;;
		0|off|false|no|disabled) _tmp=0 ;;
		*) _tmp="$4" ;;
	esac
	eval "$1=\$_tmp"
}

config_list_foreach() {
	local section="$1" option="$2" function="$3" len c=1 val
	eval "len=\${CONFIG_${section}_${option}_LENGTH}"
	[ -z "$len" ] && return 0
	while [ "$c" -le "$len" ]; do
		eval "val=\${CONFIG_${section}_${option}_ITEM$c}"
		"$function" "$val"
		c=$((c + 1))
	done
}

# procd: cada chamada vira uma linha "<ação> <tipo>\t<arg>\t<arg>..." no stdout.
piu_stub_emit() {
	local what="$1"
	shift
	printf '%s' "$what"
	for a in "$@"; do printf '\t%s' "$a"; done
	printf '\n'
}
procd_open_instance() { piu_stub_emit open_instance; }
procd_close_instance() { piu_stub_emit close_instance; }
procd_set_param() { piu_stub_emit set "$@"; }
procd_append_param() { piu_stub_emit append "$@"; }
procd_add_reload_trigger() { piu_stub_emit reload_trigger "$@"; }

user_exists() { [ "$1" = piu-node ]; }
chown() { piu_stub_emit chown "$@"; }
logger() { :; }
network_get_ipaddr() { eval "$1=192.168.1.1"; }
