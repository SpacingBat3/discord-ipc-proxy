# Node.js binary
NODE ?= node
# TypeScript compiler
TSC ?= node_modules/.bin/tsc
# Rollup toolkit
ROLLUP ?= node_modules/.bin/rollup
# Postject binary
POSTJECT ?= node_modules/.bin/postject
# Postject args
POSTJECTARGS += --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2

# Signature removal tool with args
SIGRM = true
# Tool to sign resulting binary
SIGTOOL = 

# Mandatory binary extension
BINEXT =

# Path to Node.js
NODEPATH := $(shell $(NODE) -e "console.log(process.execPath)")

_CMSG=\033[92m
_CRST=\033[0m

ifeq ($(OS),Windows_NT)
	SIGRM = signtool remove /s
	BINEXT = .exe
else
	OS ?= $(shell uname -s)
	ifeq ($(OS),Darwin)
		SIGTOOL = codesign --sign -
		SIGRM = codesign --remove-signature
		POSTJECTARGS += --macho-segment-name NODE_SEA
	endif
endif

all: build

clean:
	@echo -e "🧼️ $(_CMSG)[0/1] Cleaning up workdir$(_CRST)"
	-@rm discord-ipc-proxy$(BINEXT) \
		cache/sea.bin cache/tsc-build.json dist/bundle.js \
		cache/rollup.config.d.mts rollup.config.mjs 2>/dev/null || true
	-@rmdir --ignore-fail-on-non-empty cache
	@echo -e "✨️ $(_CMSG)[1/1] Cleanup done!$(_CRST)"

build: discord-ipc-proxy$(BINEXT)

dist/main.js rollup.config.mjs: src/main.ts rollup.config.mts
	@echo -e "🔨️ $(_CMSG)[0/4] Compiling package sources...$(_CRST)"
	@$(TSC) -b --verbose

dist/bundle.js: dist/main.js rollup.config.mjs
	@printf '📦️ $(_CMSG)[1/4] Bundling package sources...$(_CRST)'
	@$(ROLLUP) --config rollup.config.mjs

cache/sea.blob: dist/bundle.js
	@echo -e "🔧️ $(_CMSG)[2/4] Generating SEA blob...$(_CRST)"
	@mkdir -p cache
	@$(NODE) --experimental-sea-config sea-config.json

discord-ipc-proxy$(BINEXT): cache/sea.blob
	@echo -e "💉 $(_CMSG)[3/4] Bundling final executable...$(_CRST)"
	@cp $(NODEPATH) discord-ipc-proxy$(BINEXT)
	@$(SIGRM) discord-ipc-proxy$(BINEXT)
	@$(POSTJECT) discord-ipc-proxy$(BINEXT) NODE_SEA_BLOB cache/sea.blob $(POSTJECTARGS)
	@echo -e "🚀️ $(_CMSG)[4/4] Built 'discord-ipc-proxy$(BINEXT)'."