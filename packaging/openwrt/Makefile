# Pacote piu-node para um feed ou SDK do OpenWrt (alternativa ao build-ipk.mjs).
#
# O bundle JS e o painel precisam de Node.js e npm no host, que o SDK não tem: monte-os antes
# nesta pasta com `npm run deps && npm run build:panel && npm ci && npm run stage`. Isso cria
# build/root/ com o mesmo conteúdo do .ipk do build-ipk.mjs; aqui só se copia para o pacote.
# Com o SDK 25.12 (apk), este Makefile gera um .apk; o build-ipk.mjs gera só .ipk (opkg).
#
# PKG_VERSION acompanha apps/piu-node/package.json e PKG_RELEASE é lido pelo build-ipk.mjs
# (o teste test/ipk.test.mjs confere).

include $(TOPDIR)/rules.mk

PKG_NAME:=piu-node
PKG_VERSION:=0.1.1
PKG_RELEASE:=1

PKG_LICENSE:=AGPL-3.0-only
PKG_MAINTAINER:=Lunes Network

# Conteúdo montado pelo `npm run stage` (ou outro caminho: make ... PIU_STAGE=/caminho/root).
PIU_STAGE ?= $(CURDIR)/build/root

include $(INCLUDE_DIR)/package.mk

define Package/piu-node
  SECTION:=net
  CATEGORY:=Network
  TITLE:=Piu node: painel do provider e retransmissão LNNP
  DEPENDS:=+node
  PKGARCH:=all
  USERID:=piu-node:piu-node:dialout=20
endef

define Package/piu-node/description
 Nó de referência do Piu: painel do provider por HTTPS (porta 8420) e
 retransmissão de envelopes LNNP v1 na rede local (TCP 8422, UDP 8423).
 Requer Node.js 20.19 ou mais novo. Configuração em /etc/config/piu-node.
endef

define Package/piu-node/conffiles
/etc/config/piu-node
endef

define Build/Prepare
	@[ -f "$(PIU_STAGE)/usr/lib/piu-node/piu-node.mjs" ] || { \
		echo "piu-node: falta $(PIU_STAGE); rode 'npm run stage' em packaging/openwrt" >&2; exit 1; }
	mkdir -p $(PKG_BUILD_DIR)
endef

define Build/Compile
endef

define Package/piu-node/install
	$(INSTALL_DIR) $(1)/usr/lib/piu-node $(1)/usr/share/piu-node
	$(CP) $(PIU_STAGE)/usr/lib/piu-node/. $(1)/usr/lib/piu-node/
	$(CP) $(PIU_STAGE)/usr/share/piu-node/panel $(1)/usr/share/piu-node/
	$(INSTALL_DIR) $(1)/etc/init.d $(1)/etc/config $(1)/lib/upgrade/keep.d
	$(INSTALL_BIN) ./files/piu-node.init $(1)/etc/init.d/piu-node
	$(INSTALL_CONF) ./files/piu-node.config $(1)/etc/config/piu-node
	$(INSTALL_DATA) ./files/piu-node.keep $(1)/lib/upgrade/keep.d/piu-node
endef

$(eval $(call BuildPackage,piu-node))
